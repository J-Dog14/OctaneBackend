# backfill_force_metrics.R
#
# Processes all trials that have force data in f_pitching_force_data but
# no corresponding row in f_pitching_force_metrics.
#
# Run standalone: Rscript backfill_force_metrics.R
# Run from R:     source("backfill_force_metrics.R")

suppressPackageStartupMessages({
  library(DBI)
  library(RPostgres)
  library(jsonlite)
})

# ---- Load common utilities ----
find_and_source_common <- function() {
  paths <- c(
    file.path(getwd(), "R", "common", "config.R"),
    file.path(getwd(), "..", "R", "common", "config.R"),
    file.path("..", "common", "config.R"),
    file.path("..", "..", "R", "common", "config.R"),
    file.path(dirname(getwd()), "R", "common", "config.R")
  )
  cfg <- Filter(file.exists, paths)[1]
  if (is.na(cfg) || is.null(cfg)) stop("Cannot find R/common/config.R")
  source(cfg)
}
find_and_source_common()

# ---- Load force_processing.R ----
fp_candidates <- c(
  file.path(getwd(), "force_processing.R"),
  file.path(getwd(), "R", "pitching", "force_processing.R"),
  file.path("..", "pitching", "force_processing.R"),
  file.path(dirname(getwd()), "R", "pitching", "force_processing.R")
)
fp_path <- Filter(file.exists, fp_candidates)[1]
if (is.na(fp_path) || is.null(fp_path)) stop("Cannot find force_processing.R")
source(fp_path)

# ---- Connect ----
con <- get_warehouse_connection()
cat("Connected to warehouse.\n")
on.exit(try(DBI::dbDisconnect(con), silent = TRUE))

# ---- Ensure table exists ----
ensure_force_metrics_table(con)

# ---- Find unprocessed trials ----
unprocessed <- tryCatch(
  DBI::dbGetQuery(con, "
    SELECT
      fd.athlete_uuid,
      fd.session_date::text AS session_date,
      fd.source_athlete_id,
      fd.owner_filename,
      fd.trial_index,
      td.handedness,
      td.weight,
      td.frame_rate,
      td.start_time,
      td.session_xml_path
    FROM public.f_pitching_force_data fd
    LEFT JOIN public.f_pitching_force_metrics fm
      ON fd.athlete_uuid  = fm.athlete_uuid
     AND fd.session_date  = fm.session_date
     AND fd.trial_index   = fm.trial_index
    LEFT JOIN public.f_pitching_time_data td
      ON fd.athlete_uuid  = td.athlete_uuid
     AND fd.session_date  = td.session_date
     AND fd.trial_index   = td.trial_index
    WHERE fm.id IS NULL
    ORDER BY fd.session_date DESC, fd.athlete_uuid, fd.trial_index
  "),
  error = function(e) {
    cat("ERROR querying unprocessed trials:", conditionMessage(e), "\n")
    NULL
  }
)

if (is.null(unprocessed) || nrow(unprocessed) == 0) {
  cat("No unprocessed trials found — f_pitching_force_metrics is up to date.\n")
  quit(save = "no", status = 0)
}

cat("Found", nrow(unprocessed), "unprocessed trial(s).\n\n")

n_ok  <- 0L
n_err <- 0L

for (i in seq_len(nrow(unprocessed))) {
  row <- unprocessed[i, ]

  # Resolve JSON path from session_xml_path directory + owner_filename
  json_path <- NULL
  if (!is.na(row$session_xml_path) && !is.na(row$owner_filename)) {
    candidate <- file.path(
      dirname(row$session_xml_path),
      paste0(row$owner_filename, "-3d-data.json")
    )
    if (file.exists(candidate)) json_path <- candidate
  }

  if (is.null(json_path)) {
    cat(sprintf("  [SKIP] %s / %s / trial %d — JSON file not found at expected path\n",
                row$athlete_uuid, row$session_date, row$trial_index))
    n_err <- n_err + 1L
    next
  }

  tryCatch({
    process_force_metrics_for_trial(
      con               = con,
      athlete_uuid      = row$athlete_uuid,
      session_date      = row$session_date,
      trial_index       = as.integer(row$trial_index),
      json_path         = json_path,
      handedness        = row$handedness,
      weight_lbs        = row$weight,
      frame_rate        = row$frame_rate,
      start_time        = row$start_time,
      source_athlete_id = row$source_athlete_id,
      owner_filename    = row$owner_filename
    )
    n_ok <- n_ok + 1L
  }, error = function(e) {
    cat(sprintf("  [ERROR] %s / %s / trial %d: %s\n",
                row$athlete_uuid, row$session_date, row$trial_index, conditionMessage(e)))
    n_err <<- n_err + 1L
  })
}

cat(sprintf("\nBackfill complete: %d processed, %d skipped/errored.\n", n_ok, n_err))
