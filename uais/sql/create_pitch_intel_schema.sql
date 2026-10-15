-- =============================================================================
-- Pitch Intelligence: Baseball Savant storage
-- =============================================================================
-- Creates the pitch_intel schema used by lib/pitch-intel/ (Savant pulls, athlete
-- links, pull audit log). Additive only: nothing in analytics.* or public.* is
-- changed. Prisma does not manage this schema (schema.prisma only lists
-- "analytics" and "public"), so `prisma db pull` ignores it.
--
-- Safe to re-run: every statement is IF NOT EXISTS.
--
-- Apply to the database Prisma's DATABASE_URL points at (the one holding
-- analytics.d_athletes). Test on a Neon branch first:
--   psql "$DATABASE_URL" -f uais/sql/create_pitch_intel_schema.sql
--
-- Roll back (deletes all Savant data):
--   DROP SCHEMA pitch_intel CASCADE;
--
-- savant_pitches columns mirror the Savant CSV header and must stay in sync with
-- lib/pitch-intel/savant/columns.ts.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS pitch_intel;

-- -----------------------------------------------------------------------------
-- athlete_source_links: one row per athlete per data source.
-- source = 'savant' (MLB ID) now; 'trackman' (PitcherId) later.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pitch_intel.athlete_source_links (
    id                  BIGSERIAL PRIMARY KEY,
    athlete_uuid        VARCHAR(36) NOT NULL
                        REFERENCES analytics.d_athletes (athlete_uuid)
                        ON UPDATE CASCADE ON DELETE RESTRICT,
    source              TEXT        NOT NULL CHECK (source IN ('savant', 'trackman')),
    source_player_id    TEXT        NOT NULL,
    source_player_name  TEXT        NOT NULL,
    throws              CHAR(1)     CHECK (throws IN ('L', 'R')),
    level               TEXT,       -- e.g. MLB, MiLB (from the source at link time)
    league              TEXT,       -- e.g. MLB, AAA; drives the FIP constant
    pull_enabled        BOOLEAN     NOT NULL DEFAULT TRUE,
    backfill_from       INTEGER,    -- first season pulled on link
    tag_overrides       JSONB       NOT NULL DEFAULT '{}'::jsonb,  -- athlete-specific pitch-tag merges
    linked_by           TEXT,
    linked_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_pulled_at      TIMESTAMPTZ,
    last_game_date      DATE,
    notes               TEXT,
    CONSTRAINT uq_source_player UNIQUE (source, source_player_id),
    CONSTRAINT uq_athlete_source UNIQUE (athlete_uuid, source)
);

CREATE INDEX IF NOT EXISTS idx_asl_athlete ON pitch_intel.athlete_source_links (athlete_uuid);

