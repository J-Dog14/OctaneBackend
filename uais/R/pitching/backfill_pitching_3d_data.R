# backfill_pitching_3d_data.R
#
# For every trial that exists in f_pitching_trials but has no row in the
# time-series tables, find the corresponding -3d-data.json file and insert
# the missing data.
#
# Tables backfilled (in order):
#   f_pitching_time_data        — trial metadata (frame_rate, start/end time, etc.)
#   f_pitching_marker_data      — per-frame marker positions  (JSONB)
#   f_pitching_segment_pos_data — per-frame segment positions (JSONB)
#   f_pitching_segment_rot_data — per-frame segment rotations (JSONB)
#   f_pitching_force_data       — per-frame force plate data  (JSONB)
#
# f_pitching_force_metrics is intentionally excluded (use backfill_force_metrics.R).
#
# Usage:
#   Rscript backfill_pitching_3d_data.R             # backfill all missing trials
#   Rscript backfill_pitching_3d_data.R --dry-run   # print count only, no writes
#
# All inserts use ON CONFLICT DO UPDATE — safe to re-run.

suppressPackageStartupMessages({
  library(DBI)
  library(RPostgres)
  library(jsonlite)
  library(tools)
})

# ---- Load common utilities -----------------------------------------------
find_and_source_common <- function() {
  paths <- c(
    # Running from project root (OctaneBiomechBackend/)
    file.path(getwd(), "uais", "R", "common", "config.R"),
    # Running from uais/R/pitching/
    file.path(getwd(), "..", "common", "config.R"),
    # Running from uais/R/
    file.path(getwd(), "common", "config.R"),
    # Running from uais/
    file.path(getwd(), "R", "common", "config.R"),
    # Other relative fallbacks
    file.path(getwd(), "..", "..", "R", "common", "config.R"),
    file.path(dirname(getwd()), "uais", "R", "common", "config.R")
  )
  cfg <- Filter(file.exists, paths)[1]
  if (length(cfg) == 0 || is.na(cfg)) {
    stop("Cannot find R/common/config.R. Tried:\n",
         paste("  ", paths, collapse = "\n"))
  }
  cfg <- normalizePath(cfg, winslash = "/")
  source(cfg)
  db_utils <- file.path(dirname(cfg), "db_utils.R")
  if (file.exists(db_utils)) source(db_utils)
}
find_and_source_common()

# ---- SQL literal helper (same as .sql_lit() in pitching_processing.R) ----
.sql_lit <- function(con, x) {
  if (is.null(x) || (length(x) == 1 && is.na(x))) return("NULL")
  as.character(DBI::dbQuoteLiteral(con, x))
}

# ---- CLI flags -----------------------------------------------------------
dry_run <- "--dry-run" %in% commandArgs(trailingOnly = TRUE)
if (dry_run) cat("[backfill] DRY RUN — no data will be written.\n")

# ---- Connect -------------------------------------------------------------
con <- get_warehouse_connection()
cat("[backfill] Connected to warehouse.\n")
on.exit(try(DBI::dbDisconnect(con), silent = TRUE))

tryCatch(
  DBI::dbExecute(con, "SET client_min_messages = WARNING"),
  error = function(e) NULL
)

