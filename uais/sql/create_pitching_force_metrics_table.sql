-- create_pitching_force_metrics_table.sql
--
-- Creates the f_pitching_force_metrics table (and indexes).
-- Idempotent — safe to run multiple times.
-- Also called automatically by force_db.R on each pipeline run.

CREATE TABLE IF NOT EXISTS public.f_pitching_force_metrics (
  id                              SERIAL PRIMARY KEY,
  athlete_uuid                    VARCHAR(36) NOT NULL,
  session_date                    DATE NOT NULL,
  source_system                   VARCHAR(50) NOT NULL DEFAULT 'pitching',
  source_athlete_id               VARCHAR(100),
  owner_filename                  TEXT,
  trial_index                     INTEGER NOT NULL,
  handedness                      VARCHAR(20),
  body_weight_kg                  NUMERIC,
  body_weight_n                   NUMERIC,

  -- Plate detection
  lead_plate_id                   INTEGER,
  drive_plate_id                  INTEGER,
  braking_sign                    SMALLINT,
  axis_braking                    VARCHAR(2),
  axis_vertical                   VARCHAR(2),
  axis_mediolateral               VARCHAR(2),

  -- Event frames (1-based indices into frames array)
  fc_frame                        INTEGER,
  br_frame                        INTEGER,
  mer_frame                       INTEGER,
  fc_time_s                       NUMERIC,
  br_time_s                       NUMERIC,
  mer_time_s                      NUMERIC,
  fc_to_br_duration_s             NUMERIC,

  -- Lead leg: peak magnitudes
  lead_peak_vertical_n            NUMERIC,
  lead_peak_vertical_bw           NUMERIC,
  lead_peak_vertical_time_s       NUMERIC,
  lead_peak_vertical_pct_fc_br    NUMERIC,
  lead_peak_braking_n             NUMERIC,
  lead_peak_braking_bw            NUMERIC,
  lead_peak_braking_time_s        NUMERIC,
  lead_peak_braking_pct_fc_br     NUMERIC,
  lead_peak_resultant_n           NUMERIC,
  lead_peak_resultant_bw          NUMERIC,
  lead_peak_resultant_time_s      NUMERIC,
  lead_peak_resultant_pct_fc_br   NUMERIC,

  -- Lead leg: synchrony / timing
  peak_v_to_peak_b_lag_ms         NUMERIC,
  peaks_synced_flag               BOOLEAN,
  peaks_before_mer_flag           BOOLEAN,
  single_impulse_flag             BOOLEAN,
  impulse_peak_count              INTEGER,

  -- Lead leg: rate of force development
  lead_rfd_vertical_n_per_s       NUMERIC,
  lead_rfd_vertical_bw_per_s      NUMERIC,
  lead_rfd_braking_n_per_s        NUMERIC,
  lead_rfd_braking_bw_per_s       NUMERIC,
  lead_time_to_peak_fz_ms         NUMERIC,

  -- Lead leg: impulse (N*s and BW*s)
  lead_impulse_v_fc_to_br_ns      NUMERIC,
  lead_impulse_v_fc_to_br_bws     NUMERIC,
  lead_impulse_v_fc_to_mer_ns     NUMERIC,
  lead_impulse_v_fc_to_mer_bws    NUMERIC,
  lead_impulse_v_into_ball_ns     NUMERIC,
  lead_impulse_v_into_ball_bws    NUMERIC,
  lead_impulse_b_fc_to_br_ns      NUMERIC,
  lead_impulse_b_fc_to_br_bws     NUMERIC,
  lead_impulse_b_fc_to_mer_ns     NUMERIC,
  lead_impulse_b_fc_to_mer_bws    NUMERIC,
  lead_impulse_b_into_ball_ns     NUMERIC,
  lead_impulse_b_into_ball_bws    NUMERIC,
  lead_impulse_resultant_fc_to_br_ns    NUMERIC,
  lead_impulse_resultant_into_ball_ns   NUMERIC,
  lead_impulse_resultant_into_ball_bws  NUMERIC,

  -- Lead leg: instantaneous values
  lead_fz_at_50pct_bw             NUMERIC,
  lead_fz_at_midpoint_bw          NUMERIC,
  lead_fy_at_midpoint_bw          NUMERIC,
  lead_resultant_at_midpoint_bw   NUMERIC,

  -- Drive leg
  drive_peak_vertical_n           NUMERIC,
  drive_peak_vertical_bw          NUMERIC,
  drive_peak_vertical_time_s      NUMERIC,
  drive_peak_braking_n            NUMERIC,
  drive_peak_braking_bw           NUMERIC,
  drive_peak_braking_time_s       NUMERIC,
  drive_unload_time_s             NUMERIC,
  drive_to_lead_handoff_ms        NUMERIC,

  -- Symmetry / dual-leg
  total_vertical_peak_n           NUMERIC,
  virtual_plate_xcheck_pct        NUMERIC,

  -- Quality flags
  qa_flags                        TEXT[],
  qa_warnings_json                JSONB,

  processor_version               VARCHAR(20) NOT NULL,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT f_pitching_force_metrics_fkey
    FOREIGN KEY (athlete_uuid) REFERENCES analytics.d_athletes(athlete_uuid) ON DELETE CASCADE,
  CONSTRAINT f_pitching_force_metrics_unique
    UNIQUE (athlete_uuid, session_date, trial_index)
);

CREATE INDEX IF NOT EXISTS idx_force_metrics_athlete_date
  ON public.f_pitching_force_metrics (athlete_uuid, session_date);

CREATE INDEX IF NOT EXISTS idx_force_metrics_owner
  ON public.f_pitching_force_metrics (owner_filename);
