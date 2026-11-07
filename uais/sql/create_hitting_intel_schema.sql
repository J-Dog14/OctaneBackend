-- =============================================================================
-- Hitting Intelligence: Blast Motion swings + sensor assignments
-- =============================================================================
-- Blast is on one individual subscription, so every swing in the team-portal CSV
-- is labelled with the account owner (Bobby Wahl). Who actually swung is worked
-- out from the SENSOR serial + the time of the swing:
--
--   coach portal (/coach/blast)          nightly CSV (uais/python/blast)
--   "sensor 664 is on John Smith"  ───►  swing on 664 at 15:42  ───►  John Smith
--   hitting_intel.blast_assignments      hitting_intel.blast_swings.athlete_uuid
--
-- An assignment lasts until the coach reassigns or ends it, or the sensor goes
-- idle (no swing for hitting_intel.blast_idle_minutes() — the sensor sleeps when
-- it isn't swung). Swings after an idle gap are held as 'stale' for review, not
-- guessed. Attribution is recomputed by the loader, so fixing an assignment in
-- the coach portal re-attributes its swings on the next run.
--
-- HitTrax (one unit, one cage) will land in this schema later and act as a
-- second opinion: its profile at the time of a paired swing confirms or
-- contradicts the assignment (see docs in the project: claude/blast-ingestion.md).
--
-- Additive and idempotent: safe to run more than once, before or after a deploy.
--   npm run blast:setup
--   (= npx prisma db execute --file uais/sql/create_hitting_intel_schema.sql --schema prisma/schema.prisma)
-- Not a Prisma migration: don't run `prisma migrate dev` (this schema would look like drift).
--
-- Roll back (deletes all Blast data and assignments):
--   DROP SCHEMA hitting_intel CASCADE;
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS hitting_intel;

-- Attribution rules shared by the loader (Python) and the coach page (display text).
-- No swing on a sensor for this long = the sensor slept = the assignment is over.
CREATE OR REPLACE FUNCTION hitting_intel.blast_idle_minutes() RETURNS INT
    LANGUAGE sql IMMUTABLE AS $$ SELECT 20 $$;
-- Swings this soon BEFORE an assignment starts still count for it (the coach
-- tapped a little late, or the phone and server clocks differ slightly).
CREATE OR REPLACE FUNCTION hitting_intel.blast_grace_seconds() RETURNS INT
    LANGUAGE sql IMMUTABLE AS $$ SELECT 120 $$;

-- -----------------------------------------------------------------------------
-- blast_sensors: one row per physical sensor. Registered in the coach portal
-- (serial + the short number the coach uses) or automatically the first time a
-- serial shows up in a CSV (label = last 3 digits of the serial).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hitting_intel.blast_sensors (
    serial          TEXT PRIMARY KEY CHECK (serial ~ '^[0-9A-Za-z-]{4,32}$'),  -- CSV sensorserialnumber, e.g. 111444004664
    label           TEXT NOT NULL UNIQUE CHECK (char_length(label) BETWEEN 1 AND 20), -- what the coach sees, e.g. "664"
    active          BOOLEAN NOT NULL DEFAULT TRUE,   -- retired sensors are hidden in the coach page
    notes           TEXT,
    registered_by   TEXT,                            -- Clerk user id, or 'blast-csv'
    first_swing_at  TIMESTAMPTZ,
    last_swing_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- blast_assignments: "sensor X is on athlete Y from started_at".
-- Written only by the coach portal. Rows are never deleted: a mistake is fixed by
-- changing the athlete (logged) or voiding the row.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hitting_intel.blast_assignments (
    id                BIGSERIAL PRIMARY KEY,
    sensor_serial     TEXT NOT NULL REFERENCES hitting_intel.blast_sensors (serial) ON UPDATE CASCADE,
    athlete_uuid      VARCHAR(36) NOT NULL
                          REFERENCES analytics.d_athletes (athlete_uuid)
                          ON UPDATE CASCADE ON DELETE RESTRICT,
    started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at          TIMESTAMPTZ,                    -- NULL = still on (until reassigned / ended / idle)
    end_reason        TEXT CHECK (end_reason IN ('ended', 'reassigned', 'moved', 'day_end')),
    voided            BOOLEAN NOT NULL DEFAULT FALSE, -- entered by mistake: ignored by attribution
    assigned_by       TEXT NOT NULL,                  -- Clerk user id
    assigned_by_name  TEXT,
    ended_by          TEXT,
    ended_by_name     TEXT,
    note              TEXT CHECK (char_length(note) <= 500),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (ended_at IS NULL OR ended_at > started_at),
    CHECK ((ended_at IS NULL) = (end_reason IS NULL))
);

-- One live assignment per sensor, and one live sensor per athlete.
CREATE UNIQUE INDEX IF NOT EXISTS uq_blast_assign_open_sensor
    ON hitting_intel.blast_assignments (sensor_serial) WHERE ended_at IS NULL AND NOT voided;
CREATE UNIQUE INDEX IF NOT EXISTS uq_blast_assign_open_athlete
    ON hitting_intel.blast_assignments (athlete_uuid) WHERE ended_at IS NULL AND NOT voided;
CREATE INDEX IF NOT EXISTS idx_blast_assign_sensor_time
    ON hitting_intel.blast_assignments (sensor_serial, started_at);
CREATE INDEX IF NOT EXISTS idx_blast_assign_athlete
    ON hitting_intel.blast_assignments (athlete_uuid, started_at);
CREATE INDEX IF NOT EXISTS idx_blast_assign_updated
    ON hitting_intel.blast_assignments (updated_at);

-- Audit log: who assigned, ended, corrected or voided what.
CREATE TABLE IF NOT EXISTS hitting_intel.blast_assignment_events (
    id             BIGSERIAL PRIMARY KEY,
    assignment_id  BIGINT NOT NULL REFERENCES hitting_intel.blast_assignments (id) ON DELETE CASCADE,
    action         TEXT NOT NULL,      -- assign | end | reassign | move | change_athlete | void | day_end
    actor          TEXT NOT NULL,
    actor_name     TEXT,
    detail         JSONB,
    at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_blast_assign_events ON hitting_intel.blast_assignment_events (assignment_id);

-- -----------------------------------------------------------------------------
-- ingest_runs: one row per CSV file loaded (also how the loader skips files it
-- has already seen: same sha256 = already loaded).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hitting_intel.ingest_runs (
    id              BIGSERIAL PRIMARY KEY,
    source          TEXT NOT NULL CHECK (source IN ('blast_csv', 'blast_reattribute', 'hittrax')),
    file_name       TEXT,
    file_sha256     TEXT,
    rows_read       INTEGER NOT NULL DEFAULT 0,
    rows_inserted   INTEGER NOT NULL DEFAULT 0,
    rows_updated    INTEGER NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'flagged', 'failed')),
    checks          JSONB NOT NULL DEFAULT '{}'::jsonb,   -- attribution counts, warnings
    error           TEXT,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_hi_runs_sha ON hitting_intel.ingest_runs (file_sha256) WHERE status IN ('ok', 'flagged');
CREATE INDEX IF NOT EXISTS idx_hi_runs_started ON hitting_intel.ingest_runs (started_at DESC);

-- -----------------------------------------------------------------------------
-- blast_swings: one row per Blast capture. Re-downloads overwrite the metrics
-- (keyed on Blast's captureid) but never the attribution columns.
-- Units are as the Blast app shows them; On Plane Efficiency is stored as a
-- percent (the CSV gives a 0-1 fraction under a "%" header).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hitting_intel.blast_swings (
    capture_id                 TEXT PRIMARY KEY,           -- CSV captureid (GUID)
    swing_at                   TIMESTAMPTZ NOT NULL,       -- CSV "Swing Timestamp" (UTC)
    local_date                 DATE NOT NULL,              -- America/New_York date of swing_at
    sensor_serial              TEXT NOT NULL REFERENCES hitting_intel.blast_sensors (serial) ON UPDATE CASCADE,
    blast_user_id              BIGINT,                     -- the Blast account (not the hitter)
    blast_user_name            TEXT,
    environment                TEXT,                       -- "Environment Tag": general practice, soft toss, pitching machine, ...
    bat_nickname               TEXT,
    action_type                TEXT,                       -- "swing"
    bat_speed_mph              DOUBLE PRECISION,
    peak_hand_speed_mph        DOUBLE PRECISION,
    rotational_accel_g         DOUBLE PRECISION,
    power_kw                   DOUBLE PRECISION,
    on_plane_efficiency_pct    DOUBLE PRECISION,
    attack_angle_deg           DOUBLE PRECISION,
    vertical_bat_angle_deg     DOUBLE PRECISION,
    time_to_contact_s          DOUBLE PRECISION,
    commit_time_s              DOUBLE PRECISION,
    early_connection_deg       DOUBLE PRECISION,
    hinge_angle_at_impact_deg  DOUBLE PRECISION,
    connection_at_impact_deg   DOUBLE PRECISION,
    body_tilt_deg              DOUBLE PRECISION,
    uploaded_at                TIMESTAMPTZ,                -- CSV "Upload Timestamp" (UTC)

    -- Who swung (set by the loader's attribution pass, or by hand).
    athlete_uuid               VARCHAR(36)
                                   REFERENCES analytics.d_athletes (athlete_uuid)
                                   ON UPDATE CASCADE ON DELETE SET NULL,
    assignment_id              BIGINT REFERENCES hitting_intel.blast_assignments (id) ON DELETE SET NULL,
    attribution                TEXT NOT NULL DEFAULT 'unassigned'
                                   CHECK (attribution IN (
                                       'assigned',     -- inside a coach assignment
                                       'grace',        -- just before an assignment started
                                       'stale',        -- after an idle gap in an open assignment: held for review
                                       'unassigned',   -- no assignment covers it
                                       'manual',       -- set by hand (never recomputed)
                                       'hittrax',      -- (later) from the HitTrax profile of a paired ball
                                       'conflict'      -- (later) HitTrax profile disagrees with the assignment
                                   )),
    attribution_note           TEXT,
    attributed_at              TIMESTAMPTZ,

    raw                        JSONB NOT NULL DEFAULT '{}'::jsonb,  -- the CSV row as read
    source_file                TEXT,
    ingest_run_id              BIGINT REFERENCES hitting_intel.ingest_runs (id) ON DELETE SET NULL,
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK ((attribution IN ('assigned', 'grace', 'manual', 'hittrax')) = (athlete_uuid IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_blast_swings_sensor_time ON hitting_intel.blast_swings (sensor_serial, swing_at);
CREATE INDEX IF NOT EXISTS idx_blast_swings_athlete ON hitting_intel.blast_swings (athlete_uuid, swing_at) WHERE athlete_uuid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_blast_swings_date ON hitting_intel.blast_swings (local_date);
CREATE INDEX IF NOT EXISTS idx_blast_swings_review ON hitting_intel.blast_swings (attribution) WHERE attribution IN ('stale', 'unassigned', 'conflict');

-- Per athlete per day, for the coach suite's Hitting tab and quick checks.
CREATE OR REPLACE VIEW hitting_intel.v_blast_athlete_days AS
SELECT s.athlete_uuid,
       s.local_date,
       COUNT(*)                                   AS swings,
       ROUND(AVG(s.bat_speed_mph)::numeric, 1)    AS avg_bat_speed_mph,
       ROUND(MAX(s.bat_speed_mph)::numeric, 1)    AS max_bat_speed_mph,
       ROUND(AVG(s.attack_angle_deg)::numeric, 1) AS avg_attack_angle_deg,
       ROUND(AVG(s.time_to_contact_s)::numeric, 3) AS avg_time_to_contact_s,
       ROUND(AVG(s.rotational_accel_g)::numeric, 1) AS avg_rotational_accel_g,
       ROUND(AVG(s.on_plane_efficiency_pct)::numeric, 1) AS avg_on_plane_efficiency_pct,
       array_agg(DISTINCT s.environment) FILTER (WHERE s.environment IS NOT NULL) AS environments,
       MIN(s.swing_at) AS first_swing_at,
       MAX(s.swing_at) AS last_swing_at
  FROM hitting_intel.blast_swings s
 WHERE s.athlete_uuid IS NOT NULL
 GROUP BY s.athlete_uuid, s.local_date;