# ---- Find missing trials -------------------------------------------------
missing <- tryCatch(
  DBI::dbGetQuery(con, "
    SELECT
      pt.athlete_uuid,
      pt.name,
      pt.session_date::text          AS session_date,
      pt.source_athlete_id,
      pt.owner_filename,
      pt.handedness,
      pt.trial_index,
      pt.velocity_mph,
      pt.score,
      pt.age_at_collection,
      pt.age_group,
      pt.height,
      pt.weight,
      pt.session_xml_path,
      pt.session_data_xml_path
    FROM public.f_pitching_trials pt
    LEFT JOIN public.f_pitching_time_data td
      ON  pt.athlete_uuid = td.athlete_uuid
      AND pt.session_date = td.session_date
      AND pt.trial_index  = td.trial_index
    WHERE td.id IS NULL
      AND pt.session_xml_path IS NOT NULL
    ORDER BY pt.session_date DESC, pt.athlete_uuid, pt.trial_index
  "),
  error = function(e) {
    cat("[backfill] ERROR querying missing trials:", conditionMessage(e), "\n")
    NULL
  }
)

if (is.null(missing) || nrow(missing) == 0) {
  cat("[backfill] Nothing to do — all trials already have time-series data.\n")
  quit(save = "no", status = 0)
}

cat(sprintf("[backfill] Found %d trial(s) missing time-series data.\n", nrow(missing)))

if (dry_run) {
  # Group by athlete for a readable summary
  by_athlete <- aggregate(trial_index ~ athlete_uuid + name + session_date,
                          data = missing, FUN = length)
  colnames(by_athlete)[4] <- "n_trials"
  cat("\nTrials to backfill by athlete / session:\n")
  for (i in seq_len(nrow(by_athlete))) {
    cat(sprintf("  %s (%s)  %s  — %d trial(s)\n",
                by_athlete$name[i],
                by_athlete$athlete_uuid[i],
                by_athlete$session_date[i],
                by_athlete$n_trials[i]))
  }
  quit(save = "no", status = 0)
}

# ---- Per-trial backfill loop ---------------------------------------------
n_total   <- nrow(missing)
n_ok      <- 0L
n_skip    <- 0L
n_err     <- 0L

ct_time   <- 0L; ct_markers <- 0L; ct_seg_pos <- 0L
ct_seg_rot <- 0L; ct_force   <- 0L

cat("\n")

for (i in seq_len(n_total)) {
  row <- missing[i, ]

  # -- Resolve JSON path -----------------------------------------------
  json_path <- file.path(
    dirname(row$session_xml_path),
    paste0(row$owner_filename, "-3d-data.json")
  )

  if (!file.exists(json_path)) {
    cat(sprintf("[SKIP] %s / trial %d — JSON not found:\n       %s\n",
                row$owner_filename, row$trial_index, json_path))
    n_skip <- n_skip + 1L
    next
  }

  # -- Parse JSON -------------------------------------------------------
  json_text <- tryCatch(
    paste(readLines(json_path, warn = FALSE, encoding = "UTF-8"), collapse = "\n"),
    error = function(e) {
      cat(sprintf("[ERR]  %s / trial %d — read error: %s\n",
                  row$owner_filename, row$trial_index, conditionMessage(e)))
      NULL
    }
  )
  if (is.null(json_text)) { n_err <- n_err + 1L; next }

  json_data <- tryCatch(
    jsonlite::parse_json(json_text, simplifyVector = FALSE),
    error = function(e) {
      cat(sprintf("[ERR]  %s / trial %d — parse error: %s\n",
                  row$owner_filename, row$trial_index, conditionMessage(e)))
      NULL
    }
  )
  if (is.null(json_data)) { n_err <- n_err + 1L; next }

  # -- Extract JSON scalars --------------------------------------------
  `%||%` <- function(a, b) if (!is.null(a)) a else b
  frame_rate_val       <- json_data$frameRate      %||% NA_real_
  start_time_val       <- json_data$startTime      %||% NA_real_
  end_time_val         <- json_data$endTime        %||% NA_real_
  uncropped_length_val <- json_data$uncroppedLength %||% NA_real_

  frames_list       <- json_data$frames   %||% list()
  label_names_vec   <- tryCatch(sapply(json_data$labels,   function(l) l$name), error = function(e) character(0))
  segment_names_vec <- tryCatch(sapply(json_data$segments, function(s) s$name), error = function(e) character(0))

  # -- Shared column values --------------------------------------------
  uuid_str  <- as.character(row$athlete_uuid)
  date_str  <- as.character(row$session_date)
  sa_id     <- if (is.na(row$source_athlete_id)) NA_character_ else as.character(row$source_athlete_id)
  fn_str    <- as.character(row$owner_filename)
  trial_idx <- as.integer(row$trial_index)

  # -- Status flags ----------------------------------------------------
  .td_st <- "--"; .mk_st <- "--"; .sp_st <- "--"
  .sr_st <- "--"; .fd_st <- "--"

  # ---- INSERT f_pitching_time_data -----------------------------------
  .td_st <- tryCatch({
    DBI::dbExecute(con, paste0("
      INSERT INTO public.f_pitching_time_data
        (athlete_uuid, name, session_date, source_system, source_athlete_id,
         owner_filename, handedness, trial_index, velocity_mph, score,
         age_at_collection, age_group, height, weight,
         frame_rate, start_time, end_time, uncropped_length,
         session_xml_path, session_data_xml_path)
      VALUES (
        ", .sql_lit(con, uuid_str), ",
        ", .sql_lit(con, if (is.na(row$name) || row$name == "") NULL else as.character(row$name)), ",
        ", .sql_lit(con, date_str), "::date,
        'pitching',
        ", .sql_lit(con, sa_id), ",
        ", .sql_lit(con, fn_str), ",
        ", .sql_lit(con, if (is.na(row$handedness) || row$handedness == "") NULL else as.character(row$handedness)), ",
        ", .sql_lit(con, trial_idx), ",
        ", .sql_lit(con, row$velocity_mph), ",
        ", .sql_lit(con, row$score), ",
        ", .sql_lit(con, row$age_at_collection), ",
        ", .sql_lit(con, row$age_group), ",
        ", .sql_lit(con, row$height), ",
        ", .sql_lit(con, row$weight), ",
        ", .sql_lit(con, frame_rate_val), ",
        ", .sql_lit(con, start_time_val), ",
        ", .sql_lit(con, end_time_val), ",
        ", .sql_lit(con, uncropped_length_val), ",
        ", .sql_lit(con, row$session_xml_path), ",
        ", .sql_lit(con, row$session_data_xml_path), "
      )
      ON CONFLICT (athlete_uuid, session_date, trial_index) DO UPDATE SET
        name                  = COALESCE(EXCLUDED.name, f_pitching_time_data.name),
        owner_filename        = EXCLUDED.owner_filename,
        handedness            = COALESCE(EXCLUDED.handedness, f_pitching_time_data.handedness),
        source_athlete_id     = COALESCE(EXCLUDED.source_athlete_id, f_pitching_time_data.source_athlete_id),
        velocity_mph          = EXCLUDED.velocity_mph,
        score                 = EXCLUDED.score,
        age_at_collection     = EXCLUDED.age_at_collection,
        age_group             = EXCLUDED.age_group,
        height                = COALESCE(EXCLUDED.height, f_pitching_time_data.height),
        weight                = COALESCE(EXCLUDED.weight, f_pitching_time_data.weight),
        frame_rate            = EXCLUDED.frame_rate,
        start_time            = EXCLUDED.start_time,
        end_time              = EXCLUDED.end_time,
        uncropped_length      = EXCLUDED.uncropped_length,
        session_xml_path      = EXCLUDED.session_xml_path,
        session_data_xml_path = EXCLUDED.session_data_xml_path,
        created_at            = NOW()
    ")); "OK"
  }, error = function(e) {
    cat(sprintf("  [WARNING] time_data insert: %s\n", conditionMessage(e))); flush.console()
    "ERR"
  })

  # ---- JSONB tables (only when the JSON has frame data) ---------------
  if (length(frames_list) > 0) {

    marker_data  <- lapply(frames_list, function(f) f$markers    %||% list())
    seg_pos_data <- lapply(frames_list, function(f) f$segmentPos %||% list())
    seg_rot_data <- lapply(frames_list, function(f) f$segmentRot %||% list())
    force_data   <- lapply(frames_list, function(f) f$force      %||% list())

    label_json    <- as.character(jsonlite::toJSON(label_names_vec,   auto_unbox = FALSE))
    seg_name_json <- as.character(jsonlite::toJSON(segment_names_vec, auto_unbox = FALSE))
    marker_json   <- as.character(jsonlite::toJSON(marker_data,    auto_unbox = TRUE, null = "null"))
    seg_pos_json  <- as.character(jsonlite::toJSON(seg_pos_data,   auto_unbox = TRUE, null = "null"))
    seg_rot_json  <- as.character(jsonlite::toJSON(seg_rot_data,   auto_unbox = TRUE, null = "null"))
    force_json    <- as.character(jsonlite::toJSON(force_data,     auto_unbox = TRUE, null = "null"))

    # ---- INSERT f_pitching_marker_data --------------------------------
    .mk_st <- tryCatch({
      DBI::dbExecute(con, paste0("
        INSERT INTO public.f_pitching_marker_data
           (athlete_uuid, session_date, source_system, source_athlete_id,
            owner_filename, trial_index, label_names, data)
         VALUES (
           ", .sql_lit(con, uuid_str), ",
           ", .sql_lit(con, date_str), "::date,
           'pitching',
           ", .sql_lit(con, sa_id), ",
           ", .sql_lit(con, fn_str), ",
           ", .sql_lit(con, trial_idx), ",
           ", .sql_lit(con, label_json), "::jsonb,
           ", .sql_lit(con, marker_json), "::jsonb
         )
         ON CONFLICT (athlete_uuid, session_date, trial_index) DO UPDATE SET
           label_names = EXCLUDED.label_names, data = EXCLUDED.data, created_at = NOW()
      ")); "OK"
    }, error = function(e) {
      cat(sprintf("  [WARNING] marker_data insert: %s\n", conditionMessage(e))); flush.console()
      "ERR"
    })

    # ---- INSERT f_pitching_segment_pos_data ---------------------------
    .sp_st <- tryCatch({
      DBI::dbExecute(con, paste0("
        INSERT INTO public.f_pitching_segment_pos_data
           (athlete_uuid, session_date, source_system, source_athlete_id,
            owner_filename, trial_index, segment_names, data)
         VALUES (
           ", .sql_lit(con, uuid_str), ",
           ", .sql_lit(con, date_str), "::date,
           'pitching',
           ", .sql_lit(con, sa_id), ",
           ", .sql_lit(con, fn_str), ",
           ", .sql_lit(con, trial_idx), ",
           ", .sql_lit(con, seg_name_json), "::jsonb,
           ", .sql_lit(con, seg_pos_json), "::jsonb
         )
         ON CONFLICT (athlete_uuid, session_date, trial_index) DO UPDATE SET
           segment_names = EXCLUDED.segment_names, data = EXCLUDED.data, created_at = NOW()
      ")); "OK"
    }, error = function(e) {
      cat(sprintf("  [WARNING] seg_pos_data insert: %s\n", conditionMessage(e))); flush.console()
      "ERR"
    })

    # ---- INSERT f_pitching_segment_rot_data ---------------------------
    .sr_st <- tryCatch({
      DBI::dbExecute(con, paste0("
        INSERT INTO public.f_pitching_segment_rot_data
           (athlete_uuid, session_date, source_system, source_athlete_id,
            owner_filename, trial_index, segment_names, data)
         VALUES (
           ", .sql_lit(con, uuid_str), ",
           ", .sql_lit(con, date_str), "::date,
           'pitching',
           ", .sql_lit(con, sa_id), ",
           ", .sql_lit(con, fn_str), ",
           ", .sql_lit(con, trial_idx), ",
           ", .sql_lit(con, seg_name_json), "::jsonb,
           ", .sql_lit(con, seg_rot_json), "::jsonb
         )
         ON CONFLICT (athlete_uuid, session_date, trial_index) DO UPDATE SET
           segment_names = EXCLUDED.segment_names, data = EXCLUDED.data, created_at = NOW()
      ")); "OK"
    }, error = function(e) {
      cat(sprintf("  [WARNING] seg_rot_data insert: %s\n", conditionMessage(e))); flush.console()
      "ERR"
    })

    # ---- INSERT f_pitching_force_data (only when force data present) --
    if (any(sapply(force_data, length) > 0)) {
      .fd_st <- tryCatch({
        DBI::dbExecute(con, paste0("
          INSERT INTO public.f_pitching_force_data
             (athlete_uuid, session_date, source_system, source_athlete_id,
              owner_filename, trial_index, data)
           VALUES (
             ", .sql_lit(con, uuid_str), ",
             ", .sql_lit(con, date_str), "::date,
             'pitching',
             ", .sql_lit(con, sa_id), ",
             ", .sql_lit(con, fn_str), ",
             ", .sql_lit(con, trial_idx), ",
             ", .sql_lit(con, force_json), "::jsonb
           )
           ON CONFLICT (athlete_uuid, session_date, trial_index) DO UPDATE SET
             data = EXCLUDED.data, created_at = NOW()
        ")); "OK"
      }, error = function(e) {
        cat(sprintf("  [WARNING] force_data insert: %s\n", conditionMessage(e))); flush.console()
        "ERR"
      })
    }
  }

  # -- Per-trial summary -----------------------------------------------
  cat(sprintf("[trial %d/%d] %s  (%s)\n  time=%s  markers=%s  seg_pos=%s  seg_rot=%s  force=%s\n",
              i, n_total, fn_str, date_str,
              .td_st, .mk_st, .sp_st, .sr_st, .fd_st))
  flush.console()

  # -- Accumulate counters ---------------------------------------------
  if (.td_st == "OK") { ct_time    <- ct_time    + 1L } else if (.td_st == "ERR") { n_err <- n_err + 1L }
  if (.mk_st == "OK")   ct_markers <- ct_markers + 1L
  if (.sp_st == "OK")   ct_seg_pos <- ct_seg_pos + 1L
  if (.sr_st == "OK")   ct_seg_rot <- ct_seg_rot + 1L
  if (.fd_st == "OK")   ct_force   <- ct_force   + 1L

  if (.td_st == "OK") n_ok <- n_ok + 1L
}

# ---- Update athlete flags ------------------------------------------------
cat("\nUpdating athlete flags...\n")
if (exists("update_athlete_flags")) {
  tryCatch({
    result <- update_athlete_flags(con, verbose = TRUE)
    if (isTRUE(result$success)) {
      cat("  [OK] Athlete flags updated.\n")
    } else {
      cat("  [WARNING] update_athlete_flags returned non-success.\n")
    }
  }, error = function(e) {
    cat("  [WARNING] update_athlete_flags error:", conditionMessage(e), "\n")
  })
} else {
  cat("  [INFO] update_athlete_flags not available — skipping.\n")
}

# ---- Final summary -------------------------------------------------------
cat(sprintf(
  "\n[DONE] %d/%d trials processed | time=%d markers=%d seg_pos=%d seg_rot=%d force=%d | skipped=%d errors=%d\n",
  n_ok, n_total, ct_time, ct_markers, ct_seg_pos, ct_seg_rot, ct_force, n_skip, n_err
))
