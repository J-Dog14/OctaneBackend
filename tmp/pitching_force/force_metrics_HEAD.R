# force/force_metrics.R
#
# All metric computations for the GRF processing layer.
# No database or JSON parsing here — operates on numeric matrices and frame indices.
#
# Exported: compute_lead_metrics(), compute_drive_metrics()
# Internal helpers are prefixed with .fm_

# ---- Butterworth filter ----

# Apply zero-lag 4th-order Butterworth low-pass filter.
# Falls back to unfiltered if `signal` package is unavailable.
# Returns filtered vector (same length as input) and a logical indicating
# whether filtering was applied.
apply_butter_filter <- function(F_vec, dt, cutoff_hz = 50) {
  fs <- 1 / dt
  nyq <- fs / 2
  if (cutoff_hz >= nyq) return(list(filtered = F_vec, applied = FALSE))

  if (!requireNamespace("signal", quietly = TRUE)) {
    return(list(filtered = F_vec, applied = FALSE))
  }
  tryCatch({
    W  <- cutoff_hz / nyq
    bf <- signal::butter(4, W, type = "low")
    fv <- as.numeric(signal::filtfilt(bf, F_vec))
    list(filtered = fv, applied = TRUE)
  }, error = function(e) {
    list(filtered = F_vec, applied = FALSE)
  })
}

# ---- Trapezoidal integral ----

# Discrete trapezoidal rule for uniform sampling.
# a, b are 1-based R indices.
trap_integral <- function(F_vec, dt, a, b) {
  if (is.null(a) || is.null(b) || a > b) return(NA_real_)
  a <- max(1L, as.integer(a))
  b <- min(length(F_vec), as.integer(b))
  s <- F_vec[a:b]
  dt * (sum(s) - 0.5 * s[1] - 0.5 * s[length(s)])
}

# ---- Rate of force development ----

# 20%-to-80% of rise definition (robust to onset noise).
compute_rfd <- function(F_vec, dt, fc_frame, peak_frame) {
  if (is.null(fc_frame) || is.null(peak_frame) || fc_frame >= peak_frame) return(NA_real_)
  F_at_fc  <- F_vec[fc_frame]
  F_at_pk  <- F_vec[peak_frame]
  rise     <- F_at_pk - F_at_fc
  if (abs(rise) < 1e-6) return(NA_real_)

  F_lo <- F_at_fc + 0.20 * rise
  F_hi <- F_at_fc + 0.80 * rise

  window <- F_vec[fc_frame:peak_frame]
  t_lo_local <- which(window >= F_lo)[1]
  t_hi_local <- which(window >= F_hi)[1]

  if (is.na(t_lo_local) || is.na(t_hi_local) || t_lo_local >= t_hi_local) return(NA_real_)

  dF <- F_hi - F_lo
  dt_rise <- (t_hi_local - t_lo_local) * dt
  dF / dt_rise
}

# ---- Single-impulse detection ----

# Lightweight peak finder: returns indices of prominent peaks in F_vec[a:b].
# A peak qualifies when it is a local maximum with height >= min_height and
# separated from the previous qualifying peak by >= min_dist_frames.
detect_impulse_peaks <- function(Fz_vec, fc, br, dt,
                                 peak_height_frac = 0.5,
                                 min_dist_s       = 0.05) {
  if (is.null(fc) || is.null(br) || fc >= br) return(integer(0))
  fc <- as.integer(fc); br <- as.integer(br)
  fc <- max(1L, fc); br <- min(length(Fz_vec), br)

  window      <- Fz_vec[fc:br]
  global_peak <- max(window, na.rm = TRUE)
  min_height  <- peak_height_frac * global_peak
  min_dist    <- max(1L, round(min_dist_s / dt))

  n_w    <- length(window)
  peaks  <- integer(0)
  last_p <- -Inf

  for (i in seq(2, n_w - 1)) {
    if (window[i] >= min_height &&
        window[i] >= window[i - 1] &&
        window[i] >= window[i + 1] &&
        (i - last_p) >= min_dist) {
      peaks  <- c(peaks, i)
      last_p <- i
    }
  }
  peaks
}

# ---- Braking sign detection ----

# Determine the sign convention for the braking (AP) force component on the
# lead plate over the FC→BR window. Returns +1 or -1.
.braking_sign <- function(Fy_vec, fc_frame, br_frame) {
  if (is.null(fc_frame) || is.null(br_frame)) return(-1L)
  window <- Fy_vec[fc_frame:br_frame]
  mean_neg <- mean(window[window < 0], na.rm = TRUE)
  mean_pos <- mean(window[window > 0], na.rm = TRUE)
  mean_neg <- if (is.nan(mean_neg)) 0 else mean_neg
  mean_pos <- if (is.nan(mean_pos)) 0 else mean_pos
  if (abs(mean_neg) >= abs(mean_pos)) -1L else 1L
}

