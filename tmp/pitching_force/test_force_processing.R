# tests/test_force_processing.R
#
# Unit tests for the GRF force-metrics processing layer.
# Run: Rscript tests/test_force_processing.R
# Exit code 0 = all pass, 1 = any failure.

suppressPackageStartupMessages({
  library(jsonlite)
})

`%||%` <- function(a, b) if (!is.null(a)) a else b

# ---- Source component modules ----
test_dir <- tryCatch({
  args     <- commandArgs(trailingOnly = FALSE)
  file_arg <- args[grepl("--file=", args, fixed = TRUE)]
  if (length(file_arg) > 0) dirname(normalizePath(sub("--file=", "", file_arg[1], fixed = TRUE)))
  else {
    for (i in rev(seq_len(sys.nframe()))) {
      ofile <- tryCatch(sys.frame(i)$ofile, error = function(e) NULL)
      if (!is.null(ofile) && nchar(ofile) > 0) {
        return(dirname(normalizePath(ofile, mustWork = FALSE)))
      }
    }
    getwd()
  }
}, error = function(e) getwd())

pitching_dir <- dirname(test_dir)

for (.sub in c("force/force_detection.R", "force/force_events.R",
               "force/force_metrics.R")) {
  .p <- file.path(pitching_dir, .sub)
  if (!file.exists(.p)) stop("Cannot find ", .p)
  source(.p)
}

`%||%` <- function(a, b) if (!is.null(a)) a else b

# ---- Test framework ----
.passed <- 0L
.failed <- 0L

assert <- function(condition, label) {
  if (isTRUE(condition)) {
    cat(sprintf("  PASS: %s\n", label))
    .passed <<- .passed + 1L
  } else {
    cat(sprintf("  FAIL: %s\n", label))
    .failed <<- .failed + 1L
  }
}

assert_near <- function(actual, expected, tol_pct = 2, label) {
  if (is.null(actual) || is.na(actual) || is.null(expected) || is.na(expected)) {
    cat(sprintf("  FAIL: %s (got NA, expected %.4g)\n", label, expected))
    .failed <<- .failed + 1L
    return()
  }
  pct_err <- 100 * abs(actual - expected) / abs(expected)
  if (pct_err <= tol_pct) {
    cat(sprintf("  PASS: %s (%.4g ≈ %.4g, err=%.2f%%)\n", label, actual, expected, pct_err))
    .passed <<- .passed + 1L
  } else {
    cat(sprintf("  FAIL: %s (got %.4g, expected %.4g, err=%.2f%%)\n",
                label, actual, expected, pct_err))
    .failed <<- .failed + 1L
  }
}

# ==============================================================================
cat("\n=== Test 1: Synthetic trapezoidal integral ===\n")
# ∫sin(x)dx from 0 to 2π = 0; use [0, π] → 2
omega <- 1   # rad/s
dt    <- 1 / 300
t_vec <- seq(0, pi / omega, by = dt)
F_vec <- sin(omega * t_vec)  # sine wave

integral_computed <- trap_integral(F_vec, dt, 1L, length(F_vec))
integral_exact    <- 2 / omega  # ∫₀^π sin(x)dx = 2

assert_near(integral_computed, integral_exact, tol_pct = 0.5,
            "trap_integral: sine wave [0,π] ≈ 2/ω")

# Also verify zero-window edge case
assert(is.na(trap_integral(F_vec, dt, 5L, 3L)),
       "trap_integral: a > b returns NA")

# ==============================================================================
cat("\n=== Test 2: Plate detection heuristic ===\n")

# Helper: build a minimal json_data stub for plate detection tests
make_plate_json <- function(n_frames = 200,
                            drive_plate_id = 3,
                            lead_plate_id  = 1,
                            lead_onset_frame = 60) {
  drive_fz <- rep(500, n_frames)
  lead_fz  <- c(rep(0, lead_onset_frame - 1L), rep(800, n_frames - lead_onset_frame + 1L))

  frames <- lapply(seq_len(n_frames), function(i) {
    list(
      force = list(
        list(id = drive_plate_id, data = list(force = list(0, 0, drive_fz[i]),
                                              moment = list(0,0,0), position = list(0,0,0))),
        list(id = lead_plate_id,  data = list(force = list(0, 0, lead_fz[i]),
                                              moment = list(0,0,0), position = list(0,0,0)))
      )
    )
  })

  list(
    frameRate = 300,
    startTime = 0,
    endTime   = n_frames / 300,
    force = list(
      plates = list(
        list(id = drive_plate_id, virtual = FALSE),
        list(id = lead_plate_id,  virtual = FALSE)
      )
    ),
    labels   = list(),
    segments = list(),
    frames   = frames
  )
}

# Case A: drive=3, lead=1
jd_a <- make_plate_json(drive_plate_id = 3, lead_plate_id = 1, lead_onset_frame = 40)
res_a <- identify_plates(jd_a)
assert(identical(res_a$lead_plate_id,  1L), "Plate detection A: lead_plate_id == 1")
assert(identical(res_a$drive_plate_id, 3L), "Plate detection A: drive_plate_id == 3")
assert(!"ambiguous_lead_plate" %in% res_a$qa_flags,
       "Plate detection A: no ambiguous_lead_plate flag")

