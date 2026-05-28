# force/force_db.R
#
# Database layer for f_pitching_force_metrics.
# Exported: ensure_force_metrics_table(con), upsert_force_metrics(con, row)

# Create the table if it doesn't exist. Safe to call on every run.
ensure_force_metrics_table <- function(con) {
  DBI::dbExecute(con, "
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

      -- Event frames (1-based R indices stored as-is)
      fc_frame                        INTEGER,
      br_frame                        INTEGER,
      mer_frame                       INTEGER,
      fc_time_s                       NUMERIC,
      br_time_s                       NUMERIC,
      mer_time_s                      NUMERIC,
      initial_contact_frame           INTEGER,
      initial_contact_time_s          NUMERIC,
      foot_loading_time_ms            NUMERIC,
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

      -- Lead leg: impulse (N*s)
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

      -- Symmetry
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
    )
  ")

  DBI::dbExecute(con, "
    CREATE INDEX IF NOT EXISTS idx_force_metrics_athlete_date
      ON public.f_pitching_force_metrics (athlete_uuid, session_date)
  ")
  DBI::dbExecute(con, "
    CREATE INDEX IF NOT EXISTS idx_force_metrics_owner
      ON public.f_pitching_force_metrics (owner_filename)
  ")
  invisible(NULL)
}

# Upsert one metrics row. `row` is a named list with keys matching column names.
# Uses DBI::dbQuoteLiteral inline literals to avoid the extended query protocol
# (prepared statements) that pgBouncer/Neon rejects.
upsert_force_metrics <- function(con, row) {

  # Inline SQL literal helper — same pattern as .sql_lit() in pitching_processing.R
  .L <- function(x) {
    if (is.null(x) || (length(x) == 1 && is.na(x))) return("NULL")
    as.character(DBI::dbQuoteLiteral(con, x))
  }

  # Flatten qa_flags to a PostgreSQL array literal string
  flags_str <- if (length(row$qa_flags) > 0) {
    paste0("ARRAY[", paste(paste0("'", gsub("'", "''", row$qa_flags), "'"), collapse = ","), "]::text[]")
  } else {
    "ARRAY[]::text[]"
  }

  # qa_warnings_json as an inline JSONB literal
  warnings_json_str <- if (!is.null(row$qa_warnings_json)) {
    as.character(jsonlite::toJSON(row$qa_warnings_json, auto_unbox = TRUE))
  } else {
    "null"
  }

  sql <- paste0("
    INSERT INTO public.f_pitching_force_metrics (
      athlete_uuid, session_date, source_system, source_athlete_id,
      owner_filename, trial_index, handedness, body_weight_kg, body_weight_n,
      lead_plate_id, drive_plate_id, braking_sign, axis_braking, axis_vertical, axis_mediolateral,
      fc_frame, br_frame, mer_frame, fc_time_s, br_time_s, mer_time_s,
      initial_contact_frame, initial_contact_time_s, foot_loading_time_ms,
      fc_to_br_duration_s,
      lead_peak_vertical_n, lead_peak_vertical_bw, lead_peak_vertical_time_s, lead_peak_vertical_pct_fc_br,
      lead_peak_braking_n, lead_peak_braking_bw, lead_peak_braking_time_s, lead_peak_braking_pct_fc_br,
      lead_peak_resultant_n, lead_peak_resultant_bw, lead_peak_resultant_time_s, lead_peak_resultant_pct_fc_br,
      peak_v_to_peak_b_lag_ms, peaks_synced_flag, peaks_before_mer_flag, single_impulse_flag, impulse_peak_count,
      lead_rfd_vertical_n_per_s, lead_rfd_vertical_bw_per_s, lead_rfd_braking_n_per_s, lead_rfd_braking_bw_per_s,
      lead_time_to_peak_fz_ms,
      lead_impulse_v_fc_to_br_ns, lead_impulse_v_fc_to_br_bws,
      lead_impulse_v_fc_to_mer_ns, lead_impulse_v_fc_to_mer_bws,
      lead_impulse_v_into_ball_ns, lead_impulse_v_into_ball_bws,
      lead_impulse_b_fc_to_br_ns, lead_impulse_b_fc_to_br_bws,
      lead_impulse_b_fc_to_mer_ns, lead_impulse_b_fc_to_mer_bws,
      lead_impulse_b_into_ball_ns, lead_impulse_b_into_ball_bws,
      lead_impulse_resultant_fc_to_br_ns, lead_impulse_resultant_into_ball_ns, lead_impulse_resultant_into_ball_bws,
      lead_fz_at_50pct_bw, lead_fz_at_midpoint_bw, lead_fy_at_midpoint_bw, lead_resultant_at_midpoint_bw,
      drive_peak_vertical_n, drive_peak_vertical_bw, drive_peak_vertical_time_s,
      drive_peak_braking_n, drive_peak_braking_bw, drive_peak_braking_time_s,
      drive_unload_time_s, drive_to_lead_handoff_ms,
      total_vertical_peak_n, virtual_plate_xcheck_pct,
      qa_flags, qa_warnings_json,
      processor_version
    ) VALUES (
      ", .L(row$athlete_uuid), ",
      ", .L(row$session_date), "::date,
      ", .L(row$source_system), ",
      ", .L(row$source_athlete_id), ",
      ", .L(row$owner_filename), ",
      ", .L(row$trial_index), ",
      ", .L(row$handedness), ",
      ", .L(row$body_weight_kg), ",
      ", .L(row$body_weight_n), ",
      ", .L(row$lead_plate_id), ",
      ", .L(row$drive_plate_id), ",
      ", .L(row$braking_sign), ",
      ", .L(row$axis_braking), ",
      ", .L(row$axis_vertical), ",
      ", .L(row$axis_mediolateral), ",
      ", .L(row$fc_frame), ",
      ", .L(row$br_frame), ",
      ", .L(row$mer_frame), ",
      ", .L(row$fc_time_s), ",
      ", .L(row$br_time_s), ",
      ", .L(row$mer_time_s), ",
      ", .L(row$initial_contact_frame), ",
      ", .L(row$initial_contact_time_s), ",
      ", .L(row$foot_loading_time_ms), ",
      ", .L(row$fc_to_br_duration_s), ",
      ", .L(row$lead_peak_vertical_n), ",
      ", .L(row$lead_peak_vertical_bw), ",
      ", .L(row$lead_peak_vertical_time_s), ",
      ", .L(row$lead_peak_vertical_pct_fc_br), ",
      ", .L(row$lead_peak_braking_n), ",
      ", .L(row$lead_peak_braking_bw), ",
      ", .L(row$lead_peak_braking_time_s), ",
      ", .L(row$lead_peak_braking_pct_fc_br), ",
      ", .L(row$lead_peak_resultant_n), ",
      ", .L(row$lead_peak_resultant_bw), ",
      ", .L(row$lead_peak_resultant_time_s), ",
      ", .L(row$lead_peak_resultant_pct_fc_br), ",
      ", .L(row$peak_v_to_peak_b_lag_ms), ",
      ", .L(row$peaks_synced_flag), ",
      ", .L(row$peaks_before_mer_flag), ",
      ", .L(row$single_impulse_flag), ",
      ", .L(row$impulse_peak_count), ",
      ", .L(row$lead_rfd_vertical_n_per_s), ",
      ", .L(row$lead_rfd_vertical_bw_per_s), ",
      ", .L(row$lead_rfd_braking_n_per_s), ",
      ", .L(row$lead_rfd_braking_bw_per_s), ",
      ", .L(row$lead_time_to_peak_fz_ms), ",
      ", .L(row$lead_impulse_v_fc_to_br_ns), ",
      ", .L(row$lead_impulse_v_fc_to_br_bws), ",
      ", .L(row$lead_impulse_v_fc_to_mer_ns), ",
      ", .L(row$lead_impulse_v_fc_to_mer_bws), ",
      ", .L(row$lead_impulse_v_into_ball_ns), ",
      ", .L(row$lead_impulse_v_into_ball_bws), ",
      ", .L(row$lead_impulse_b_fc_to_br_ns), ",
      ", .L(row$lead_impulse_b_fc_to_br_bws), ",
      ", .L(row$lead_impulse_b_fc_to_mer_ns), ",
      ", .L(row$lead_impulse_b_fc_to_mer_bws), ",
      ", .L(row$lead_impulse_b_into_ball_ns), ",
      ", .L(row$lead_impulse_b_into_ball_bws), ",
      ", .L(row$lead_impulse_resultant_fc_to_br_ns), ",
      ", .L(row$lead_impulse_resultant_into_ball_ns), ",
      ", .L(row$lead_impulse_resultant_into_ball_bws), ",
      ", .L(row$lead_fz_at_50pct_bw), ",
      ", .L(row$lead_fz_at_midpoint_bw), ",
      ", .L(row$lead_fy_at_midpoint_bw), ",
      ", .L(row$lead_resultant_at_midpoint_bw), ",
      ", .L(row$drive_peak_vertical_n), ",
      ", .L(row$drive_peak_vertical_bw), ",
      ", .L(row$drive_peak_vertical_time_s), ",
      ", .L(row$drive_peak_braking_n), ",
      ", .L(row$drive_peak_braking_bw), ",
      ", .L(row$drive_peak_braking_time_s), ",
      ", .L(row$drive_unload_time_s), ",
      ", .L(row$drive_to_lead_handoff_ms), ",
      ", .L(row$total_vertical_peak_n), ",
      ", .L(row$virtual_plate_xcheck_pct), ",
      ", flags_str, ",
      ", .L(warnings_json_str), "::jsonb,
      ", .L(row$processor_version), "
    )
    ON CONFLICT (athlete_uuid, session_date, trial_index) DO UPDATE SET
      source_athlete_id = EXCLUDED.source_athlete_id,
      owner_filename = EXCLUDED.owner_filename,
      handedness = EXCLUDED.handedness,
      body_weight_kg = EXCLUDED.body_weight_kg,
      body_weight_n = EXCLUDED.body_weight_n,
      lead_plate_id = EXCLUDED.lead_plate_id,
      drive_plate_id = EXCLUDED.drive_plate_id,
      braking_sign = EXCLUDED.braking_sign,
      axis_braking = EXCLUDED.axis_braking,
      axis_vertical = EXCLUDED.axis_vertical,
      axis_mediolateral = EXCLUDED.axis_mediolateral,
      fc_frame = EXCLUDED.fc_frame,
      br_frame = EXCLUDED.br_frame,
      mer_frame = EXCLUDED.mer_frame,
      fc_time_s = EXCLUDED.fc_time_s,
      br_time_s = EXCLUDED.br_time_s,
      mer_time_s = EXCLUDED.mer_time_s,
      initial_contact_frame = EXCLUDED.initial_contact_frame,
      initial_contact_time_s = EXCLUDED.initial_contact_time_s,
      foot_loading_time_ms = EXCLUDED.foot_loading_time_ms,
      fc_to_br_duration_s = EXCLUDED.fc_to_br_duration_s,
      lead_peak_vertical_n = EXCLUDED.lead_peak_vertical_n,
      lead_peak_vertical_bw = EXCLUDED.lead_peak_vertical_bw,
      lead_peak_vertical_time_s = EXCLUDED.lead_peak_vertical_time_s,
      lead_peak_vertical_pct_fc_br = EXCLUDED.lead_peak_vertical_pct_fc_br,
      lead_peak_braking_n = EXCLUDED.lead_peak_braking_n,
      lead_peak_braking_bw = EXCLUDED.lead_peak_braking_bw,
      lead_peak_braking_time_s = EXCLUDED.lead_peak_braking_time_s,
      lead_peak_braking_pct_fc_br = EXCLUDED.lead_peak_braking_pct_fc_br,
      lead_peak_resultant_n = EXCLUDED.lead_peak_resultant_n,
      lead_peak_resultant_bw = EXCLUDED.lead_peak_resultant_bw,
      lead_peak_resultant_time_s = EXCLUDED.lead_peak_resultant_time_s,
      lead_peak_resultant_pct_fc_br = EXCLUDED.lead_peak_resultant_pct_fc_br,
      peak_v_to_peak_b_lag_ms = EXCLUDED.peak_v_to_peak_b_lag_ms,
      peaks_synced_flag = EXCLUDED.peaks_synced_flag,
      peaks_before_mer_flag = EXCLUDED.peaks_before_mer_flag,
      single_impulse_flag = EXCLUDED.single_impulse_flag,
      impulse_peak_count = EXCLUDED.impulse_peak_count,
      lead_rfd_vertical_n_per_s = EXCLUDED.lead_rfd_vertical_n_per_s,
      lead_rfd_vertical_bw_per_s = EXCLUDED.lead_rfd_vertical_bw_per_s,
      lead_rfd_braking_n_per_s = EXCLUDED.lead_rfd_braking_n_per_s,
      lead_rfd_braking_bw_per_s = EXCLUDED.lead_rfd_braking_bw_per_s,
      lead_time_to_peak_fz_ms = EXCLUDED.lead_time_to_peak_fz_ms,
      lead_impulse_v_fc_to_br_ns = EXCLUDED.lead_impulse_v_fc_to_br_ns,
      lead_impulse_v_fc_to_br_bws = EXCLUDED.lead_impulse_v_fc_to_br_bws,
      lead_impulse_v_fc_to_mer_ns = EXCLUDED.lead_impulse_v_fc_to_mer_ns,
      lead_impulse_v_fc_to_mer_bws = EXCLUDED.lead_impulse_v_fc_to_mer_bws,
      lead_impulse_v_into_ball_ns = EXCLUDED.lead_impulse_v_into_ball_ns,
      lead_impulse_v_into_ball_bws = EXCLUDED.lead_impulse_v_into_ball_bws,
      lead_impulse_b_fc_to_br_ns = EXCLUDED.lead_impulse_b_fc_to_br_ns,
      lead_impulse_b_fc_to_br_bws = EXCLUDED.lead_impulse_b_fc_to_br_bws,
      lead_impulse_b_fc_to_mer_ns = EXCLUDED.lead_impulse_b_fc_to_mer_ns,
      lead_impulse_b_fc_to_mer_bws = EXCLUDED.lead_impulse_b_fc_to_mer_bws,
      lead_impulse_b_into_ball_ns = EXCLUDED.lead_impulse_b_into_ball_ns,
      lead_impulse_b_into_ball_bws = EXCLUDED.lead_impulse_b_into_ball_bws,
      lead_impulse_resultant_fc_to_br_ns = EXCLUDED.lead_impulse_resultant_fc_to_br_ns,
      lead_impulse_resultant_into_ball_ns = EXCLUDED.lead_impulse_resultant_into_ball_ns,
      lead_impulse_resultant_into_ball_bws = EXCLUDED.lead_impulse_resultant_into_ball_bws,
      lead_fz_at_50pct_bw = EXCLUDED.lead_fz_at_50pct_bw,
      lead_fz_at_midpoint_bw = EXCLUDED.lead_fz_at_midpoint_bw,
      lead_fy_at_midpoint_bw = EXCLUDED.lead_fy_at_midpoint_bw,
      lead_resultant_at_midpoint_bw = EXCLUDED.lead_resultant_at_midpoint_bw,
      drive_peak_vertical_n = EXCLUDED.drive_peak_vertical_n,
      drive_peak_vertical_bw = EXCLUDED.drive_peak_vertical_bw,
      drive_peak_vertical_time_s = EXCLUDED.drive_peak_vertical_time_s,
      drive_peak_braking_n = EXCLUDED.drive_peak_braking_n,
      drive_peak_braking_bw = EXCLUDED.drive_peak_braking_bw,
      drive_peak_braking_time_s = EXCLUDED.drive_peak_braking_time_s,
      drive_unload_time_s = EXCLUDED.drive_unload_time_s,
      drive_to_lead_handoff_ms = EXCLUDED.drive_to_lead_handoff_ms,
      total_vertical_peak_n = EXCLUDED.total_vertical_peak_n,
      virtual_plate_xcheck_pct = EXCLUDED.virtual_plate_xcheck_pct,
      qa_flags = EXCLUDED.qa_flags,
      qa_warnings_json = EXCLUDED.qa_warnings_json,
      processor_version = EXCLUDED.processor_version,
      created_at = NOW()
  ")

  DBI::dbExecute(con, sql)
}
