# force_processing.R
#
# Orchestrator for the GRF force-metrics processing layer.
# Sources the four component modules and exposes two public functions:
#
#   process_force_metrics_for_trial(...)  — processes a single trial
#   process_force_metrics_for_session(...) — processes all trials in a folder
#
# Configuration constants (tune without touching component files):
FORCE_FILTER_HZ        <- 50      # Butterworth cutoff
FORCE_SYNC_THRESHOLD_MS <- 20     # peaks_synced_flag threshold
FORCE_INTO_BALL_PCT    <- 0.75    # FC→BR fraction for "into ball" window
FORCE_MER_EULER_IDX    <- 3L      # 1-based; rotZ of arm segment
PROCESSOR_VERSION      <- "1.0.0"

# ---- Source component modules ----
# Resolve our own directory robustly (works when sourced from any working dir)

.fp_find_dir <- function() {
  # Walk the call stack; the frame where source() called us has $ofile
  for (i in rev(seq_len(sys.nframe()))) {
    ofile <- tryCatch(sys.frame(i)$ofile, error = function(e) NULL)
    if (!is.null(ofile) && nchar(ofile) > 0 && grepl("force_processing", ofile)) {
      return(dirname(normalizePath(ofile, mustWork = FALSE)))
    }
  }
  # Fallback: search relative to working directory and script arg
  candidates <- c(
    file.path(getwd(), "force"),
    file.path(getwd(), "R", "pitching", "force"),
    file.path(dirname(getwd()), "R", "pitching", "force")
  )
  for (cand in candidates) {
    if (file.exists(file.path(cand, "force_detection.R"))) return(dirname(cand))
  }
  getwd()
}

.fp_dir <- .fp_find_dir()
rm(.fp_find_dir)

for (.fp_sub in c("force_detection.R", "force_events.R",
                  "force_metrics.R",   "force_db.R")) {
  .fp_path <- file.path(.fp_dir, "force", .fp_sub)
  if (file.exists(.fp_path)) {
    source(.fp_path)
  } else {
    stop("force_processing.R: cannot find ", .fp_sub, " at ", .fp_path)
  }
}
rm(.fp_dir, .fp_sub, .fp_path)

# ---- Internal helpers ----

# Build time-stamp vector for a parsed JSON.
.fp_time_vec <- function(json_data, frame_rate = NULL) {
  fr <- as.numeric(json_data$frameRate %||% frame_rate %||% 300)
  st <- as.numeric(json_data$startTime %||% 0)
  n  <- length(json_data$frames %||% list())
  dt <- 1 / fr
  st + (seq_len(n) - 1L) * dt
}

# Body weight in kg from lbs (as stored in f_pitching_time_data.weight).
# Falls back to 80 kg with a flag when missing.
.fp_bw_kg <- function(weight_lbs) {
  if (!is.null(weight_lbs) && !is.na(weight_lbs) && as.numeric(weight_lbs) > 0) {
    list(kg = as.numeric(weight_lbs) / 2.2046226, missing = FALSE)
  } else {
    list(kg = 80, missing = TRUE)
  }
}

# ---- Public API ----

