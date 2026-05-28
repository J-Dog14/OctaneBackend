# force/force_events.R
#
# Option-A event detection (self-contained — does not depend on Visual3D XML).
# Detects Foot Contact (FC), Ball Release (BR), and Max External Rotation (MER)
# directly from the time-series data in the 3d-data JSON.
#
# Exported: detect_events(json_data, lead_plate_mat, handedness, dt)

# --- constants ---
.FC_THRESHOLD_N    <- 50     # lead-plate resultant force to detect initial contact onset
.FC_QUIET_PCT      <- 0.10   # first 10% of frames must be quiet before onset can fire
.MER_EULER_IDX     <- 3L     # 1-based; rotZ of arm segment (confirmed: rotZ = GH ER)

# Segment names in order as they appear in the Qualisys/Visual3D JSON export.
# Index lookup is by name, not position.
.SEGMENT_NAMES <- c(
  "Pelvis","RThigh","RLeg","RFoot",
  "LThigh","LLeg","LFoot",
  "Thorax",
  "RArm","RForearm","RHand",
  "LArm","LForearm","LHand",
  "Head"
)

# Marker names expected in the JSON labels array (subset used for BR detection).
.HAND_MARKER_R <- c("right_hand", "RHand", "R_HAND", "RHAND")
.HAND_MARKER_L <- c("left_hand",  "LHand", "L_HAND", "LHAND")

# --- helpers ---

# Find 1-based index of segment name in a names vector (case-insensitive).
.seg_idx <- function(name, seg_names) {
  idx <- which(tolower(seg_names) == tolower(name))
  if (length(idx) == 0) NULL else idx[1]
}

# Detect initial force onset on lead plate BEFORE kinematic FC.
# Scans from after the quiet period up to (not including) fc_frame.
# Returns 1-based frame index or NULL.
.detect_initial_contact <- function(lead_mat, fc_frame) {
  if (is.null(fc_frame)) return(NULL)
  n         <- nrow(lead_mat)
  quiet_end <- max(1L, floor(n * .FC_QUIET_PCT))
  end       <- min(fc_frame - 1L, n)
  if (quiet_end > end) return(NULL)

  Fx <- lead_mat[quiet_end:end, 1]
  Fy <- lead_mat[quiet_end:end, 2]
  Fz <- lead_mat[quiet_end:end, 3]
  Fr <- sqrt(Fx^2 + Fy^2 + Fz^2)

  active <- which(Fr > .FC_THRESHOLD_N)
  if (length(active) == 0) return(NULL)
  quiet_end + active[1] - 1L
}

# Detect Max External Rotation: frame of minimum rotZ of arm segment within
# [fc_frame, br_frame].
.detect_mer <- function(json_data, handedness, fc_frame, br_frame, n_frames) {
  seg_names <- tryCatch(
    sapply(json_data$segments, function(s) s$name),
    error = function(e) character(0)
  )
  frames_list <- json_data$frames %||% list()

  throwing_right <- !identical(tolower(as.character(handedness)), "left")
  arm_name <- if (throwing_right) "RArm" else "LArm"
  arm_idx  <- .seg_idx(arm_name, seg_names)

  if (is.null(arm_idx)) return(NULL)

  search_start <- if (!is.null(fc_frame)) fc_frame else 1L
  search_end   <- if (!is.null(br_frame)) br_frame  else n_frames
  search_start <- max(1L, search_start)
  search_end   <- min(n_frames, search_end)

  rot_z <- tryCatch({
    sapply(frames_list[search_start:search_end], function(f) {
      sr <- f$segmentRot
      if (is.null(sr) || length(sr) < arm_idx) return(NA_real_)
      rot <- tryCatch(unlist(sr[[arm_idx]]), error = function(e) NULL)
      if (!is.null(rot) && length(rot) >= .MER_EULER_IDX)
        as.numeric(rot[.MER_EULER_IDX])
      else NA_real_
    })
  }, error = function(e) rep(NA_real_, search_end - search_start + 1))

  valid <- !is.na(rot_z)
  if (!any(valid)) return(NULL)
  search_start + which.min(rot_z[valid]) - 1L
}

# Resolve FC and BR from QTM-exported timing events (stored in
# f_pitching_trials.metrics), detect initial contact and MER algorithmically.
#
# @param json_data      Parsed JSON (from jsonlite::parse_json).
# @param lead_plate_mat [n_frames x 3] numeric matrix — FILTERED.
# @param handedness     "right" or "left".
# @param dt             Time per frame (seconds).
# @param footstrike_s   TIMING.FootstrikeTime.X value (seconds, from DB).
# @param release_s      TIMING.ReleaseTime.X value (seconds, from DB).
# @return Named list: fc_frame, br_frame, mer_frame, initial_contact_frame,
#                     foot_loading_time_ms, qa_flags
detect_events <- function(json_data, lead_plate_mat, handedness, dt,
                          footstrike_s, release_s) {
  qa_flags <- character(0)
  n_frames <- nrow(lead_plate_mat)
  fr       <- round(1 / dt)

  if (is.null(footstrike_s) || is.na(footstrike_s))
    stop("No FootstrikeTime in f_pitching_trials.metrics")
  if (is.null(release_s) || is.na(release_s))
    stop("No ReleaseTime in f_pitching_trials.metrics")

  fc_frame <- min(n_frames, max(1L, round(footstrike_s * fr)))
  br_frame <- min(n_frames, max(1L, round(release_s    * fr)))

  if (br_frame <= fc_frame)
    stop(sprintf("BR frame (%d) <= FC frame (%d) — invalid event order",
                 br_frame, fc_frame))

  ic_frame <- .detect_initial_contact(lead_plate_mat, fc_frame)
  foot_loading_ms <- if (!is.null(ic_frame))
    (fc_frame - ic_frame) * dt * 1000 else NA_real_

  mer_frame <- .detect_mer(json_data, handedness, fc_frame, br_frame, n_frames)
  if (!is.null(mer_frame) &&
      (mer_frame < fc_frame || mer_frame > br_frame)) {
    qa_flags  <- c(qa_flags, "mer_outside_window")
    mer_frame <- min(max(mer_frame, fc_frame), br_frame)
  }

  list(
    fc_frame             = fc_frame,
    br_frame             = br_frame,
    mer_frame            = mer_frame,
    initial_contact_frame = ic_frame,
    foot_loading_time_ms  = foot_loading_ms,
    qa_flags             = qa_flags
  )
}
