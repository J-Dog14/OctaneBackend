-- Client Hub (coach suite → Client Hub tab, /coach/clients).
--
-- One row per client EVER on an 8ctane program (coach.hub_clients), with every program
-- they have run as a period underneath (coach.hub_client_programs). A client who comes
-- back a year later gets a new period on the same row, so notes, assessment checks and
-- history stay attached. Status is derived from the periods (active / expired) and a
-- coach can override it (active / paused / expired).
--
-- Program dates come from the 8ctane App DB snapshot (app_db_snapshot.*, refreshed
-- nightly / by the Sync database button) via lib/client-hub/appSync.ts. Coach edits to
-- dates are stored as *_override columns and NEVER written back to the 8ctane app.
--
-- Additive and idempotent: safe to run more than once, before or after a deploy.
--   npx prisma db execute --file uais/sql/create_coach_client_hub.sql --schema prisma/schema.prisma

CREATE SCHEMA IF NOT EXISTS coach;

-- ---------------------------------------------------------------------------
-- Clients
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS coach.hub_clients (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Warehouse athlete. Created by the sync (source_system 'octane_app') when the
    -- client has never been assessed; NULL only while a possible duplicate awaits review.
    athlete_uuid         VARCHAR(36) UNIQUE REFERENCES analytics.d_athletes(athlete_uuid)
                             ON UPDATE CASCADE ON DELETE SET NULL,
    app_user_id          TEXT UNIQUE,              -- 8ctane app "User".id
    name                 TEXT NOT NULL,
    email                TEXT,
    link_method          TEXT CHECK (link_method IN ('app_db_uuid', 'email', 'name', 'created', 'coach')),
    link_review          BOOLEAN NOT NULL DEFAULT false,  -- close-but-not-exact name match: a coach picks
    link_candidates      JSONB,                     -- [{athleteUuid, name, score}] for the picker

    -- Status: auto from the program periods, optional coach override.
    auto_status          TEXT NOT NULL DEFAULT 'expired' CHECK (auto_status IN ('active', 'expired')),
    status_override      TEXT CHECK (status_override IN ('active', 'paused', 'expired')),
    status               TEXT GENERATED ALWAYS AS (COALESCE(status_override, auto_status)) STORED,
    is_active            BOOLEAN GENERATED ALWAYS AS (COALESCE(status_override, auto_status) = 'active') STORED,
    status_changed_at    TIMESTAMPTZ,

    -- Coaching CRM fields (edited in the hub).
    phase                TEXT,
    schedule_note        TEXT,
    coach_name           TEXT,
    owner_clerk_user_id  TEXT,                      -- "My clients"
    owner_name           TEXT,
    throws               TEXT CHECK (throws IN ('R', 'L')),
    position             TEXT,
    team                 TEXT,
    contract_duration    TEXT,
    contract_start       DATE,
    contract_end         DATE,
    contract_status      TEXT NOT NULL DEFAULT 'NOT_SENT' CHECK (contract_status IN ('SIGNED', 'SENT', 'NOT_SENT')),
    onb_assessment       BOOLEAN NOT NULL DEFAULT false, -- manual ticks; the hub also ticks these
    onb_3d               BOOLEAN NOT NULL DEFAULT false, -- automatically from warehouse sessions
    onb_review           BOOLEAN NOT NULL DEFAULT false,
    last_contacted       DATE,
    next_assessment_due  DATE,
    needs_review         BOOLEAN NOT NULL DEFAULT false,

    -- When plyos / lifts / delivery were last changed: picked up from the app (forward only) or typed.
    upd_plyos            DATE,
    upd_plyos_source     TEXT CHECK (upd_plyos_source IN ('app', 'coach')),
    upd_lifts            DATE,
    upd_lifts_source     TEXT CHECK (upd_lifts_source IN ('app', 'coach')),
    upd_delivery         DATE,
    upd_delivery_source  TEXT CHECK (upd_delivery_source IN ('app', 'coach')),

    -- Cache written by the sync.
    week_done            INT,
    week_trackable       INT,
    last_tick            DATE,
    last_scheduled       DATE,                      -- last day with work in a current period
    synced_at            TIMESTAMPTZ,

    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by           TEXT
);

CREATE INDEX IF NOT EXISTS idx_hub_clients_status ON coach.hub_clients (status);
CREATE INDEX IF NOT EXISTS idx_hub_clients_owner ON coach.hub_clients (owner_clerk_user_id);

-- ---------------------------------------------------------------------------
-- Program periods (one per 8ctane program, plus any a coach adds by hand)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS coach.hub_client_programs (
    id               BIGSERIAL PRIMARY KEY,
    client_id        UUID NOT NULL REFERENCES coach.hub_clients(id) ON DELETE CASCADE,
    source           TEXT NOT NULL DEFAULT 'app' CHECK (source IN ('app', 'coach')),
    app_program_id   INTEGER UNIQUE,                -- app_db_snapshot."Program".id; NULL for coach periods
    name             TEXT,
    program_type     TEXT,                          -- REMOTE / HYBRID / IN_HOUSE
    coach_names      TEXT[] NOT NULL DEFAULT '{}',

    -- As the 8ctane app has them (refreshed every sync, never edited by coaches).
    app_start        DATE,
    app_end          DATE,
    app_archived     BOOLEAN NOT NULL DEFAULT false,
    app_first_day    DATE,                          -- first / last scheduled day with work
    app_last_day     DATE,
    removed_in_app   BOOLEAN NOT NULL DEFAULT false, -- program no longer in the snapshot

    -- Coach edits. Effective dates = override when set, else the app's.
    start_override   DATE,
    end_override     DATE,
    start_date       DATE GENERATED ALWAYS AS (COALESCE(start_override, app_start)) STORED,
    end_date         DATE GENERATED ALWAYS AS (COALESCE(end_override, app_end)) STORED,
    span_days        INT  GENERATED ALWAYS AS (COALESCE(end_override, app_end) - COALESCE(start_override, app_start) + 1) STORED,
    note             TEXT,

    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by       TEXT
);

