# force/force_detection.R
#
# Identifies which force plate is the lead leg (front) and which is the
# drive leg (back) based on force-onset heuristics. No plate ID is
# hardcoded — the algorithm works for both RHP and LHP setups.
#
# Exported: identify_plates(json_data)

# Threshold constants (N)
.DRIVE_ONSET_FZ     <- 30    # plate must exceed this at frame 1 to be "drive"
.LEAD_QUIET_FZ      <- 30    # plate must stay below this for first 10% of frames
.LEAD_ACTIVE_FZ     <- 50    # plate must exceed this at some later point
.CLIPPING_FZ        <- 9000  # sensor saturation threshold

# Extract a [n_frames x 3] numeric matrix (Fx, Fy, Fz) for one plate from
# the parsed JSON frames list.
.extract_plate_matrix <- function(frames_list, plate_id) {
  n <- length(frames_list)
  mat <- matrix(0.0, nrow = n, ncol = 3)
  for (i in seq_len(n)) {
    plate_entries <- frames_list[[i]]$force
    if (is.null(plate_entries) || length(plate_entries) == 0) next
    for (pe in plate_entries) {
      if (!is.null(pe$id) && pe$id == plate_id) {
        fxyz <- tryCatch(unlist(pe$data$force), error = function(e) NULL)
        if (!is.null(fxyz) && length(fxyz) >= 3) {
          mat[i, ] <- as.numeric(fxyz[1:3])
        }
        break
      }
    }
  }
  mat
}

# Identify lead, drive, and virtual plates from parsed JSON.
#
# @param json_data  Parsed JSON (from jsonlite::parse_json) of the 3d-data file.
# @return Named list:
#   lead_plate_id    INTEGER or NULL
#   drive_plate_id   INTEGER or NULL
#   virtual_plate_id INTEGER or NULL
#   plate_matrices   Named list of [n_frames x 3] matrices keyed by plate id (character)
#   qa_flags         character vector of flag strings
identify_plates <- function(json_data) {
  qa_flags <- character(0)

  plates_meta <- json_data$force$plates %||% list()
  frames_list <- json_data$frames %||% list()
  n_frames    <- length(frames_list)

  if (n_frames == 0 || length(plates_meta) == 0) {
    return(list(
      lead_plate_id    = NULL,
      drive_plate_id   = NULL,
      virtual_plate_id = NULL,
      plate_matrices   = list(),
      qa_flags         = c(qa_flags, "no_force_data")
    ))
  }

  # Separate virtual from physical plates
  virtual_ids  <- integer(0)
  physical_ids <- integer(0)
  for (pm in plates_meta) {
    pid <- as.integer(pm$id)
    if (isTRUE(pm$virtual)) virtual_ids  <- c(virtual_ids, pid)
    else                     physical_ids <- c(physical_ids, pid)
  }

  # Build Fz vectors for each physical plate
  quiet_frames <- max(1L, floor(n_frames * 0.10))

  candidates_lead  <- integer(0)
  candidates_drive <- integer(0)
  plate_matrices   <- list()

  for (pid in physical_ids) {
    mat <- .extract_plate_matrix(frames_list, pid)
    plate_matrices[[as.character(pid)]] <- mat
    Fz <- mat[, 3]

    # Check for clipping
    if (any(abs(Fz) > .CLIPPING_FZ)) {
      qa_flags <- c(qa_flags, "plate_clipping")
    }

    early_max <- max(abs(Fz[seq_len(quiet_frames)]))
    later_max <- if (n_frames > quiet_frames) max(abs(Fz[(quiet_frames + 1):n_frames])) else 0

    is_quiet_early <- early_max < .LEAD_QUIET_FZ
    has_later_peak <- later_max > .LEAD_ACTIVE_FZ
    has_early_load <- abs(Fz[1]) > .DRIVE_ONSET_FZ

    if (is_quiet_early && has_later_peak) candidates_lead  <- c(candidates_lead, pid)
    if (has_early_load)                   candidates_drive <- c(candidates_drive, pid)
  }

  # Also build virtual plate matrix (first virtual plate)
  virtual_plate_id <- NULL
  if (length(virtual_ids) > 0) {
    virtual_plate_id <- virtual_ids[1]
    vmat <- .extract_plate_matrix(frames_list, virtual_plate_id)
    plate_matrices[[as.character(virtual_plate_id)]] <- vmat
  }

  # Resolve to single lead / drive
  lead_plate_id  <- NULL
  drive_plate_id <- NULL

  if (length(candidates_lead) == 1) {
    lead_plate_id <- candidates_lead
  } else if (length(candidates_lead) > 1) {
    qa_flags      <- c(qa_flags, "ambiguous_lead_plate")
    lead_plate_id <- NULL
  } else {
    qa_flags      <- c(qa_flags, "ambiguous_lead_plate")
    lead_plate_id <- NULL
  }

  # Drive: exclude the lead plate from drive candidates
  drive_cands <- setdiff(candidates_drive, c(lead_plate_id, virtual_ids))
  if (length(drive_cands) == 1) {
    drive_plate_id <- drive_cands
  } else if (length(drive_cands) > 1) {
    # Pick the one with highest early Fz if still ambiguous
    early_fz <- sapply(drive_cands, function(pid) {
      Fz <- plate_matrices[[as.character(pid)]][, 3]
      abs(Fz[1])
    })
    drive_plate_id <- drive_cands[which.max(early_fz)]
  } else {
    # Fallback: any physical plate that isn't lead and isn't virtual
    fallback <- setdiff(physical_ids, c(lead_plate_id, virtual_ids))
    if (length(fallback) >= 1) drive_plate_id <- fallback[1]
  }

  list(
    lead_plate_id    = lead_plate_id,
    drive_plate_id   = drive_plate_id,
    virtual_plate_id = virtual_plate_id,
    plate_matrices   = plate_matrices,
    qa_flags         = qa_flags
  )
}