# Case B: swapped — drive=1, lead=3
jd_b <- make_plate_json(drive_plate_id = 1, lead_plate_id = 3, lead_onset_frame = 40)
res_b <- identify_plates(jd_b)
assert(identical(res_b$lead_plate_id,  3L), "Plate detection B (swapped): lead_plate_id == 3")
assert(identical(res_b$drive_plate_id, 1L), "Plate detection B (swapped): drive_plate_id == 1")

# Case C: ambiguous (both plates have force from frame 1)
jd_c <- make_plate_json(drive_plate_id = 1, lead_plate_id = 3, lead_onset_frame = 1)
res_c <- identify_plates(jd_c)
assert("ambiguous_lead_plate" %in% res_c$qa_flags,
       "Plate detection C (ambiguous): fires ambiguous_lead_plate flag")

# ==============================================================================
cat("\n=== Test 3: Real fixture trial (Fastball RH 4) ===\n")
fixture_path <- file.path(test_dir, "fixtures", "Fastball RH 4-3d-data.json")

if (!file.exists(fixture_path)) {
  cat("  SKIP: fixture file not found at", fixture_path, "\n")
  cat("        Place Fastball RH 4-3d-data.json in tests/fixtures/ to enable.\n")
} else {
  jtext    <- paste(readLines(fixture_path, warn = FALSE, encoding = "UTF-8"), collapse = "\n")
  jdata    <- jsonlite::parse_json(jtext, simplifyVector = FALSE)
  fr       <- as.numeric(jdata$frameRate %||% 300)
  dt       <- 1 / fr
  st       <- as.numeric(jdata$startTime %||% 0)
  n        <- length(jdata$frames)
  t_vec_f  <- st + (seq_len(n) - 1L) * dt
  BW_n     <- 78 * 9.81   # ~78 kg per handoff

  plates_f <- identify_plates(jdata)
  assert(!is.null(plates_f$lead_plate_id),  "Fixture: lead plate identified")
  assert(!is.null(plates_f$drive_plate_id), "Fixture: drive plate identified")

  lead_mat_raw <- plates_f$plate_matrices[[as.character(plates_f$lead_plate_id)]]

  # Filter
  lead_mat_filt <- lead_mat_raw
  for (col in 1:3) {
    res <- apply_butter_filter(lead_mat_raw[, col], dt, 50)
    lead_mat_filt[, col] <- res$filtered
  }

  events_f <- detect_events(jdata, lead_mat_filt, "right", dt)
  fc_f <- events_f$fc_frame
  br_f <- events_f$br_frame

  assert(!is.null(fc_f), "Fixture: FC detected")
  if (!is.null(fc_f)) assert_near(fc_f, 352, tol_pct = 5, "Fixture: fc_frame ≈ 352")

  lead_m_f <- compute_lead_metrics(lead_mat_filt, fc_f, br_f, events_f$mer_frame, dt, BW_n, t_vec_f)
  assert_near(lead_m_f$lead_peak_vertical_n, 1427, tol_pct = 2, "Fixture: lead peak vertical ≈ 1427 N")
  assert_near(lead_m_f$lead_peak_braking_n,   806, tol_pct = 2, "Fixture: lead peak braking ≈ 806 N")
  assert(isTRUE(lead_m_f$peaks_synced_flag),       "Fixture: peaks_synced_flag == TRUE")
  assert_near(lead_m_f$lead_peak_resultant_bw, 2.14, tol_pct = 3, "Fixture: resultant BW ≈ 2.14")
}

# ==============================================================================
cat("\n=== Test 4: QA flag coverage ===\n")

# 4a. Double-humped Fz → single_impulse_violation
# Two explicit bell-shaped peaks, both above 50% of global peak
dt_qa  <- 1 / 300
n_qa   <- 300
Fz_double <- rep(0.0, n_qa)
# Peak 1: centred at frame 70, 800 N
Fz_double[30:110] <- 800 * sin(pi * (30:110 - 30) / 80)
# Peak 2: centred at frame 195, 720 N (well above 0.5 * 800 = 400)
Fz_double[155:235] <- 720 * sin(pi * (155:235 - 155) / 80)
Fz_double[Fz_double < 0] <- 0

# FC at frame 10, BR at frame 290
peaks_dbl <- detect_impulse_peaks(Fz_double, 10L, 290L, dt_qa,
                                  peak_height_frac = 0.5)
assert(length(peaks_dbl) >= 2, "QA: double-humped trace has >= 2 peaks")

# 4b. Plate clipping flag on a json with Fz > 9000 N
n_clip <- 100
frames_clip <- lapply(seq_len(n_clip), function(i) {
  list(force = list(
    list(id = 1L, data = list(force = list(0, 0, 10000), moment = list(0,0,0), position = list(0,0,0))),
    list(id = 2L, data = list(force = list(0, 0, 500),   moment = list(0,0,0), position = list(0,0,0)))
  ))
})
jd_clip <- list(
  frameRate = 300, startTime = 0, endTime = n_clip / 300,
  force = list(plates = list(
    list(id = 1L, virtual = FALSE),
    list(id = 2L, virtual = FALSE)
  )),
  labels = list(), segments = list(), frames = frames_clip
)
res_clip <- identify_plates(jd_clip)
assert("plate_clipping" %in% res_clip$qa_flags, "QA: Fz > 9000 N triggers plate_clipping flag")

# ==============================================================================
cat(sprintf("\n=== Results: %d passed, %d failed ===\n", .passed, .failed))
if (.failed > 0) quit(save = "no", status = 1)
