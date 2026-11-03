# force/force_detection.R
#
# Identifies lead and drive plates from parsed 3d-data JSON.
# Fixed physical layout (never changes):
#   FP1 = bottom-left landing plate
#   FP2 = bottom-right landing plate
#   FP3 = mound / drive plate  (always drive)
#   FP4 = Qualisys virtual plate (FP1+FP2 or FP1+FP2+FP3 depending on session)
#
# Strategy:
#   drive = FP3 (hardcoded — always the mound plate)
#   lead  = FP4 if present (subtract FP3 if Type B), else sum FP1+FP2
#
# Exported: identify_plates(json_data)

.CLIPPING_FZ <- 9000  # sensor saturation threshold (N)

# Extract a [n_frames x 3] numeric matrix (Fx, Fy, Fz) for one plate.
.extract_plate_matrix <- function(frames_list, plate_id) {
  n   <- length(frames_list)
  mat <- matrix(0.0, nrow = n, ncol = 3)
  for (i in seq_len(n)) {
    plate_entries <- frames_list[[i]]$force
    if (is.null(plate_entries) || length(plate_entries) == 0) next
    for (pe in plate_entries) {
      if (!is.null(pe$id) && pe$id == plate_id) {
        fxyz <- tryCatch(unlist(pe$data$force), error = function(e) NULL)
        if (!is.null(fxyz) && length(fxyz) >= 3) mat[i, ] <- as.numeric(fxyz[1:3])
        break
      }
    }
  }
  mat
}

# Identify lead and drive plates from parsed JSON.
#
# @param json_data  Parsed JSON (from jsonlite::parse_json) of the 3d-data file.
# @return Named list:
#   lead_plate_id    4 (always, or NULL if no landing plates found)
#   drive_plate_id   3 (always, or best fallback)
#   virtual_plate_id NULL (FP4 is the lead plate, not a separate cross-check)
#   plate_matrices   Named list of [n_frames x 3] matrices keyed by plate id
#   qa_flags         character vector
identify_plates <- function(json_data) {
  qa_flags    <- character(0)
  frames_list <- json_data$frames %||% list()
  n_frames    <- length(frames_list)

  if (n_frames == 0) {
    return(list(
      lead_plate_id    = NULL,
      drive_plate_id   = NULL,
      virtual_plate_id = NULL,
      plate_matrices   = list(),
      qa_flags         = c(qa_flags, "no_force_data")
    ))
  }

  # Collect all plate IDs present in the first non-empty frame
  all_ids <- integer(0)
  for (i in seq_len(min(n_frames, 20L))) {
    for (pe in frames_list[[i]]$force %||% list()) {
      pid <- suppressWarnings(as.integer(pe$id))
      if (!is.na(pid)) all_ids <- union(all_ids, pid)
    }
  }

  if (length(all_ids) == 0) {
    return(list(
      lead_plate_id    = NULL,
      drive_plate_id   = NULL,
      virtual_plate_id = NULL,
      plate_matrices   = list(),
      qa_flags         = c(qa_flags, "no_force_data")
    ))
  }

  # Build matrices for all plates found
  plate_matrices <- list()
  for (pid in all_ids) {
    plate_matrices[[as.character(pid)]] <- .extract_plate_matrix(frames_list, pid)
  }

  # ---- Drive: always FP3 (mound plate) ----
  if (3L %in% all_ids) {
    drive_plate_id <- 3L
  } else {
    qa_flags <- c(qa_flags, "no_drive_plate_3")
    # Fallback: plate with highest Fz at frame 1 (most loaded at setup)
    fz_at_1 <- sapply(as.character(all_ids), function(k) abs(plate_matrices[[k]][1, 3]))
    drive_plate_id <- all_ids[which.max(fz_at_1)]
  }
  drive_mat <- plate_matrices[[as.character(drive_plate_id)]]

  # ---- Lead: FP4 if present, else sum FP1+FP2 ----
  if (4L %in% all_ids) {
    fz4      <- plate_matrices[["4"]][, 3]
    fz3      <- drive_mat[, 3]
    fp1_mat  <- if ("1" %in% names(plate_matrices)) plate_matrices[["1"]] else matrix(0, n_frames, 3)
    fp2_mat  <- if ("2" %in% names(plate_matrices)) plate_matrices[["2"]] else matrix(0, n_frames, 3)
    fz12     <- fp1_mat[, 3] + fp2_mat[, 3]

    # Detect FP4 type:
    #   Type B: FP4 = FP1+FP2+FP3 — at frames where FP3 is loaded and FP1+FP2 ≈ 0,
    #           FP4 ≈ FP3 (median > 50 N)
    #   Type A: FP4 = FP1+FP2 only
    drive_only <- (fz3 > 100) & (abs(fz12) < 10)
    if (any(drive_only) && median(fz4[drive_only]) > 50) {
      # Type B: subtract FP3 to isolate landing plates
      lead_mat <- plate_matrices[["4"]] - drive_mat
    } else {
      # Type A: FP4 already equals FP1+FP2
      lead_mat <- plate_matrices[["4"]]
    }
    lead_plate_id <- 4L
  } else {
    # No FP4: sum FP1+FP2 to handle split-plate athletes
    fp1 <- if ("1" %in% names(plate_matrices)) plate_matrices[["1"]] else NULL
    fp2 <- if ("2" %in% names(plate_matrices)) plate_matrices[["2"]] else NULL

    if (!is.null(fp1) && !is.null(fp2)) {
      lead_mat      <- fp1 + fp2
      lead_plate_id <- 4L
      qa_flags      <- c(qa_flags, "fp4_reconstructed")
    } else if (!is.null(fp1)) {
      lead_mat      <- fp1
      lead_plate_id <- 1L
    } else if (!is.null(fp2)) {
      lead_mat      <- fp2
      lead_plate_id <- 2L
    } else {
      qa_flags      <- c(qa_flags, "no_lead_plate")
      lead_plate_id <- NULL
      lead_mat      <- matrix(0.0, n_frames, 3)
    }
  }

  # Store constructed lead matrix under its ID key
  plate_matrices[[as.character(lead_plate_id)]] <- lead_mat

  # Clipping check on individual plates only (FP4/constructed would double-count)
  for (pid_str in setdiff(names(plate_matrices), "4")) {
    if (any(abs(plate_matrices[[pid_str]][, 3]) > .CLIPPING_FZ)) {
      qa_flags <- c(qa_flags, "plate_clipping")
      break
    }
  }

  list(
    lead_plate_id    = lead_plate_id,
    drive_plate_id   = drive_plate_id,
    virtual_plate_id = NULL,  # FP4 is lead plate, no separate cross-check
    plate_matrices   = plate_matrices,
    qa_flags         = qa_flags
  )
}