CREATE INDEX IF NOT EXISTS idx_hub_programs_client ON coach.hub_client_programs (client_id, end_date DESC);

-- ---------------------------------------------------------------------------
-- Assessment tracking (coach entries; sessions in the warehouse are read live)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS coach.hub_assessment_checks (
    id           BIGSERIAL PRIMARY KEY,
    client_id    UUID NOT NULL REFERENCES coach.hub_clients(id) ON DELETE CASCADE,
    program_id   BIGINT REFERENCES coach.hub_client_programs(id) ON DELETE SET NULL,
    kind         TEXT NOT NULL CHECK (kind IN ('athletic_screen', 'mobility', 'pitching_3d', 'hitting_3d', 'arm_action',
                                               'pro_sup', 'proteus', 'readiness', 'curveball', 'other')),
    status       TEXT NOT NULL CHECK (status IN ('scheduled', 'done', 'waived')),
    check_date   DATE NOT NULL,
    note         TEXT,
    created_by   TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hub_checks_client ON coach.hub_assessment_checks (client_id, check_date DESC);

-- ---------------------------------------------------------------------------
-- Coach log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS coach.hub_client_notes (
    id                    BIGSERIAL PRIMARY KEY,
    client_id             UUID NOT NULL REFERENCES coach.hub_clients(id) ON DELETE CASCADE,
    note_date             DATE NOT NULL,
    body                  TEXT NOT NULL,
    goals                 TEXT,
    link                  TEXT,
    author_clerk_user_id  TEXT,
    author_name           TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hub_notes_client ON coach.hub_client_notes (client_id, note_date DESC);

-- ---------------------------------------------------------------------------
-- History of every coach edit and sync-driven change (who / when / what)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS coach.hub_client_events (
    id          BIGSERIAL PRIMARY KEY,
    client_id   UUID NOT NULL REFERENCES coach.hub_clients(id) ON DELETE CASCADE,
    at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor       TEXT,               -- Clerk user id, or 'sync'
    actor_name  TEXT,
    action      TEXT NOT NULL,      -- e.g. 'update', 'status', 'period.update', 'period.new', 'link'
    detail      JSONB
);

CREATE INDEX IF NOT EXISTS idx_hub_events_client ON coach.hub_client_events (client_id, at DESC);

-- ---------------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------------

-- "Today" for the gym (Railway runs in UTC).
CREATE OR REPLACE FUNCTION coach.hub_today() RETURNS DATE
    LANGUAGE sql STABLE AS $$ SELECT (now() AT TIME ZONE 'America/New_York')::date $$;

-- A period is current when it hasn't ended. Archived/removed app programs only count
-- when a coach has extended them (end_override) or the period was added by a coach.
CREATE OR REPLACE FUNCTION coach.hub_period_is_current(p coach.hub_client_programs, today DATE) RETURNS BOOLEAN
    LANGUAGE sql IMMUTABLE AS $$
    SELECT (p.end_date IS NULL OR p.end_date >= today)
       AND (p.source = 'coach' OR p.end_override IS NOT NULL OR (NOT p.app_archived AND NOT p.removed_in_app))
$$;

-- Recompute auto_status (one client, or all when NULL). Returns the number of rows changed.
CREATE OR REPLACE FUNCTION coach.hub_refresh_status(p_client UUID DEFAULT NULL) RETURNS INT
    LANGUAGE plpgsql AS $$
DECLARE n INT;
BEGIN
    WITH want AS (
        SELECT c.id,
               CASE WHEN EXISTS (SELECT 1 FROM coach.hub_client_programs p
                                 WHERE p.client_id = c.id AND coach.hub_period_is_current(p, coach.hub_today()))
                    THEN 'active' ELSE 'expired' END AS s
        FROM coach.hub_clients c
        WHERE p_client IS NULL OR c.id = p_client
    )
    UPDATE coach.hub_clients c
       SET auto_status = w.s,
           status_changed_at = CASE WHEN c.status_override IS NULL THEN now() ELSE c.status_changed_at END
      FROM want w
     WHERE c.id = w.id AND c.auto_status <> w.s;
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END $$;

-- Clients with their current (or most recent) period. "Current" = the current period
-- ending last; with none current, the period that ended most recently.
CREATE OR REPLACE VIEW coach.v_hub_clients AS
SELECT c.*,
       cur.id            AS period_id,
       cur.name          AS program_name,
       cur.program_type  AS program_type,
       cur.coach_names   AS program_coaches,
       cur.start_date    AS period_start,
       cur.end_date      AS period_end,
       cur.span_days     AS period_span_days,
       cur.end_date - coach.hub_today() AS period_days_left,
       stats.period_count,
       stats.first_start AS client_since
FROM coach.hub_clients c
LEFT JOIN LATERAL (
    SELECT p.* FROM coach.hub_client_programs p
    WHERE p.client_id = c.id
    ORDER BY coach.hub_period_is_current(p, coach.hub_today()) DESC, p.end_date DESC NULLS FIRST, p.start_date DESC NULLS LAST
    LIMIT 1
) cur ON true
LEFT JOIN LATERAL (
    SELECT count(*)::int AS period_count, min(p.start_date) AS first_start
    FROM coach.hub_client_programs p WHERE p.client_id = c.id
) stats ON true;