# ---- Lead-leg metrics ----

# Compute all lead-leg metrics.
#
# @param lead_mat  [n_frames x 3] matrix (Fx, Fy, Fz) for lead plate — FILTERED
# @param fc        FC frame index (1-based)
# @param br        BR frame index (1-based)
# @param mer       MER frame index (1-based) or NULL
# @param dt        Time per frame (seconds)
# @param BW_n      Body weight in Newtons
# @param t_vec     Numeric vector of time stamps (length n_frames)
# @return          Flat named list matching f_pitching_force_metrics columns
compute_lead_metrics <- function(lead_mat, fc, br, mer, dt, BW_n, t_vec) {
  out <- list()
  n   <- nrow(lead_mat)
  Fx  <- lead_mat[, 1]
  Fy  <- lead_mat[, 2]
  Fz  <- lead_mat[, 3]
  Fr  <- sqrt(Fx^2 + Fy^2 + Fz^2)

  # Braking component + sign
  b_sign          <- .braking_sign(Fy, fc, br)
  F_brake         <- b_sign * Fy
  out$braking_sign <- as.integer(b_sign)
  out$axis_braking      <- "Fy"
  out$axis_vertical     <- "Fz"
  out$axis_mediolateral <- "Fx"

  # Event-relative time
  out$fc_to_br_duration_s <- if (!is.null(fc) && !is.null(br)) (br - fc) * dt else NA_real_

  # ---------- Peak vertical ----------
  if (!is.null(fc) && !is.null(br)) {
    window_fz <- Fz[fc:br]
    pk_v_local <- which.max(window_fz)
    pk_v_frame <- fc + pk_v_local - 1L
    pk_v_n     <- Fz[pk_v_frame]
    pk_v_t     <- t_vec[pk_v_frame]

    out$lead_peak_vertical_n           <- pk_v_n
    out$lead_peak_vertical_bw          <- pk_v_n / BW_n
    out$lead_peak_vertical_time_s      <- pk_v_t
    out$lead_peak_vertical_pct_fc_br   <- min(1.0, max(0.0, (pk_v_t - t_vec[fc]) / ((br - fc) * dt)))
    out$lead_time_to_peak_fz_ms        <- (pk_v_t - t_vec[fc]) * 1000

    # ---------- Peak braking ----------
    window_fb <- F_brake[fc:br]
    pk_b_local <- which.max(window_fb)
    pk_b_frame <- fc + pk_b_local - 1L
    pk_b_n     <- F_brake[pk_b_frame]
    pk_b_t     <- t_vec[pk_b_frame]

    out$lead_peak_braking_n           <- abs(pk_b_n)
    out$lead_peak_braking_bw          <- abs(pk_b_n) / BW_n
    out$lead_peak_braking_time_s      <- pk_b_t
    out$lead_peak_braking_pct_fc_br   <- min(1.0, max(0.0, (pk_b_t - t_vec[fc]) / ((br - fc) * dt)))

    # ---------- Peak resultant ----------
    window_fr <- Fr[fc:br]
    pk_r_local <- which.max(window_fr)
    pk_r_frame <- fc + pk_r_local - 1L
    pk_r_n     <- Fr[pk_r_frame]
    pk_r_t     <- t_vec[pk_r_frame]

    out$lead_peak_resultant_n           <- pk_r_n
    out$lead_peak_resultant_bw          <- pk_r_n / BW_n
    out$lead_peak_resultant_time_s      <- pk_r_t
    out$lead_peak_resultant_pct_fc_br   <- min(1.0, max(0.0, (pk_r_t - t_vec[fc]) / ((br - fc) * dt)))

    # ---------- Synchrony ----------
    lag_ms <- (pk_v_t - pk_b_t) * 1000
    out$peak_v_to_peak_b_lag_ms <- lag_ms
    out$peaks_synced_flag        <- abs(lag_ms) <= 20

    mer_safe <- if (!is.null(mer)) mer else br
    out$peaks_before_mer_flag    <- max(pk_v_frame, pk_b_frame) < mer_safe

    # ---------- RFD ----------
    out$lead_rfd_vertical_n_per_s  <- compute_rfd(Fz, dt, fc, pk_v_frame)
    out$lead_rfd_vertical_bw_per_s <- if (!is.na(out$lead_rfd_vertical_n_per_s))
      out$lead_rfd_vertical_n_per_s / BW_n else NA_real_
    out$lead_rfd_braking_n_per_s   <- compute_rfd(F_brake, dt, fc, pk_b_frame)
    out$lead_rfd_braking_bw_per_s  <- if (!is.na(out$lead_rfd_braking_n_per_s))
      out$lead_rfd_braking_n_per_s / BW_n else NA_real_

    # ---------- Single impulse ----------
    peaks_idx <- detect_impulse_peaks(Fz, fc, br, dt)
    out$impulse_peak_count  <- length(peaks_idx)
    out$single_impulse_flag <- (length(peaks_idx) == 1)

    # ---------- Impulse windows ----------
    into_ball_frame <- fc + round(.75 * (br - fc))  # default 0.75; overridden by FORCE_INTO_BALL_PCT in orchestrator
    if (!is.null(mer)) {
      into_ball_frame <- min(mer, fc + round(0.75 * (br - fc)))
    }
    mer_safe_frame <- if (!is.null(mer)) mer else br

    out$lead_impulse_v_fc_to_br_ns    <- trap_integral(Fz, dt, fc, br)
    out$lead_impulse_v_fc_to_br_bws   <- out$lead_impulse_v_fc_to_br_ns / BW_n
    out$lead_impulse_v_fc_to_mer_ns   <- trap_integral(Fz, dt, fc, mer_safe_frame)
    out$lead_impulse_v_fc_to_mer_bws  <- out$lead_impulse_v_fc_to_mer_ns / BW_n
    out$lead_impulse_v_into_ball_ns   <- trap_integral(Fz, dt, fc, into_ball_frame)
    out$lead_impulse_v_into_ball_bws  <- out$lead_impulse_v_into_ball_ns / BW_n

    out$lead_impulse_b_fc_to_br_ns    <- trap_integral(F_brake, dt, fc, br)
    out$lead_impulse_b_fc_to_br_bws   <- out$lead_impulse_b_fc_to_br_ns / BW_n
    out$lead_impulse_b_fc_to_mer_ns   <- trap_integral(F_brake, dt, fc, mer_safe_frame)
    out$lead_impulse_b_fc_to_mer_bws  <- out$lead_impulse_b_fc_to_mer_ns / BW_n
    out$lead_impulse_b_into_ball_ns   <- trap_integral(F_brake, dt, fc, into_ball_frame)
    out$lead_impulse_b_into_ball_bws  <- out$lead_impulse_b_into_ball_ns / BW_n

    out$lead_impulse_resultant_fc_to_br_ns   <- trap_integral(Fr, dt, fc, br)
    out$lead_impulse_resultant_into_ball_ns  <- trap_integral(Fr, dt, fc, into_ball_frame)
    out$lead_impulse_resultant_into_ball_bws <- out$lead_impulse_resultant_into_ball_ns / BW_n

    # ---------- Midpoint / "into the ball" instantaneous values ----------
    mid_frame  <- fc + round(0.50 * (br - fc))
    mid_frame  <- max(1L, min(n, mid_frame))
    pct50_frame <- mid_frame

    out$lead_fz_at_50pct_bw       <- Fz[pct50_frame] / BW_n
    out$lead_fz_at_midpoint_bw    <- Fz[mid_frame]   / BW_n
    out$lead_fy_at_midpoint_bw    <- Fy[mid_frame]   / BW_n
    out$lead_resultant_at_midpoint_bw <- Fr[mid_frame] / BW_n

  } else {
    # FC or BR missing — fill with NAs
    na_cols <- c(
      "lead_peak_vertical_n","lead_peak_vertical_bw","lead_peak_vertical_time_s",
      "lead_peak_vertical_pct_fc_br","lead_time_to_peak_fz_ms",
      "lead_peak_braking_n","lead_peak_braking_bw","lead_peak_braking_time_s",
      "lead_peak_braking_pct_fc_br","lead_peak_resultant_n","lead_peak_resultant_bw",
      "lead_peak_resultant_time_s","lead_peak_resultant_pct_fc_br",
      "peak_v_to_peak_b_lag_ms","peaks_synced_flag","peaks_before_mer_flag",
      "single_impulse_flag","impulse_peak_count",
      "lead_rfd_vertical_n_per_s","lead_rfd_vertical_bw_per_s",
      "lead_rfd_braking_n_per_s","lead_rfd_braking_bw_per_s",
      "lead_impulse_v_fc_to_br_ns","lead_impulse_v_fc_to_br_bws",
      "lead_impulse_v_fc_to_mer_ns","lead_impulse_v_fc_to_mer_bws",
      "lead_impulse_v_into_ball_ns","lead_impulse_v_into_ball_bws",
      "lead_impulse_b_fc_to_br_ns","lead_impulse_b_fc_to_br_bws",
      "lead_impulse_b_fc_to_mer_ns","lead_impulse_b_fc_to_mer_bws",
      "lead_impulse_b_into_ball_ns","lead_impulse_b_into_ball_bws",
      "lead_impulse_resultant_fc_to_br_ns","lead_impulse_resultant_into_ball_ns",
      "lead_impulse_resultant_into_ball_bws",
      "lead_fz_at_50pct_bw","lead_fz_at_midpoint_bw",
      "lead_fy_at_midpoint_bw","lead_resultant_at_midpoint_bw",
      "fc_to_br_duration_s"
    )
    for (col in na_cols) out[[col]] <- NA_real_
    out$peaks_synced_flag   <- NA
    out$peaks_before_mer_flag <- NA
    out$single_impulse_flag  <- NA
  }

  out
}

