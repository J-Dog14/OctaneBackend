# Backfill script: populate f_hitting_trials for ALL athletes in D:\Hitting\Data
#
# Processes ONE athlete subfolder at a time so each DB connection lives only
# ~10-15 seconds — avoids cloud SSL timeouts that kill 10+ minute runs.
# Safe to re-run: all inserts use ON CONFLICT DO UPDATE.
#
# Run from RStudio with the UAIS project as working directory:
#   setwd("C:/Users/Joey/PycharmProjects/UAIS")
#   source("R/hitting/backfill_hitting_trials.R")

# ---------------------------------------------------------------------------
# 0.  Configuration
# ---------------------------------------------------------------------------
DATA_ROOT    <- "D:/Hitting/Data"   # root folder with one subfolder per athlete
SKIP_DONE    <- FALSE               # set TRUE to skip athletes already in f_hitting_trials

# ---------------------------------------------------------------------------
# 1.  Prevent hitting_processing.R from auto-running when sourced
# ---------------------------------------------------------------------------
assign("MAIN_R_SOURCING", TRUE, envir = .GlobalEnv)

# ---------------------------------------------------------------------------
# 2.  Source the processing script
# ---------------------------------------------------------------------------
processing_script_candidates <- c(
  file.path(getwd(), "R", "hitting", "hitting_processing.R"),
  "C:/Users/Joey/PycharmProjects/UAIS/R/hitting/hitting_processing.R"
)
processing_script <- NULL
for (p in processing_script_candidates) {
  if (file.exists(p)) { processing_script <- normalizePath(p); break }
}
if (is.null(processing_script)) {
  stop("Cannot find hitting_processing.R. Run from the UAIS project root:\n",
       "  setwd('C:/Users/Joey/PycharmProjects/UAIS')")
}
cat("Sourcing:", processing_script, "\n\n")
source(processing_script)

# ---------------------------------------------------------------------------
# 3.  Validate data root and list athlete subfolders
# ---------------------------------------------------------------------------
if (!dir.exists(DATA_ROOT)) {
  stop("Data root does not exist: ", DATA_ROOT)
}

athlete_dirs <- list.dirs(DATA_ROOT, recursive = FALSE, full.names = TRUE)
if (length(athlete_dirs) == 0) stop("No subfolders found in ", DATA_ROOT)

# ---------------------------------------------------------------------------
# 4.  Optionally find athletes already in f_hitting_trials so we can skip them
# ---------------------------------------------------------------------------
already_done <- character(0)
if (SKIP_DONE) {
  cat("Checking which athletes already have data in f_hitting_trials...\n")
  tryCatch({
    con_check <- get_warehouse_connection()
    done_names <- DBI::dbGetQuery(con_check,
      "SELECT DISTINCT UPPER(REGEXP_REPLACE(name, '\\\\s+', ' ', 'g'))
       FROM public.f_hitting_trials WHERE name IS NOT NULL")[[1]]
    DBI::dbDisconnect(con_check)
    already_done <- done_names
    cat("  Found", length(already_done), "athletes already in f_hitting_trials\n\n")
  }, error = function(e) {
    cat("  [WARNING] Could not check f_hitting_trials:", conditionMessage(e), "\n")
    cat("  Proceeding without skip logic.\n\n")
  })
}

# ---------------------------------------------------------------------------
# 5.  Process one athlete folder at a time
# ---------------------------------------------------------------------------
n_total    <- length(athlete_dirs)
n_ok       <- 0
n_skipped  <- 0
n_failed   <- 0
failed_list <- character(0)

cat(strrep("=", 80), "\n")
cat("HITTING TRIALS BACKFILL — per-athlete mode\n")
cat(strrep("=", 80), "\n")
cat(sprintf("Total athlete folders: %d\n\n", n_total))

overall_start <- Sys.time()

for (i in seq_along(athlete_dirs)) {
  dir  <- athlete_dirs[[i]]
  name <- basename(dir)

  cat(sprintf("[%d/%d] %s\n", i, n_total, name))

  # Optional skip
  if (SKIP_DONE && length(already_done) > 0) {
    norm <- toupper(trimws(gsub("\\s+", " ", name)))
    if (norm %in% already_done) {
      cat("  -> already in DB, skipping.\n")
      n_skipped <- n_skipped + 1
      next
    }
  }

  t0 <- proc.time()[["elapsed"]]
  tryCatch({
    # Each call to process_all_files opens its own fresh DB connection
    process_all_files(data_root = dir)
    elapsed <- proc.time()[["elapsed"]] - t0
    cat(sprintf("  -> OK  (%.1f s)\n", elapsed))
    n_ok <- n_ok + 1
  }, error = function(e) {
    elapsed <- proc.time()[["elapsed"]] - t0
    cat(sprintf("  -> FAILED (%.1f s): %s\n", elapsed, conditionMessage(e)))
    n_failed  <<- n_failed + 1
    failed_list <<- c(failed_list, name)
  })
}

# ---------------------------------------------------------------------------
# 6.  Final athlete-flags update (one connection, after all athletes done)
# ---------------------------------------------------------------------------
cat("\nUpdating athlete data-presence flags...\n")
tryCatch({
  con_flags <- get_warehouse_connection()
  update_athlete_flags(con_flags, verbose = TRUE)
  DBI::dbDisconnect(con_flags)
}, error = function(e) {
  cat("[WARNING] Could not update athlete flags:", conditionMessage(e), "\n")
  cat("  Run manually: SELECT update_athlete_data_flags();\n")
})

# ---------------------------------------------------------------------------
# 7.  Summary
# ---------------------------------------------------------------------------
total_elapsed <- difftime(Sys.time(), overall_start, units = "secs")
cat("\n")
cat(strrep("=", 80), "\n")
cat("BACKFILL COMPLETE\n")
cat(strrep("=", 80), "\n")
cat(sprintf("Total:    %d athletes\n", n_total))
cat(sprintf("OK:       %d\n", n_ok))
cat(sprintf("Skipped:  %d (already in DB)\n", n_skipped))
cat(sprintf("Failed:   %d\n", n_failed))
if (n_failed > 0) {
  cat("Failed athletes:\n")
  for (f in failed_list) cat("  -", f, "\n")
}
cat(sprintf("Elapsed:  %.1f s (%.1f min)\n",
            as.numeric(total_elapsed), as.numeric(total_elapsed) / 60))
cat(strrep("=", 80), "\n")