# Process GRF force metrics for a single trial.
#
# @param con           DBI connection (open, passed in — do NOT open/close here)
# @param athlete_uuid  character
# @param session_date  character "YYYY-MM-DD"
# @param trial_index   integer
# @param json_data     Pre-parsed list (from jsonlite::parse_json) OR NULL
# @param json_path     Path to -3d-data.json file (used when json_data is NULL)
# @param handedness    "right" | "left" | NA
# @param weight_lbs    Numeric or NA (as stored in f_pitching_time_data.weight)
# @param frame_rate    Numeric (fallback if not in JSON)
# @param start_time    Numeric (fallback if not in JSON)
# @param source_athlete_id character or NA
# @param owner_filename character or NA
# @return Invisibly returns the metrics list (primarily for testing).
process_force_metrics_for_trial <- function(con,
                                            athlete_uuid,
                                            session_date,
                                            trial_index,
                                            json_data       = NULL,
                                            json_path       = NULL,
                                            handedness      = NA,
                                            weight_lbs      = NA,
                                            frame_rate      = NULL,
                                            start_time      = NULL,
                                            source_athlete_id = NA,
                                            owner_filename  = NA) {

  # Ensure table exists (idempotent)
  ensure_force_metrics_table(con)

  # Load JSON if not pre-parsed
  if (is.null(json_data)) {
    if (is.null(json_path) || !file.exists(json_path)) {
      warning("[FORCE] json_path not found for trial ", trial_index, ": ", json_path)
      return(invisible(NULL))
    }
    json_text <- tryCatch(
      paste(readLines(json_path, warn = FALSE, encoding = "UTF-8"), collapse = "\n"),
      error = function(e) { warning("[FORCE] read error: ", conditionMessage(e)); NULL }
    )
    if (is.null(json_text)) return(invisible(NULL))
    json_data <- tryCatch(
      jsonlite::parse_json(json_text, simplifyVector = FALSE),
      error = function(e) { warning("[FORCE] parse error: ", conditionMessage(e)); NULL }
    )
    if (is.null(json_data)) return(invisible(NULL))
  }

  # Resolve metadata
  fr  <- as.numeric(json_data$frameRate %||% frame_rate %||% 300)
  dt  <- 1 / fr
  t   <- .fp_time_vec(json_data, fr)
  n   <- length(t)
  bw  <- .fp_bw_kg(weight_lbs)
  BW_n <- bw$kg * 9.81

  qa_flags      <- character(0)
  qa_warnings   <- list()

  if (bw$missing) {
    qa_flags <- c(qa_flags, "body_weight_missing")
    qa_warnings$body_weight_missing <- list(fallback_kg = 80)
  }

  # ---- Plate detection ----
  plates <- identify_plates(json_data)
  qa_flags <- c(qa_flags, plates$qa_flags)

  lead_pid    <- plates$lead_plate_id
  drive_pid   <- plates$drive_plate_id
  virtual_pid <- plates$virtual_plate_id
  mats        <- plates$plate_matrices

  # Check clipping
  if ("plate_clipping" %in% plates$qa_flags) {
    qa_warnings$plate_clipping <- list(note = "Fz exceeded 9000 N on at least one plate")
  }

  if (is.null(lead_pid)) {
    # Cannot compute lead-leg metrics without a lead plate — write a stub row
    warning("[FORCE] Cannot identify lead plate for trial ", trial_index)
    qa_flags <- unique(c(qa_flags, "ambiguous_lead_plate"))
  }

  lead_mat    <- if (!is.null(lead_pid))    mats[[as.character(lead_pid)]]    else matrix(0, n, 3)
  drive_mat   <- if (!is.null(drive_pid))   mats[[as.character(drive_pid)]]   else matrix(0, n, 3)
  virtual_mat <- if (!is.null(virtual_pid)) mats[[as.character(virtual_pid)]] else NULL

  # ---- Filter ----
  filter_results <- lapply(list(lead = lead_mat, drive = drive_mat), function(m) {
    for (col in 1:3) {
      res <- apply_butter_filter(m[, col], dt, FORCE_FILTER_HZ)
      m[, col] <- res$filtered
      if (!res$applied) qa_flags <<- unique(c(qa_flags, "no_filter_applied"))
    }
    m
  })
  lead_mat_f  <- filter_results$lead
  drive_mat_f <- filter_results$drive

  # ---- Fetch QTM timing events from f_pitching_trials.metrics ----
  timing_row <- tryCatch(
    DBI::dbGetQuery(con,
      "SELECT metrics FROM public.f_pitching_trials
       WHERE athlete_uuid=$1 AND session_date=$2 AND trial_index=$3 LIMIT 1",
      params = list(as.character(athlete_uuid),
                    as.character(session_date),
                    as.integer(trial_index))
    ),
    error = function(e) NULL
  )
  .get_timing <- function(metrics_json, key) {
    if (is.null(metrics_json) || is.na(metrics_json)) return(NULL)
    m <- tryCatch(jsonlite::fromJSON(metrics_json), error = function(e) NULL)
    v <- m[[key]]
    if (is.null(v)) return(NULL)
    if (is.list(v) || length(v) > 1) v <- v[[1]]
    suppressWarnings(as.numeric(v))
  }
  raw_metrics  <- if (!is.null(timing_row) && nrow(timing_row) > 0) timing_row$metrics[1] else NA
  footstrike_s <- .get_timing(raw_metrics, "TIMING.FootstrikeTime.X")
  release_s    <- .get_timing(raw_metrics, "TIMING.ReleaseTime.X")

  # ---- Event detection ----
  events <- tryCatch(
    detect_events(json_data, lead_mat_f, handedness, dt, footstrike_s, release_s),
    error = function(e) {
      warning("[FORCE] Event detection failed for trial ", trial_index, ": ", conditionMessage(e))
      return(NULL)
    }
  )
  if (is.null(events)) return(invisible(NULL))

  qa_flags <- c(qa_flags, events$qa_flags)
  fc  <- events$fc_frame
  br  <- events$br_frame
  mer <- events$mer_frame
  ic  <- events$initial_contact_frame
  foot_loading_ms <- events$foot_loading_time_ms

  # ---- Lead metrics ----
  lead_m <- compute_lead_metrics(lead_mat_f, fc, br, mer, dt, BW_n, t)

  # Late peaks QA flag
  if (!is.null(lead_m$lead_peak_vertical_pct_fc_br) &&
      !is.na(lead_m$lead_peak_vertical_pct_fc_br) &&
      lead_m$lead_peak_vertical_pct_fc_br > 0.85) {
    qa_flags <- c(qa_flags, "late_peaks")
    qa_warnings$late_peaks <- list(pct = lead_m$lead_peak_vertical_pct_fc_br, threshold = 0.85)
  }

  # Single impulse violation
  if (isFALSE(lead_m$single_impulse_flag) && !is.na(lead_m$impulse_peak_count) &&
      lead_m$impulse_peak_count >= 2) {
    qa_flags <- c(qa_flags, "single_impulse_violation")
  }

  # ---- Drive metrics ----
  drive_m <- compute_drive_metrics(drive_mat_f, virtual_mat, lead_mat_f, fc, dt, BW_n, t)

  # Virtual plate mismatch
  if (!is.null(drive_m$virtual_plate_xcheck_pct) &&
      !is.na(drive_m$virtual_plate_xcheck_pct) &&
      drive_m$virtual_plate_xcheck_pct > 5) {
    qa_flags <- c(qa_flags, "virtual_plate_mismatch")
    qa_warnings$virtual_plate_mismatch <- list(pct = drive_m$virtual_plate_xcheck_pct)
  }

  # ---- Assemble row ----
  row <- c(
    list(
      athlete_uuid      = as.character(athlete_uuid),
      session_date      = as.character(session_date),
      source_system     = "pitching",
      source_athlete_id = if (is.na(source_athlete_id)) NA_character_ else as.character(source_athlete_id),
      owner_filename    = if (is.na(owner_filename))    NA_character_ else as.character(owner_filename),
      trial_index       = as.integer(trial_index),
      handedness        = if (is.na(handedness))        NA_character_ else as.character(handedness),
      body_weight_kg    = bw$kg,
      body_weight_n     = BW_n,
      lead_plate_id     = lead_pid,
      drive_plate_id    = drive_pid,
      fc_frame               = fc,
      br_frame               = br,
      mer_frame              = mer,
      fc_time_s              = if (!is.null(fc))  t[fc]  else NA_real_,
      br_time_s              = if (!is.null(br))  t[br]  else NA_real_,
      mer_time_s             = if (!is.null(mer)) t[mer] else NA_real_,
      initial_contact_frame  = ic,
      initial_contact_time_s = if (!is.null(ic))  t[ic]  else NA_real_,
      foot_loading_time_ms   = foot_loading_ms,
      qa_flags          = unique(qa_flags),
      qa_warnings_json  = if (length(qa_warnings) > 0) qa_warnings else NULL,
      processor_version = PROCESSOR_VERSION
    ),
    lead_m,
    drive_m
  )

  # Log summary
  cat(sprintf(
    "  [FORCE] Trial %s: lead=plate%s drive=plate%s FC=%s BR=%s MER=%s\n",
    trial_index,
    if (!is.null(lead_pid))  lead_pid  else "?",
    if (!is.null(drive_pid)) drive_pid else "?",
    if (!is.null(fc))  fc  else "?",
    if (!is.null(br))  br  else "?",
    if (!is.null(mer)) mer else "?"
  ))
  if (!is.null(row$lead_peak_vertical_n)) {
    cat(sprintf(
      "         peaks: V=%.0fN@%.3fs (%.2f of FC->BR), B=%.0fN, sync=%.1fms\n",
      row$lead_peak_vertical_n  %||% 0,
      row$lead_peak_vertical_time_s %||% 0,
      row$lead_peak_vertical_pct_fc_br %||% 0,
      row$lead_peak_braking_n   %||% 0,
      row$peak_v_to_peak_b_lag_ms %||% 0
    ))
  }
  if (length(unique(qa_flags)) > 0) {
    cat("         flags:", paste(unique(qa_flags), collapse = ", "), "\n")
  }
  flush.console()

  upsert_force_metrics(con, row)
  invisible(row)
}