# ---- Drive-leg metrics ----

# Compute drive-leg peaks and handoff timing.
#
# @param drive_mat   [n_frames x 3] matrix (Fx, Fy, Fz) — FILTERED
# @param virtual_mat [n_frames x 3] matrix for virtual plate (or NULL)
# @param lead_mat    [n_frames x 3] matrix for lead plate — for combined peak
# @param fc          FC frame (1-based) or NULL
# @param dt          Time per frame
# @param BW_n        Body weight Newtons
# @param t_vec       Time stamp vector
compute_drive_metrics <- function(drive_mat, virtual_mat, lead_mat, fc, dt, BW_n, t_vec) {
  out <- list()
  n   <- nrow(drive_mat)
  Fz_drive <- drive_mat[, 3]
  Fy_drive <- drive_mat[, 2]

  # Drive peaks (over entire trial — drive leg is active before FC)
  pk_v_drive_frame <- which.max(Fz_drive)
  pk_v_drive_n     <- Fz_drive[pk_v_drive_frame]
  out$drive_peak_vertical_n     <- pk_v_drive_n
  out$drive_peak_vertical_bw    <- pk_v_drive_n / BW_n
  out$drive_peak_vertical_time_s <- t_vec[pk_v_drive_frame]

  b_sign_drive <- .braking_sign(Fy_drive, 1L, n)
  F_brake_drive <- b_sign_drive * Fy_drive
  pk_b_drive_frame <- which.max(F_brake_drive)
  pk_b_drive_n     <- F_brake_drive[pk_b_drive_frame]
  out$drive_peak_braking_n     <- abs(pk_b_drive_n)
  out$drive_peak_braking_bw    <- abs(pk_b_drive_n) / BW_n
  out$drive_peak_braking_time_s <- t_vec[pk_b_drive_frame]

  # Drive unload: last frame before FC where drive Fz > 20% BW
  if (!is.null(fc)) {
    unload_threshold <- 0.20 * BW_n
    search_end   <- min(n, fc)
    search_start <- max(1L, fc - round(0.2 / dt))
    active_frames <- which(Fz_drive[search_start:search_end] > unload_threshold)
    if (length(active_frames) > 0) {
      unload_frame <- search_start + max(active_frames) - 1L
      out$drive_unload_time_s        <- t_vec[unload_frame]
      out$drive_to_lead_handoff_ms   <- (t_vec[fc] - t_vec[unload_frame]) * 1000
    } else {
      out$drive_unload_time_s      <- NA_real_
      out$drive_to_lead_handoff_ms <- NA_real_
    }
  } else {
    out$drive_unload_time_s      <- NA_real_
    out$drive_to_lead_handoff_ms <- NA_real_
  }

  # Virtual plate cross-check
  Fz_lead <- lead_mat[, 3]
  combined_peak <- max(Fz_lead + Fz_drive, na.rm = TRUE)
  out$total_vertical_peak_n <- combined_peak

  if (!is.null(virtual_mat)) {
    Fz_virt    <- virtual_mat[, 3]
    virtual_pk <- max(Fz_virt, na.rm = TRUE)
    if (virtual_pk > 0) {
      xcheck_pct <- 100 * abs(combined_peak - virtual_pk) / virtual_pk
      out$virtual_plate_xcheck_pct <- xcheck_pct
    } else {
      out$virtual_plate_xcheck_pct <- NA_real_
    }
  } else {
    out$virtual_plate_xcheck_pct <- NA_real_
  }

  out
}
