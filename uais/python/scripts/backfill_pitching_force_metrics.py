#!/usr/bin/env python3
"""
backfill_pitching_force_metrics.py

For every trial that has data in f_pitching_force_data but no row in
f_pitching_force_metrics, compute GRF force metrics from the database and
insert the results.  No file I/O — all source data comes from the DB.

Usage (run from the uais/ directory):
    python python/scripts/backfill_pitching_force_metrics.py --dry-run
    python python/scripts/backfill_pitching_force_metrics.py
    python python/scripts/backfill_pitching_force_metrics.py --athlete-uuid <uuid>
    python python/scripts/backfill_pitching_force_metrics.py --limit 10
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from scipy.signal import butter, filtfilt

_uais_root = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_uais_root))
from python.common.athlete_manager import get_warehouse_connection  # noqa: E402

# ── constants (match R exactly) ───────────────────────────────────────────────
FILTER_HZ          = 50
FC_THRESHOLD_N     = 50
FC_QUIET_PCT       = 0.10
BR_DROP_PCT        = 0.20
INTO_BALL_PCT      = 0.75
DRIVE_ONSET_FZ     = 30
LEAD_QUIET_FZ      = 30
LEAD_ACTIVE_FZ     = 50
CLIPPING_FZ        = 9000
SHORT_TRIAL_FRAMES = 10   # ~33 ms; force-plate FC windows are naturally shorter than kinematic
MER_ROT_IDX        = 2   # 0-based index of rotZ in [rx, ry, rz]
PROCESSOR_VERSION  = "1.1.0"

HAND_MARKERS_R = ["right_hand", "rhand", "r_hand"]
HAND_MARKERS_L = ["left_hand",  "lhand", "l_hand"]

# ── SQL ───────────────────────────────────────────────────────────────────────
_FIND_SELECT = """
    SELECT
        fd.athlete_uuid,
        fd.session_date,
        fd.source_system,
        fd.source_athlete_id,
        fd.owner_filename,
        fd.trial_index,
        td.frame_rate,
        td.start_time,
        td.handedness,
        td.weight
    FROM public.f_pitching_force_data fd
    LEFT JOIN public.f_pitching_time_data td
        ON  fd.athlete_uuid = td.athlete_uuid
        AND fd.session_date = td.session_date
        AND fd.trial_index  = td.trial_index
"""

FIND_MISSING = _FIND_SELECT + """
    LEFT JOIN public.f_pitching_force_metrics fm
        ON  fd.athlete_uuid = fm.athlete_uuid
        AND fd.session_date = fm.session_date
        AND fd.trial_index  = fm.trial_index
    WHERE fm.id IS NULL