# Process all trials in a session folder (standalone / backfill use).
# Connects its own DB connection and closes when done.
#
# @param root_dir  Path to folder containing -3d-data.json files
process_force_metrics_for_session <- function(root_dir) {
  if (!requireNamespace("DBI", quietly = TRUE)) stop("DBI package required")

  # Source common utilities
  common_paths <- c(
    file.path(getwd(), "R", "common", "config.R"),
    file.path(getwd(), "..", "R", "common", "config.R"),
    file.path("..", "common", "config.R"),
    file.path("..", "..", "R", "common", "config.R")
  )
  config_path <- Filter(file.exists, common_paths)[1]
  if (length(config_path) == 0 || is.na(config_path)) stop("Cannot find R/common/config.R")
  source(config_path)

  con <- get_warehouse_connection()
  on.exit(try(DBI::dbDisconnect(con), silent = TRUE))

  json_files <- list.files(root_dir, pattern = "-3d-data\\.json$",
                           recursive = TRUE, full.names = TRUE, ignore.case = TRUE)
  cat("[FORCE] Found", length(json_files), "JSON files in", root_dir, "\n")

  n_ok <- 0L; n_err <- 0L
  for (jf in json_files) {
    tryCatch({
      jtext <- paste(readLines(jf, warn = FALSE, encoding = "UTF-8"), collapse = "\n")
      jdata <- jsonlite::parse_json(jtext, simplifyVector = FALSE)
      # For standalone use we don't have athlete/session context — skip
      cat("[FORCE] Skipping", basename(jf), "— use backfill_force_metrics.R for DB-backed backfill\n")
    }, error = function(e) {
      cat("[FORCE] ERROR", basename(jf), ":", conditionMessage(e), "\n")
      n_err <<- n_err + 1L
    })
  }
  cat("[FORCE] Session done:", n_ok, "ok,", n_err, "errors\n")
  invisible(list(n_ok = n_ok, n_err = n_err))
}