-- -----------------------------------------------------------------------------
-- pull_runs: audit log, one row per pull attempt.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pitch_intel.pull_runs (
    id              BIGSERIAL PRIMARY KEY,
    link_id         BIGINT      REFERENCES pitch_intel.athlete_source_links (id) ON DELETE SET NULL,
    athlete_uuid    VARCHAR(36),
    trigger         TEXT        NOT NULL CHECK (trigger IN ('nightly', 'backfill', 'cli', 'ui', 'csv')),
    date_from       DATE,
    date_to         DATE,
    rows_fetched    INTEGER     NOT NULL DEFAULT 0,
    rows_inserted   INTEGER     NOT NULL DEFAULT 0,
    rows_updated    INTEGER     NOT NULL DEFAULT 0,
    status          TEXT        NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running', 'ok', 'flagged', 'failed')),
    checks          JSONB       NOT NULL DEFAULT '{}'::jsonb,
    error           TEXT,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pull_runs_link ON pitch_intel.pull_runs (link_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_pull_runs_started ON pitch_intel.pull_runs (started_at DESC);

-- -----------------------------------------------------------------------------
-- savant_pitches: one row per pitch, Savant column names unchanged.
-- Key (game_pk, at_bat_number, pitch_number) is unique per pitch; re-pulls
-- overwrite on it so Statcast's corrections replace old values.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pitch_intel.savant_pitches (
    pitch_type                               TEXT,
    game_date                                DATE NOT NULL,
    release_speed                            DOUBLE PRECISION,
    release_pos_x                            DOUBLE PRECISION,
    release_pos_z                            DOUBLE PRECISION,
    player_name                              TEXT,
    batter                                   INTEGER,
    pitcher                                  INTEGER NOT NULL,
    events                                   TEXT,
    description                              TEXT,
    spin_dir                                 DOUBLE PRECISION,
    spin_rate_deprecated                     DOUBLE PRECISION,
    break_angle_deprecated                   DOUBLE PRECISION,
    break_length_deprecated                  DOUBLE PRECISION,
    zone                                     DOUBLE PRECISION,
    des                                      TEXT,
    game_type                                TEXT,
    stand                                    TEXT,
    p_throws                                 TEXT,
    home_team                                TEXT,
    away_team                                TEXT,
    type                                     TEXT,
    hit_location                             DOUBLE PRECISION,
    bb_type                                  TEXT,
    balls                                    DOUBLE PRECISION,
    strikes                                  DOUBLE PRECISION,
    game_year                                DOUBLE PRECISION,
    pfx_x                                    DOUBLE PRECISION,
    pfx_z                                    DOUBLE PRECISION,
    plate_x                                  DOUBLE PRECISION,
    plate_z                                  DOUBLE PRECISION,
    on_3b                                    INTEGER,
    on_2b                                    INTEGER,
    on_1b                                    INTEGER,
    outs_when_up                             DOUBLE PRECISION,
    inning                                   DOUBLE PRECISION,
    inning_topbot                            TEXT,
    hc_x                                     DOUBLE PRECISION,
    hc_y                                     DOUBLE PRECISION,
    tfs_deprecated                           TEXT,
    tfs_zulu_deprecated                      TEXT,
    fielder_2                                INTEGER,
    umpire                                   TEXT,
    sv_id                                    TEXT,
    vx0                                      DOUBLE PRECISION,
    vy0                                      DOUBLE PRECISION,
    vz0                                      DOUBLE PRECISION,
    ax                                       DOUBLE PRECISION,
    ay                                       DOUBLE PRECISION,
    az                                       DOUBLE PRECISION,
    sz_top                                   DOUBLE PRECISION,
    sz_bot                                   DOUBLE PRECISION,
    hit_distance_sc                          DOUBLE PRECISION,
    launch_speed                             DOUBLE PRECISION,
    launch_angle                             DOUBLE PRECISION,
    effective_speed                          DOUBLE PRECISION,
    release_spin_rate                        DOUBLE PRECISION,
    release_extension                        DOUBLE PRECISION,
    game_pk                                  BIGINT NOT NULL,
    fielder_3                                INTEGER,
    fielder_4                                INTEGER,
    fielder_5                                INTEGER,
    fielder_6                                INTEGER,
    fielder_7                                INTEGER,
    fielder_8                                INTEGER,
    fielder_9                                INTEGER,
    release_pos_y                            DOUBLE PRECISION,
    estimated_ba_using_speedangle            DOUBLE PRECISION,
    estimated_woba_using_speedangle          DOUBLE PRECISION,
    woba_value                               DOUBLE PRECISION,
    woba_denom                               DOUBLE PRECISION,
    babip_value                              DOUBLE PRECISION,
    iso_value                                DOUBLE PRECISION,
    launch_speed_angle                       DOUBLE PRECISION,
    at_bat_number                            INTEGER NOT NULL,
    pitch_number                             INTEGER NOT NULL,
    pitch_name                               TEXT,
    home_score                               DOUBLE PRECISION,
    away_score                               DOUBLE PRECISION,
    bat_score                                DOUBLE PRECISION,
    fld_score                                DOUBLE PRECISION,
    post_away_score                          DOUBLE PRECISION,
    post_home_score                          DOUBLE PRECISION,
    post_bat_score                           DOUBLE PRECISION,
    post_fld_score                           DOUBLE PRECISION,
    if_fielding_alignment                    TEXT,
    of_fielding_alignment                    TEXT,
    spin_axis                                DOUBLE PRECISION,
    delta_home_win_exp                       DOUBLE PRECISION,
    delta_run_exp                            DOUBLE PRECISION,
    bat_speed                                DOUBLE PRECISION,
    swing_length                             DOUBLE PRECISION,
    estimated_slg_using_speedangle           DOUBLE PRECISION,
    delta_pitcher_run_exp                    DOUBLE PRECISION,
    hyper_speed                              DOUBLE PRECISION,
    home_score_diff                          DOUBLE PRECISION,
    bat_score_diff                           DOUBLE PRECISION,
    home_win_exp                             DOUBLE PRECISION,
    bat_win_exp                              DOUBLE PRECISION,
    age_pit_legacy                           DOUBLE PRECISION,
    age_bat_legacy                           DOUBLE PRECISION,
    age_pit                                  DOUBLE PRECISION,
    age_bat                                  DOUBLE PRECISION,
    n_thruorder_pitcher                      DOUBLE PRECISION,
    n_priorpa_thisgame_player_at_bat         DOUBLE PRECISION,
    pitcher_days_since_prev_game             DOUBLE PRECISION,
    batter_days_since_prev_game              DOUBLE PRECISION,
    pitcher_days_until_next_game             DOUBLE PRECISION,
    batter_days_until_next_game              DOUBLE PRECISION,
    api_break_z_with_gravity                 DOUBLE PRECISION,
    api_break_x_arm                          DOUBLE PRECISION,
    api_break_x_batter_in                    DOUBLE PRECISION,
    arm_angle                                DOUBLE PRECISION,
    attack_angle                             DOUBLE PRECISION,
    attack_direction                         DOUBLE PRECISION,
    swing_path_tilt                          DOUBLE PRECISION,
    intercept_ball_minus_batter_pos_x_inches DOUBLE PRECISION,
    intercept_ball_minus_batter_pos_y_inches DOUBLE PRECISION,

    -- bookkeeping (not from Savant)
    athlete_uuid  VARCHAR(36) NOT NULL
                  REFERENCES analytics.d_athletes (athlete_uuid)
                  ON UPDATE CASCADE ON DELETE RESTRICT,
    link_id       BIGINT      NOT NULL
                  REFERENCES pitch_intel.athlete_source_links (id) ON DELETE CASCADE,
    source_level  TEXT        NOT NULL CHECK (source_level IN ('mlb', 'minors', 'csv')),
    raw_extra     JSONB       NOT NULL DEFAULT '{}'::jsonb,  -- CSV columns not listed above
    pull_run_id   BIGINT,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (game_pk, at_bat_number, pitch_number)
);

CREATE INDEX IF NOT EXISTS idx_sp_athlete_date ON pitch_intel.savant_pitches (athlete_uuid, game_date);
CREATE INDEX IF NOT EXISTS idx_sp_pitcher_date ON pitch_intel.savant_pitches (pitcher, game_date);
CREATE INDEX IF NOT EXISTS idx_sp_link ON pitch_intel.savant_pitches (link_id);

-- =============================================================================
-- Uploads: Trackman files, hand-downloaded Savant CSVs, screenshot reports
-- (added for the Pitch Intelligence upload page; safe to re-run)
-- =============================================================================

-- One Savant ID per athlete, but an athlete may have several Trackman IDs
-- (different Trackman systems assign their own PitcherId).
ALTER TABLE pitch_intel.athlete_source_links DROP CONSTRAINT IF EXISTS uq_athlete_source;
CREATE UNIQUE INDEX IF NOT EXISTS uq_athlete_savant_link
    ON pitch_intel.athlete_source_links (athlete_uuid) WHERE source = 'savant';

-- uploads: audit log, one row per saved file
CREATE TABLE IF NOT EXISTS pitch_intel.uploads (
    id            BIGSERIAL PRIMARY KEY,
    kind          TEXT        NOT NULL CHECK (kind IN ('savant_csv', 'trackman', 'screenshot')),
    filename      TEXT,
    uploaded_by   TEXT,
    rows_saved    INTEGER     NOT NULL DEFAULT 0,
    summary       JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- trackman_pitches: one row per pitch from a Trackman export (game or bullpen).
-- Core values are typed for queries; every original column is kept in raw.
CREATE TABLE IF NOT EXISTS pitch_intel.trackman_pitches (
    pitch_uid          TEXT PRIMARY KEY,   -- PitchUID, else PlayID, else a hash of pitcher/date/time/pitch no.
    athlete_uuid       VARCHAR(36) NOT NULL
                       REFERENCES analytics.d_athletes (athlete_uuid)
                       ON UPDATE CASCADE ON DELETE RESTRICT,
    link_id            BIGINT      NOT NULL
                       REFERENCES pitch_intel.athlete_source_links (id) ON DELETE CASCADE,
    session_date       DATE        NOT NULL,
    session_type       TEXT        NOT NULL CHECK (session_type IN ('game', 'bullpen')),
    pitch_no           INTEGER,
    pitch_time         TEXT,
    pitcher_name       TEXT,
    pitcher_id         TEXT,
    pitcher_throws     CHAR(1),
    tagged_pitch_type  TEXT,               -- as tagged in the file (TaggedPitchType / AutoPitchType)
    auto_pitch_type    TEXT,               -- our classifier's code
    pitch_type         TEXT        NOT NULL, -- final app code (FF, SI, FC, SL, ST, CU, CH, FS, OTHER)
    rel_speed          DOUBLE PRECISION,
    spin_rate          DOUBLE PRECISION,
    spin_axis          DOUBLE PRECISION,
    ivb                DOUBLE PRECISION,   -- InducedVertBreak, in
    hb                 DOUBLE PRECISION,   -- HorzBreak, in, Trackman sign (+ = pitcher's right)
    rel_height         DOUBLE PRECISION,
    rel_side           DOUBLE PRECISION,
    extension          DOUBLE PRECISION,
    vaa                DOUBLE PRECISION,
    haa                DOUBLE PRECISION,
    plate_loc_height   DOUBLE PRECISION,
    plate_loc_side     DOUBLE PRECISION,
    spin_efficiency    DOUBLE PRECISION,   -- percent, 0-100
    pitch_call         TEXT,
    kor_bb             TEXT,
    play_result        TEXT,
    batter_side        TEXT,
    balls              INTEGER,
    strikes            INTEGER,
    exit_speed         DOUBLE PRECISION,
    raw                JSONB       NOT NULL,
    source_file        TEXT,
    upload_id          BIGINT REFERENCES pitch_intel.uploads (id) ON DELETE SET NULL,
    first_seen_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tp_athlete_date ON pitch_intel.trackman_pitches (athlete_uuid, session_date);
CREATE INDEX IF NOT EXISTS idx_tp_link ON pitch_intel.trackman_pitches (link_id);

-- aggregate_reports: per-pitch-type averages read from a screenshot or other summary
CREATE TABLE IF NOT EXISTS pitch_intel.aggregate_reports (
    id             BIGSERIAL PRIMARY KEY,
    athlete_uuid   VARCHAR(36) NOT NULL
                   REFERENCES analytics.d_athletes (athlete_uuid)
                   ON UPDATE CASCADE ON DELETE RESTRICT,
    source         TEXT        NOT NULL CHECK (source IN ('trackman_summary', 'savant', 'claw', 'rapsodo', 'other')),
    report_date    DATE,
    season         INTEGER,
    level          TEXT,
    throws         CHAR(1)     CHECK (throws IN ('L', 'R')),
    title          TEXT,
    notes          TEXT,
    image_r2_key   TEXT,
    extracted      JSONB       NOT NULL DEFAULT '{}'::jsonb,   -- what the AI read, before review
    upload_id      BIGINT REFERENCES pitch_intel.uploads (id) ON DELETE SET NULL,
    created_by     TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ar_athlete ON pitch_intel.aggregate_reports (athlete_uuid, report_date);

CREATE TABLE IF NOT EXISTS pitch_intel.aggregate_pitch_rows (
    id               BIGSERIAL PRIMARY KEY,
    report_id        BIGINT NOT NULL REFERENCES pitch_intel.aggregate_reports (id) ON DELETE CASCADE,
    pitch_type       TEXT   NOT NULL,      -- app code (FF, SI, FC, SL, ST, CU, CH, FS, OTHER)
    pitch_count      INTEGER,
    usage_pct        DOUBLE PRECISION,
    velo             DOUBLE PRECISION,
    velo_max         DOUBLE PRECISION,
    spin_rate        DOUBLE PRECISION,
    ivb              DOUBLE PRECISION,
    hb_arm           DOUBLE PRECISION,     -- in, arm-side positive (normalized from the source's convention)
    extension        DOUBLE PRECISION,
    rel_height       DOUBLE PRECISION,
    rel_side         DOUBLE PRECISION,
    vaa              DOUBLE PRECISION,
    spin_efficiency  DOUBLE PRECISION,     -- percent
    whiff_pct        DOUBLE PRECISION,
    extra            JSONB  NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_apr_report ON pitch_intel.aggregate_pitch_rows (report_id);

-- =============================================================================
-- TrackMan Team Portal pulls (uais/python/trackman/)
-- Every TrackMan player is stored, whether or not they match an athlete.
-- Players with pitch data who match nobody are created in analytics.d_athletes
-- with source_system = 'trackman' (their point of origin) by the loader.
-- =============================================================================

-- trackman_players: one row per TrackMan player ID (the portal's profile).
CREATE TABLE IF NOT EXISTS pitch_intel.trackman_players (
    player_id      TEXT PRIMARY KEY,          -- TrackMan 10-digit ID, or an MLB ID
    id_source      TEXT        NOT NULL DEFAULT 'trackman' CHECK (id_source IN ('trackman', 'mlb')),
    name           TEXT        NOT NULL,
    date_of_birth  DATE,
    team           TEXT,
    jersey_number  TEXT,
    throws         CHAR(1)     CHECK (throws IN ('L', 'R')),
    throws_source  TEXT,                      -- 'inferred' (release side + FB break) or 'manual'
    athlete_uuid   VARCHAR(36)
                   REFERENCES analytics.d_athletes (athlete_uuid)
                   ON UPDATE CASCADE ON DELETE SET NULL,
    match_status   TEXT        NOT NULL DEFAULT 'unmatched'
                   CHECK (match_status IN ('unmatched', 'linked', 'matched_exact', 'matched_fuzzy', 'created', 'conflict', 'manual')),
    match_note     TEXT,
    raw            JSONB       NOT NULL DEFAULT '{}'::jsonb,
    first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tmp_athlete ON pitch_intel.trackman_players (athlete_uuid);
CREATE INDEX IF NOT EXISTS idx_tmp_status ON pitch_intel.trackman_players (match_status);

-- trackman_sessions: one row per portal session (the /sessions Id GUID).
CREATE TABLE IF NOT EXISTS pitch_intel.trackman_sessions (
    session_id      TEXT PRIMARY KEY,
    session_type    TEXT,                     -- e.g. Pitching
    local_date      DATE,
    local_datetime  TEXT,                     -- as the portal shows it
    utc_datetime    TIMESTAMPTZ,
    radar_serial    TEXT,
    player_count    INTEGER,
    plays           INTEGER,                  -- pitches the portal says the session has (all players)
    pitches_pulled  INTEGER     NOT NULL DEFAULT 0,
    raw             JSONB       NOT NULL DEFAULT '{}'::jsonb,
    pulled_at       TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tms_date ON pitch_intel.trackman_sessions (local_date);

-- trackman_pitches also holds portal pitches (data_source = 'portal').
-- Pitches from a player who couldn't be matched safely (a name/DOB conflict)
-- are kept with athlete_uuid NULL until someone links them.
ALTER TABLE pitch_intel.trackman_pitches ALTER COLUMN athlete_uuid DROP NOT NULL;
ALTER TABLE pitch_intel.trackman_pitches ALTER COLUMN link_id DROP NOT NULL;
ALTER TABLE pitch_intel.trackman_pitches ADD COLUMN IF NOT EXISTS data_source TEXT NOT NULL DEFAULT 'file' CHECK (data_source IN ('file', 'portal'));
ALTER TABLE pitch_intel.trackman_pitches ADD COLUMN IF NOT EXISTS tm_session_id TEXT;
ALTER TABLE pitch_intel.trackman_pitches ADD COLUMN IF NOT EXISTS tm_player_id TEXT;
ALTER TABLE pitch_intel.trackman_pitches ADD COLUMN IF NOT EXISTS gyro DOUBLE PRECISION;
ALTER TABLE pitch_intel.trackman_pitches ADD COLUMN IF NOT EXISTS tilt TEXT;
ALTER TABLE pitch_intel.trackman_pitches ADD COLUMN IF NOT EXISTS measured_tilt TEXT;
ALTER TABLE pitch_intel.trackman_pitches ADD COLUMN IF NOT EXISTS zone_location TEXT;

CREATE INDEX IF NOT EXISTS idx_tp_tm_player ON pitch_intel.trackman_pitches (tm_player_id);
CREATE INDEX IF NOT EXISTS idx_tp_tm_session ON pitch_intel.trackman_pitches (tm_session_id);

ALTER TABLE pitch_intel.uploads DROP CONSTRAINT IF EXISTS uploads_kind_check;
ALTER TABLE pitch_intel.uploads ADD CONSTRAINT uploads_kind_check CHECK (kind IN ('savant_csv', 'trackman', 'trackman_portal', 'screenshot'));

-- Portal players carry several IDs ("TMBB-1000069193", "MLB-809790", "AMA-…", "PG-…");
-- player_id is the one the portal displays (MLB, else first TMBB, else first AMA).
ALTER TABLE pitch_intel.trackman_players ADD COLUMN IF NOT EXISTS portal_id TEXT;
ALTER TABLE pitch_intel.trackman_players ADD COLUMN IF NOT EXISTS foreign_ids TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE pitch_intel.trackman_players ADD COLUMN IF NOT EXISTS bats TEXT;