"""

FIND_ALL = _FIND_SELECT + "WHERE 1=1"

FETCH_FORCE   = "SELECT data FROM public.f_pitching_force_data WHERE athlete_uuid=%s AND session_date=%s AND trial_index=%s"
FETCH_MARKERS = "SELECT data, label_names FROM public.f_pitching_marker_data WHERE athlete_uuid=%s AND session_date=%s AND trial_index=%s"
FETCH_SEG_ROT = "SELECT data, segment_names FROM public.f_pitching_segment_rot_data WHERE athlete_uuid=%s AND session_date=%s AND trial_index=%s"
FETCH_TIMING  = "SELECT metrics FROM public.f_pitching_trials WHERE athlete_uuid=%s AND session_date=%s AND trial_index=%s LIMIT 1"

ENSURE_TABLE = """
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
  lead_plate_id                   INTEGER,
  drive_plate_id                  INTEGER,
  braking_sign                    SMALLINT,
  axis_braking                    VARCHAR(2),
  axis_vertical                   VARCHAR(2),
  axis_mediolateral               VARCHAR(2),
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
  peak_v_to_peak_b_lag_ms         NUMERIC,
  peaks_synced_flag               BOOLEAN,
  peaks_before_mer_flag           BOOLEAN,
  single_impulse_flag             BOOLEAN,
  impulse_peak_count              INTEGER,
  lead_rfd_vertical_n_per_s       NUMERIC,
  lead_rfd_vertical_bw_per_s      NUMERIC,
  lead_rfd_braking_n_per_s        NUMERIC,
  lead_rfd_braking_bw_per_s       NUMERIC,
  lead_time_to_peak_fz_ms         NUMERIC,
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
  lead_impulse_resultant_fc_to_br_ns   NUMERIC,
  lead_impulse_resultant_into_ball_ns  NUMERIC,
  lead_impulse_resultant_into_ball_bws NUMERIC,
  lead_fz_at_50pct_bw             NUMERIC,
  lead_fz_at_midpoint_bw          NUMERIC,
  lead_fy_at_midpoint_bw          NUMERIC,
  lead_resultant_at_midpoint_bw   NUMERIC,
  drive_peak_vertical_n           NUMERIC,
  drive_peak_vertical_bw          NUMERIC,
  drive_peak_vertical_time_s      NUMERIC,
  drive_peak_braking_n            NUMERIC,
  drive_peak_braking_bw           NUMERIC,
  drive_peak_braking_time_s       NUMERIC,
  drive_unload_time_s             NUMERIC,
  drive_to_lead_handoff_ms        NUMERIC,
  total_vertical_peak_n           NUMERIC,
  virtual_plate_xcheck_pct        NUMERIC,
  qa_flags                        TEXT[],
  qa_warnings_json                JSONB,
  processor_version               VARCHAR(20) NOT NULL,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT f_pitching_force_metrics_fkey
    FOREIGN KEY (athlete_uuid) REFERENCES analytics.d_athletes(athlete_uuid) ON DELETE CASCADE,
  CONSTRAINT f_pitching_force_metrics_unique
    UNIQUE (athlete_uuid, session_date, trial_index)
)
"""

UPSERT_METRICS = """
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
        %s,%s,%s,%s, %s,%s,%s,%s,%s,
        %s,%s,%s,%s,%s,%s,
        %s,%s,%s,%s,%s,%s,
        %s,%s,%s,
        %s,
        %s,%s,%s,%s, %s,%s,%s,%s,
        %s,%s,%s,%s,
        %s,%s,%s,%s,%s,
        %s,%s,%s,%s,%s,
        %s,%s,%s,%s,%s,%s,
        %s,%s,%s,%s,%s,%s,
        %s,%s,%s,
        %s,%s,%s,%s,
        %s,%s,%s,%s,%s,%s,
        %s,%s,%s,%s,
        %s,%s::jsonb,%s
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
"""


# ── helpers ───────────────────────────────────────────────────────────────────

def _parse_json(v):
    if v is None:
        return None
    if isinstance(v, str):
        return json.loads(v)
    return v


def _safe_div(a, b):
    if a is None or b is None or b == 0:
        return None
    return float(a) / float(b)


def _f(v):
    return None if v is None else float(v)


def _to_python(v):
    """Convert numpy scalars to native Python types so psycopg2 can serialize them."""
    if isinstance(v, np.floating):
        return float(v)
    if isinstance(v, np.integer):
        return int(v)
    if isinstance(v, np.bool_):
        return bool(v)
    return v


def _get_timing_s(metrics: dict, key: str):
    """Extract a scalar time value (seconds) from the trial metrics JSONB dict.

    Values may be stored as a scalar float or a single-element list (depending on
    whether QTM exported one vs. multiple values for the metric).
    Returns None if the key is missing or the value cannot be parsed as float.
    """
    val = metrics.get(key) if metrics else None
    if val is None:
        return None
    if isinstance(val, list):
        val = val[0] if val else None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


# ── plate extraction / identification ─────────────────────────────────────────

def extract_plate_matrix(force_data_list, plate_id):
    """Build [n×3] (Fx,Fy,Fz) matrix for one plate from per-frame force list."""
    n = len(force_data_list)
    mat = np.zeros((n, 3), dtype=float)
    for i, frame_force in enumerate(force_data_list):
        if not frame_force:
            continue
        for pe in frame_force:
            if pe.get("id") == plate_id:
                fxyz = pe.get("data", {}).get("force", [])
                if len(fxyz) >= 3:
                    mat[i, :] = [float(fxyz[0]), float(fxyz[1]), float(fxyz[2])]
                break
    return mat


def identify_plates(force_data_list):
    """Fixed physical plate layout:
      FP1 = bottom-left landing plate  (individual)
      FP2 = bottom-right landing plate (individual)
      FP3 = mound/drive plate          (always drive)
      FP4 = Qualisys total virtual     (FP1+FP2+FP3 combined)

    In 4-plate sessions:
      - drive_mat = FP3
      - lead_mat  = FP4 - FP3 = FP1+FP2  (quiet before FC, correct at landing;
                                            captures split-plate scenarios accurately)
      - lead_plate_id = 4

    In 3-plate sessions:
      - drive_mat = FP3
      - lead_mat  = whichever of FP1/FP2 has higher peak Fz
      - lead_plate_id = that plate's integer ID
    """
    qa_flags = []
    n = len(force_data_list)

    all_ids: set = set()
    for frame_force in force_data_list:
        if frame_force:
            for pe in frame_force:
                pid = pe.get("id")
                if pid is not None:
                    all_ids.add(int(pid))
    plate_ids = sorted(all_ids)

    if n == 0 or not plate_ids:
        return {"lead_mat": None, "drive_mat": None,
                "lead_plate_id": None, "drive_plate_id": None,
                "plate_matrices": {}, "qa_flags": ["no_force_data"]}

    plate_matrices: dict = {}
    for pid in plate_ids:
        plate_matrices[pid] = extract_plate_matrix(force_data_list, pid)

    # Drive is always FP3 (mound plate)
    if 3 in plate_ids:
        drive_plate_id = 3
    else:
        qa_flags.append("no_drive_plate_3")
        drive_plate_id = max(plate_ids, key=lambda p: abs(float(plate_matrices[p][0, 2])))

    drive_mat = plate_matrices[drive_plate_id]

    if 4 in plate_ids:
        # Qualisys exports FP4 in two configurations:
        #   Type A: FP4 = FP1+FP2           (older sessions ~2024-06 to 2025-05)
        #   Type B: FP4 = FP1+FP2+FP3 total (newer sessions ~2024-09 onward)
        # Detect type: at frames where FP3 is loaded (>100N) and FP1+FP2 ≈ 0,
        # Type B has FP4 ≈ FP3 (med > 50N); Type A has FP4 ≈ 0 (med ≤ 50N).
        fz3 = drive_mat[:, 2]
        fz12 = (plate_matrices.get(1, np.zeros((n, 3)))[:, 2]
                + plate_matrices.get(2, np.zeros((n, 3)))[:, 2])
        fz4 = plate_matrices[4][:, 2]
        drive_only_frames = (fz3 > 100) & (np.abs(fz12) < 10)

        if np.any(drive_only_frames) and float(np.median(fz4[drive_only_frames])) > 50:
            # Type B: FP4 = total. Lead = FP4 - FP3 = FP1+FP2.
            lead_mat = plate_matrices[4] - drive_mat
        else:
            # Type A: FP4 = FP1+FP2. Use directly.
            lead_mat = plate_matrices[4]
        lead_plate_id = 4
    else:
        # No FP4: reconstruct by summing FP1+FP2 (handles split-plate scenarios).
        # Treat the result as plate ID 4 (virtual) so downstream code is consistent.
        fp1 = plate_matrices.get(1)
        fp2 = plate_matrices.get(2)
        if fp1 is not None and fp2 is not None:
            lead_mat      = fp1 + fp2
            lead_plate_id = 4
            qa_flags.append("fp4_reconstructed")
        elif fp1 is not None:
            lead_mat      = fp1
            lead_plate_id = 1
        elif fp2 is not None:
            lead_mat      = fp2
            lead_plate_id = 2
        else:
            qa_flags.append("no_lead_plate")
            lead_plate_id = None
            lead_mat      = np.zeros((n, 3))

    # Clipping check across FP1+FP2 only (FP4 and FP3 would double-count)
    for pid in [p for p in plate_ids if p not in (4,)]:
        if np.any(np.abs(plate_matrices[pid][:, 2]) > CLIPPING_FZ):
            qa_flags.append("plate_clipping")
            break

    return {
        "lead_mat":      lead_mat,
        "drive_mat":     drive_mat,
        "lead_plate_id":  lead_plate_id,
        "drive_plate_id": drive_plate_id,
        "plate_matrices": plate_matrices,
        "qa_flags":       qa_flags,
    }


# ── signal processing ─────────────────────────────────────────────────────────

def apply_butter_filter(F_vec, dt, cutoff_hz=FILTER_HZ):
    fs = 1.0 / dt
    nyq = fs / 2.0
    if cutoff_hz >= nyq or len(F_vec) < 13:
        return F_vec.copy(), False
    try:
        b, a = butter(4, cutoff_hz / nyq, btype="low")
        return filtfilt(b, a, F_vec), True
    except Exception:
        return F_vec.copy(), False


def trap_integral(F_vec, dt, a, b):
    """Trapezoidal integral over [a,b] inclusive (0-based)."""
    if a is None or b is None or a > b:
        return None
    a = max(0, int(a))
    b = min(len(F_vec) - 1, int(b))
    s = F_vec[a:b + 1]
    return float(dt * (np.sum(s) - 0.5 * s[0] - 0.5 * s[-1]))


def compute_rfd(F_vec, dt, fc, peak):
    """Rate of force development using 20%–80% rise (0-based indices)."""
    if fc is None or peak is None or fc >= peak:
        return None
    F_fc = F_vec[fc]
    F_pk = F_vec[peak]
    rise = F_pk - F_fc
    if abs(rise) < 1e-6:
        return None
    F_lo = F_fc + 0.20 * rise
    F_hi = F_fc + 0.80 * rise
    window = F_vec[fc:peak + 1]
    lo_idx = np.where(window >= F_lo)[0]
    hi_idx = np.where(window >= F_hi)[0]
    if len(lo_idx) == 0 or len(hi_idx) == 0 or lo_idx[0] >= hi_idx[0]:
        return None
    return float((F_hi - F_lo) / ((hi_idx[0] - lo_idx[0]) * dt))


def detect_impulse_peaks(Fz, fc, br, dt, peak_height_frac=0.5, min_dist_s=0.05):
    """Return 0-based local indices of prominent peaks in Fz[fc:br+1]."""
    if fc is None or br is None or fc >= br:
        return []
    fc = max(0, int(fc))
    br = min(len(Fz) - 1, int(br))
    window = Fz[fc:br + 1]
    global_peak = float(np.max(window))
    min_height = peak_height_frac * global_peak
    min_dist = max(1, round(min_dist_s / dt))
    n_w = len(window)
    peaks = []
    last_p = -float("inf")
    for i in range(1, n_w - 1):
        if (window[i] >= min_height and
                window[i] >= window[i - 1] and
                window[i] >= window[i + 1] and
                (i - last_p) >= min_dist):
            peaks.append(i)
            last_p = i
    return peaks


def braking_sign(Fy_vec, fc, br):
    if fc is None or br is None:
        return -1
    w = Fy_vec[fc:br + 1]
    neg = w[w < 0]
    pos = w[w > 0]
    mean_neg = float(np.mean(neg)) if len(neg) > 0 else 0.0
    mean_pos = float(np.mean(pos)) if len(pos) > 0 else 0.0
    return -1 if abs(mean_neg) >= abs(mean_pos) else 1


# ── event detection ───────────────────────────────────────────────────────────

def detect_initial_contact(lead_mat, fc):
    """Return 0-based frame of first force onset BEFORE kinematic FC.

    Scans from after the quiet period up to (not including) the kinematic FC
    frame and returns the first frame where lead plate resultant exceeds
    FC_THRESHOLD_N.  Returns None if no such frame exists.
    """
    if fc is None:
        return None
    n = len(lead_mat)
    quiet_end = max(0, int(n * FC_QUIET_PCT))
    end = min(fc, n)
    if quiet_end >= end:
        return None
    Fr = np.sqrt(np.sum(lead_mat[quiet_end:end] ** 2, axis=1))
    active = np.where(Fr > FC_THRESHOLD_N)[0]
    return int(quiet_end + active[0]) if len(active) > 0 else None


def detect_mer(seg_rot_data_list, segment_names_list, handedness, fc, br, n):
    """Return 0-based index of max external rotation or None."""
    if not seg_rot_data_list or not segment_names_list:
        return None
    throwing_right = (str(handedness or "right")).lower() != "left"
    arm_name = "rarm" if throwing_right else "larm"
    seg_lower = [str(s).lower() for s in segment_names_list]
    if arm_name not in seg_lower:
        return None
    arm_idx = seg_lower.index(arm_name)

    search_start = max(0, fc if fc is not None else 0)
    search_end = min(n, br if br is not None else n)

    rot_z = []
    for i in range(search_start, search_end):
        frame = seg_rot_data_list[i] if i < len(seg_rot_data_list) else None
        if frame and len(frame) > arm_idx:
            rot = frame[arm_idx]
            try:
                rot_z.append(float(rot[MER_ROT_IDX]))
            except (TypeError, IndexError):
                rot_z.append(float("nan"))
        else:
            rot_z.append(float("nan"))

    rot_arr = np.array(rot_z)
    valid = ~np.isnan(rot_arr)
    if not np.any(valid):
        return None
    valid_idx = np.where(valid)[0]
    min_local = int(valid_idx[np.argmin(rot_arr[valid_idx])])
    return search_start + min_local


def validate_events(fc, br, mer):
    qa_flags = []
    if fc is not None and br is not None:
        if (br - fc) < SHORT_TRIAL_FRAMES:
            qa_flags.append("short_trial")
        if mer is not None and (mer < fc or mer > br):
            qa_flags.append("mer_outside_window")
            mer = max(fc, min(mer, br))
    return fc, br, mer, qa_flags


# ── metric computation ────────────────────────────────────────────────────────

def compute_lead_metrics(lead_mat, fc, br, mer, dt, BW_n, t_vec):
    out: dict = {}
    n = len(lead_mat)
    Fx = lead_mat[:, 0]
    Fy = lead_mat[:, 1]
    Fz = lead_mat[:, 2]
    Fr = np.sqrt(Fx ** 2 + Fy ** 2 + Fz ** 2)

    bs = braking_sign(Fy, fc, br)
    F_brake = bs * Fy
    out["braking_sign"]    = int(bs)
    out["axis_braking"]    = "Fy"
    out["axis_vertical"]   = "Fz"
    out["axis_mediolateral"] = "Fx"

    if fc is not None and br is not None:
        fc_br_dur = (br - fc) * dt
        out["fc_to_br_duration_s"] = _f(fc_br_dur)

        # Peak vertical
        wfz = Fz[fc:br + 1]
        pv_loc = int(np.argmax(wfz))
        pv_idx = fc + pv_loc
        pv_n = float(Fz[pv_idx])
        pv_t = float(t_vec[pv_idx])
        out["lead_peak_vertical_n"]          = pv_n
        out["lead_peak_vertical_bw"]         = pv_n / BW_n
        out["lead_peak_vertical_time_s"]     = pv_t
        out["lead_peak_vertical_pct_fc_br"]  = min(1.0, max(0.0, (pv_t - t_vec[fc]) / fc_br_dur))
        out["lead_time_to_peak_fz_ms"]       = (pv_t - t_vec[fc]) * 1000

        # Peak braking
        wfb = F_brake[fc:br + 1]
        pb_loc = int(np.argmax(wfb))
        pb_idx = fc + pb_loc
        pb_n = float(F_brake[pb_idx])
        pb_t = float(t_vec[pb_idx])
        out["lead_peak_braking_n"]           = abs(pb_n)
        out["lead_peak_braking_bw"]          = abs(pb_n) / BW_n
        out["lead_peak_braking_time_s"]      = pb_t
        out["lead_peak_braking_pct_fc_br"]   = min(1.0, max(0.0, (pb_t - t_vec[fc]) / fc_br_dur))

        # Peak resultant
        wfr = Fr[fc:br + 1]
        pr_loc = int(np.argmax(wfr))
        pr_idx = fc + pr_loc
        pr_n = float(Fr[pr_idx])
        pr_t = float(t_vec[pr_idx])
        out["lead_peak_resultant_n"]          = pr_n
        out["lead_peak_resultant_bw"]         = pr_n / BW_n
        out["lead_peak_resultant_time_s"]     = pr_t
        out["lead_peak_resultant_pct_fc_br"]  = min(1.0, max(0.0, (pr_t - t_vec[fc]) / fc_br_dur))

        # Synchrony
        lag_ms = (pv_t - pb_t) * 1000
        out["peak_v_to_peak_b_lag_ms"]  = _f(lag_ms)
        out["peaks_synced_flag"]        = bool(abs(lag_ms) <= 20)
        mer_safe = mer if mer is not None else br
        out["peaks_before_mer_flag"]    = bool(max(pv_idx, pb_idx) < mer_safe)

        # RFD
        rfd_v = compute_rfd(Fz, dt, fc, pv_idx)
        out["lead_rfd_vertical_n_per_s"]  = _f(rfd_v)
        out["lead_rfd_vertical_bw_per_s"] = _safe_div(rfd_v, BW_n)
        rfd_b = compute_rfd(F_brake, dt, fc, pb_idx)
        out["lead_rfd_braking_n_per_s"]   = _f(rfd_b)
        out["lead_rfd_braking_bw_per_s"]  = _safe_div(rfd_b, BW_n)

        # Single impulse
        peaks = detect_impulse_peaks(Fz, fc, br, dt)
        out["impulse_peak_count"]  = len(peaks)
        out["single_impulse_flag"] = bool(len(peaks) == 1)

        # Impulse windows
        into_ball = fc + round(INTO_BALL_PCT * (br - fc))
        if mer is not None:
            into_ball = min(mer, into_ball)
        mer_frame = mer if mer is not None else br

        iv_br   = trap_integral(Fz, dt, fc, br)
        iv_mer  = trap_integral(Fz, dt, fc, mer_frame)
        iv_ib   = trap_integral(Fz, dt, fc, into_ball)
        ib_br   = trap_integral(F_brake, dt, fc, br)
        ib_mer  = trap_integral(F_brake, dt, fc, mer_frame)
        ib_ib   = trap_integral(F_brake, dt, fc, into_ball)
        ir_br   = trap_integral(Fr, dt, fc, br)
        ir_ib   = trap_integral(Fr, dt, fc, into_ball)

        out["lead_impulse_v_fc_to_br_ns"]           = iv_br
        out["lead_impulse_v_fc_to_br_bws"]          = _safe_div(iv_br, BW_n)
        out["lead_impulse_v_fc_to_mer_ns"]          = iv_mer
        out["lead_impulse_v_fc_to_mer_bws"]         = _safe_div(iv_mer, BW_n)
        out["lead_impulse_v_into_ball_ns"]          = iv_ib
        out["lead_impulse_v_into_ball_bws"]         = _safe_div(iv_ib, BW_n)
        out["lead_impulse_b_fc_to_br_ns"]           = ib_br
        out["lead_impulse_b_fc_to_br_bws"]          = _safe_div(ib_br, BW_n)
        out["lead_impulse_b_fc_to_mer_ns"]          = ib_mer
        out["lead_impulse_b_fc_to_mer_bws"]         = _safe_div(ib_mer, BW_n)
        out["lead_impulse_b_into_ball_ns"]          = ib_ib
        out["lead_impulse_b_into_ball_bws"]         = _safe_div(ib_ib, BW_n)
        out["lead_impulse_resultant_fc_to_br_ns"]   = ir_br
        out["lead_impulse_resultant_into_ball_ns"]  = ir_ib
        out["lead_impulse_resultant_into_ball_bws"] = _safe_div(ir_ib, BW_n)

        # Midpoint instantaneous
        mid = max(0, min(n - 1, fc + round(0.50 * (br - fc))))
        out["lead_fz_at_50pct_bw"]            = float(Fz[mid]) / BW_n
        out["lead_fz_at_midpoint_bw"]         = float(Fz[mid]) / BW_n
        out["lead_fy_at_midpoint_bw"]         = float(Fy[mid]) / BW_n
        out["lead_resultant_at_midpoint_bw"]  = float(Fr[mid]) / BW_n
    else:
        na_keys = [
            "fc_to_br_duration_s",
            "lead_peak_vertical_n", "lead_peak_vertical_bw", "lead_peak_vertical_time_s",
            "lead_peak_vertical_pct_fc_br", "lead_time_to_peak_fz_ms",
            "lead_peak_braking_n", "lead_peak_braking_bw", "lead_peak_braking_time_s",
            "lead_peak_braking_pct_fc_br", "lead_peak_resultant_n", "lead_peak_resultant_bw",
            "lead_peak_resultant_time_s", "lead_peak_resultant_pct_fc_br",
            "peak_v_to_peak_b_lag_ms", "peaks_synced_flag", "peaks_before_mer_flag",
            "single_impulse_flag", "impulse_peak_count",
            "lead_rfd_vertical_n_per_s", "lead_rfd_vertical_bw_per_s",
            "lead_rfd_braking_n_per_s", "lead_rfd_braking_bw_per_s",
            "lead_impulse_v_fc_to_br_ns", "lead_impulse_v_fc_to_br_bws",
            "lead_impulse_v_fc_to_mer_ns", "lead_impulse_v_fc_to_mer_bws",
            "lead_impulse_v_into_ball_ns", "lead_impulse_v_into_ball_bws",
            "lead_impulse_b_fc_to_br_ns", "lead_impulse_b_fc_to_br_bws",
            "lead_impulse_b_fc_to_mer_ns", "lead_impulse_b_fc_to_mer_bws",
            "lead_impulse_b_into_ball_ns", "lead_impulse_b_into_ball_bws",
            "lead_impulse_resultant_fc_to_br_ns", "lead_impulse_resultant_into_ball_ns",
            "lead_impulse_resultant_into_ball_bws",
            "lead_fz_at_50pct_bw", "lead_fz_at_midpoint_bw",
            "lead_fy_at_midpoint_bw", "lead_resultant_at_midpoint_bw",
        ]
        for k in na_keys:
            out[k] = None
    return out


def compute_drive_metrics(drive_mat, virtual_mat, lead_mat, fc, dt, BW_n, t_vec):
    out: dict = {}
    n = len(drive_mat)
    Fz_d = drive_mat[:, 2]
    Fy_d = drive_mat[:, 1]

    pv_idx = int(np.argmax(Fz_d))
    pv_n = float(Fz_d[pv_idx])
    out["drive_peak_vertical_n"]      = pv_n
    out["drive_peak_vertical_bw"]     = pv_n / BW_n
    out["drive_peak_vertical_time_s"] = float(t_vec[pv_idx])

    bs = braking_sign(Fy_d, 0, n - 1)
    F_brake_d = bs * Fy_d
    pb_idx = int(np.argmax(F_brake_d))
    pb_n = float(F_brake_d[pb_idx])
    out["drive_peak_braking_n"]       = abs(pb_n)
    out["drive_peak_braking_bw"]      = abs(pb_n) / BW_n
    out["drive_peak_braking_time_s"]  = float(t_vec[pb_idx])

    if fc is not None:
        unload_thr  = 0.20 * BW_n
        s_end       = min(n - 1, fc)
        s_start     = max(0, fc - int(round(0.2 / dt)))
        active      = np.where(Fz_d[s_start:s_end + 1] > unload_thr)[0]
        if len(active) > 0:
            ul_idx = s_start + int(active[-1])
            out["drive_unload_time_s"]      = float(t_vec[ul_idx])
            out["drive_to_lead_handoff_ms"] = float((t_vec[fc] - t_vec[ul_idx]) * 1000)
        else:
            out["drive_unload_time_s"]      = None
            out["drive_to_lead_handoff_ms"] = None
    else:
        out["drive_unload_time_s"]      = None
        out["drive_to_lead_handoff_ms"] = None

    Fz_l = lead_mat[:, 2]
    combined_pk = float(np.max(Fz_l + Fz_d))
    out["total_vertical_peak_n"] = combined_pk

    if virtual_mat is not None:
        Fz_v = virtual_mat[:, 2]
        virt_pk = float(np.max(Fz_v))
        out["virtual_plate_xcheck_pct"] = (
            100.0 * abs(combined_pk - virt_pk) / virt_pk if virt_pk > 0 else None
        )
    else:
        out["virtual_plate_xcheck_pct"] = None

    return out


# ── per-trial processing ──────────────────────────────────────────────────────

def process_trial(conn, row, cols):
    c = lambda name: row[cols.index(name)]  # noqa: E731
    uuid      = c("athlete_uuid")
    date_val  = c("session_date")
    trial_i   = c("trial_index")
    src       = c("source_system") or "pitching"
    sa_id     = c("source_athlete_id")
    fn_str    = c("owner_filename")
    handedness = c("handedness")

    frame_rate = c("frame_rate") or 300.0
    start_time = c("start_time") or 0.0
    weight_lbs = c("weight")

    dt = 1.0 / float(frame_rate)

    BW_kg = float(weight_lbs) * 0.453592 if weight_lbs else 80.0
    BW_n  = BW_kg * 9.80665
    bw_missing = weight_lbs is None

    qa_flags   = []
    qa_warnings: dict = {}
    if bw_missing:
        qa_flags.append("body_weight_missing")

    # Fetch force data
    with conn.cursor() as cur:
        cur.execute(FETCH_FORCE, (uuid, date_val, trial_i))
        fd_row = cur.fetchone()
    if fd_row is None:
        raise ValueError("No force data found in f_pitching_force_data")
    force_data_list = _parse_json(fd_row[0])
    if not force_data_list:
        raise ValueError("Empty force data")

    # Fetch marker data (optional)
    with conn.cursor() as cur:
        cur.execute(FETCH_MARKERS, (uuid, date_val, trial_i))
        mk_row = cur.fetchone()
    marker_data_list  = _parse_json(mk_row[0]) if mk_row else None
    label_names_list  = _parse_json(mk_row[1]) if mk_row else None
    if mk_row is None:
        qa_flags.append("no_marker_data")

    # Fetch segment rotation data (optional)
    with conn.cursor() as cur:
        cur.execute(FETCH_SEG_ROT, (uuid, date_val, trial_i))
        sr_row = cur.fetchone()
    seg_rot_list   = _parse_json(sr_row[0]) if sr_row else None
    seg_names_list = _parse_json(sr_row[1]) if sr_row else None
    if sr_row is None:
        qa_flags.append("no_seg_rot_data")

    # Fetch QTM-labeled event times from f_pitching_trials.metrics
    # TIMING.FootstrikeTime.X and TIMING.ReleaseTime.X are in seconds from the
    # start of the CROPPED trial (frame 0 = t=0 in QTM trial coordinates).
    with conn.cursor() as cur:
        cur.execute(FETCH_TIMING, (uuid, date_val, trial_i))
        tm_row = cur.fetchone()
    trial_metrics  = _parse_json(tm_row[0]) if tm_row and tm_row[0] else {}
    footstrike_s   = _get_timing_s(trial_metrics, "TIMING.FootstrikeTime.X")
    release_s      = _get_timing_s(trial_metrics, "TIMING.ReleaseTime.X")

    n_frames = len(force_data_list)
    t_vec = float(start_time) + np.arange(n_frames) * dt

    # Identify plates
    plates = identify_plates(force_data_list)
    qa_flags.extend(plates["qa_flags"])

    lead_pid  = plates["lead_plate_id"]
    drive_pid = plates["drive_plate_id"]

    if lead_pid is None or drive_pid is None:
        raise ValueError(f"Could not identify lead/drive plates (ids found: {list(plates['plate_matrices'].keys())})")

    # Filter each axis independently
    def _filter_mat(mat):
        out = np.zeros_like(mat)
        for col in range(3):
            out[:, col], _ = apply_butter_filter(mat[:, col], dt)
        return out

    lead_mat  = _filter_mat(plates["lead_mat"])
    drive_mat = _filter_mat(plates["drive_mat"])
    virt_mat  = None  # FP4 is total virtual (FP1+FP2+FP3); no separate cross-check plate

    # Events (all 0-based)
    # FC and BR always come from f_pitching_trials.metrics (manually marked QTM events).
    # If either is missing the trial is skipped — no fallback.
    if footstrike_s is None:
        raise ValueError("No FootstrikeTime in f_pitching_trials.metrics")
    if release_s is None:
        raise ValueError("No ReleaseTime in f_pitching_trials.metrics")

    fc = min(n_frames - 1, max(0, round(footstrike_s * float(frame_rate))))
    br = min(n_frames - 1, max(0, round(release_s   * float(frame_rate))))

    if br <= fc:
        raise ValueError(f"BR frame ({br}) <= FC frame ({fc}) — invalid event order")

    # Initial contact: first lead-plate force onset before kinematic FC
    ic = detect_initial_contact(lead_mat, fc)

    # MER is still algorithmic (not a QTM-exported event)
    mer = detect_mer(seg_rot_list, seg_names_list, handedness, fc, br, n_frames)
    if mer is not None and (mer < fc or mer > br):
        qa_flags.append("mer_outside_window")
        mer = max(fc, min(mer, br))

    lead_m  = compute_lead_metrics(lead_mat,  fc, br, mer, dt, BW_n, t_vec)
    drive_m = compute_drive_metrics(drive_mat, virt_mat, lead_mat, fc, dt, BW_n, t_vec)

    # Stored frame indices are 1-based (matching R convention)
    fc_1  = fc  + 1 if fc  is not None else None
    br_1  = br  + 1 if br  is not None else None
    mer_1 = mer + 1 if mer is not None else None
    ic_1  = ic  + 1 if ic  is not None else None

    fc_t  = float(t_vec[fc])  if fc  is not None else None
    br_t  = float(t_vec[br])  if br  is not None else None
    mer_t = float(t_vec[mer]) if mer is not None else None
    ic_t  = float(t_vec[ic])  if ic  is not None else None
    foot_loading_ms = float((t_vec[fc] - t_vec[ic]) * 1000) if ic is not None else None

    params = (
        uuid, date_val, src, sa_id,
        fn_str, trial_i, handedness, _f(BW_kg), _f(BW_n),
        lead_pid, drive_pid,
        lead_m.get("braking_sign"), lead_m.get("axis_braking"),
        lead_m.get("axis_vertical"), lead_m.get("axis_mediolateral"),
        fc_1, br_1, mer_1, fc_t, br_t, mer_t,
        ic_1, ic_t, foot_loading_ms,
        lead_m.get("fc_to_br_duration_s"),
        lead_m.get("lead_peak_vertical_n"),       lead_m.get("lead_peak_vertical_bw"),
        lead_m.get("lead_peak_vertical_time_s"),  lead_m.get("lead_peak_vertical_pct_fc_br"),
        lead_m.get("lead_peak_braking_n"),        lead_m.get("lead_peak_braking_bw"),
        lead_m.get("lead_peak_braking_time_s"),   lead_m.get("lead_peak_braking_pct_fc_br"),
        lead_m.get("lead_peak_resultant_n"),      lead_m.get("lead_peak_resultant_bw"),
        lead_m.get("lead_peak_resultant_time_s"), lead_m.get("lead_peak_resultant_pct_fc_br"),
        lead_m.get("peak_v_to_peak_b_lag_ms"),    lead_m.get("peaks_synced_flag"),
        lead_m.get("peaks_before_mer_flag"),      lead_m.get("single_impulse_flag"),
        lead_m.get("impulse_peak_count"),
        lead_m.get("lead_rfd_vertical_n_per_s"),  lead_m.get("lead_rfd_vertical_bw_per_s"),
        lead_m.get("lead_rfd_braking_n_per_s"),   lead_m.get("lead_rfd_braking_bw_per_s"),
        lead_m.get("lead_time_to_peak_fz_ms"),
        lead_m.get("lead_impulse_v_fc_to_br_ns"),   lead_m.get("lead_impulse_v_fc_to_br_bws"),
        lead_m.get("lead_impulse_v_fc_to_mer_ns"),  lead_m.get("lead_impulse_v_fc_to_mer_bws"),
        lead_m.get("lead_impulse_v_into_ball_ns"),  lead_m.get("lead_impulse_v_into_ball_bws"),
        lead_m.get("lead_impulse_b_fc_to_br_ns"),   lead_m.get("lead_impulse_b_fc_to_br_bws"),
        lead_m.get("lead_impulse_b_fc_to_mer_ns"),  lead_m.get("lead_impulse_b_fc_to_mer_bws"),
        lead_m.get("lead_impulse_b_into_ball_ns"),  lead_m.get("lead_impulse_b_into_ball_bws"),
        lead_m.get("lead_impulse_resultant_fc_to_br_ns"),
        lead_m.get("lead_impulse_resultant_into_ball_ns"),
        lead_m.get("lead_impulse_resultant_into_ball_bws"),
        lead_m.get("lead_fz_at_50pct_bw"),       lead_m.get("lead_fz_at_midpoint_bw"),
        lead_m.get("lead_fy_at_midpoint_bw"),     lead_m.get("lead_resultant_at_midpoint_bw"),
        drive_m.get("drive_peak_vertical_n"),     drive_m.get("drive_peak_vertical_bw"),
        drive_m.get("drive_peak_vertical_time_s"),
        drive_m.get("drive_peak_braking_n"),      drive_m.get("drive_peak_braking_bw"),
        drive_m.get("drive_peak_braking_time_s"),
        drive_m.get("drive_unload_time_s"),       drive_m.get("drive_to_lead_handoff_ms"),
        drive_m.get("total_vertical_peak_n"),     drive_m.get("virtual_plate_xcheck_pct"),
        qa_flags,
        json.dumps(qa_warnings) if qa_warnings else None,
        PROCESSOR_VERSION,
    )

    # Convert any numpy scalars to native Python so psycopg2 can serialize them
    params = tuple(
        _to_python(p) if not isinstance(p, (list, str, type(None), bool)) else p
        for p in params
    )

    with conn.cursor() as cur:
        cur.execute(UPSERT_METRICS, params)
    conn.commit()

    lead_bw  = lead_m.get("lead_peak_vertical_bw")
    drive_bw = drive_m.get("drive_peak_vertical_bw")
    return {
        "lead_pid": lead_pid, "drive_pid": drive_pid,
        "fc": fc_1, "br": br_1, "mer": mer_1,
        "lead_bw": f"{lead_bw:.2f}BW" if lead_bw else "?",
        "drive_bw": f"{drive_bw:.2f}BW" if drive_bw else "?",
        "flags": qa_flags,
    }


# ── main ──────────────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(
        description="Backfill f_pitching_force_metrics from DB-resident time-series data"
    )
    parser.add_argument("--dry-run",      action="store_true",
                        help="Show what would be processed; write nothing")
    parser.add_argument("--force",        action="store_true",
                        help="Reprocess all trials, including those already in f_pitching_force_metrics")
    parser.add_argument("--athlete-uuid", help="Limit to one athlete UUID")
    parser.add_argument("--limit",        type=int, default=0,
                        help="Process at most N trials (0 = all)")
    args = parser.parse_args()

    conn = get_warehouse_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SET client_min_messages = WARNING")
            cur.execute(ENSURE_TABLE)
            # Add columns introduced in v1.1.0 (safe on existing tables)
            for col_sql in [
                "ALTER TABLE public.f_pitching_force_metrics ADD COLUMN IF NOT EXISTS initial_contact_frame  INTEGER",
                "ALTER TABLE public.f_pitching_force_metrics ADD COLUMN IF NOT EXISTS initial_contact_time_s NUMERIC",
                "ALTER TABLE public.f_pitching_force_metrics ADD COLUMN IF NOT EXISTS foot_loading_time_ms   NUMERIC",
            ]:
                cur.execute(col_sql)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_force_metrics_athlete_date
                  ON public.f_pitching_force_metrics (athlete_uuid, session_date)
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_force_metrics_owner
                  ON public.f_pitching_force_metrics (owner_filename)
            """)
        conn.commit()

        query = FIND_ALL if args.force else FIND_MISSING
        params: list = []
        if args.athlete_uuid:
            query += " AND fd.athlete_uuid = %s"
            params.append(args.athlete_uuid)
        query += " ORDER BY fd.session_date DESC, fd.athlete_uuid, fd.trial_index"
        if args.limit > 0:
            query += f" LIMIT {args.limit}"

        with conn.cursor() as cur:
            cur.execute(query, params or None)
            rows = cur.fetchall()
            cols = [d.name for d in cur.description]

        n_total = len(rows)
        if n_total == 0:
            print("Nothing to do — f_pitching_force_metrics is up to date.")
            return 0

        mode_label = "to reprocess" if args.force else "missing force metrics"
        print(f"Found {n_total} trial(s) {mode_label}.\n")

        if args.dry_run:
            seen: dict = {}
            for row in rows:
                key = (row[cols.index("owner_filename")] or row[cols.index("athlete_uuid")],
                       str(row[cols.index("session_date")]))
                seen[key] = seen.get(key, 0) + 1
            print("Trials to process by athlete / session:")
            for (fn, date), count in sorted(seen.items(), key=lambda x: x[0][1], reverse=True):
                print(f"  {fn}  {date}  — {count} trial(s)")
            return 0

        n_ok = n_err = 0
        for i, row in enumerate(rows, 1):
            fn_str   = row[cols.index("owner_filename")]
            date_val = row[cols.index("session_date")]
            trial_i  = row[cols.index("trial_index")]
            try:
                result = process_trial(conn, row, cols)
                n_ok += 1
                print(f"[trial {i}/{n_total}] {fn_str}  ({date_val})")
                print(f"  plates: lead={result['lead_pid']} drive={result['drive_pid']}  "
                      f"FC={result['fc']} BR={result['br']} MER={result['mer']}")
                print(f"  lead={result['lead_bw']}  drive={result['drive_bw']}  "
                      f"flags={result['flags']}")
            except Exception as e:
                conn.rollback()
                n_err += 1
                print(f"[ERR] trial {i}/{n_total}  {fn_str} / trial {trial_i}  ({date_val}): {e}")
            sys.stdout.flush()

        print(f"\n[DONE] {n_ok}/{n_total} processed | errors={n_err}")
        return 0 if n_err == 0 else 1

    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
