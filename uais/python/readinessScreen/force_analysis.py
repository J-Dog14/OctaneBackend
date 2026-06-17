"""
Force analysis for Readiness Screen.
Loads *_Force.txt files (vertical GRF time series at 1000 Hz, Newtons)
and computes phase metrics (9 PHASE_COLS) plus force-derived metrics (4 FORCE_COLS).

Exact port of ingestion/power_analysis.py::analyze_phase_metrics_from_force()
from the Readiness Screen Tracker repo — produces identical output.

File format: row-index <TAB> value, one sample per line at 1000 Hz.
Same layout as *_Power.txt files.
"""
from __future__ import annotations

import re
from typing import List, Optional, Union

import numpy as np


def load_force_txt(txt_path: str) -> np.ndarray:
    """Read GRF time series from a Force.txt file.

    Returns:
        NumPy array of force values in Newtons at 1000 Hz.
    """
    vals: List[float] = []
    with open(txt_path, "r", encoding="utf-8", errors="ignore") as f:
        in_numeric = False
        for line in f:
            line = line.strip()
            if not line:
                continue
            if not in_numeric and re.match(r"^\d+\s+", line):
                in_numeric = True
            if in_numeric and re.match(r"^\d+\s+", line):
                parts = re.split(r"\s+", line)
                if len(parts) >= 2:
                    try:
                        vals.append(float(parts[1]))
                    except ValueError:
                        pass
    if not vals:
        raise ValueError(f"No numeric force values in {txt_path}")
    return np.asarray(vals, dtype=float)


def analyze_phase_metrics_from_force(
    force_array: Union[np.ndarray, list],
    fs_hz: float = 1000.0,
    jump_height_m: Optional[float] = None,
    movement_type: str = "CMJ",
    body_weight_n: Optional[float] = None,
) -> dict:
    """Compute phase + force metrics from a full-trial GRF time-series (Newtons).

    body_weight_n: full body weight from a CMJ quiet-standing estimate.
                   Used only for peak_grf_bw_ratio so the ratio is comparable
                   across CMJ and PPU.  When None, signal_rest_n is used instead.

    COM velocity is derived by integrating (GRF - signal_rest_n) / mass.
    Signed power = GRF x v.  Eccentric phase detected via velocity zero-crossing.
    PPU (still-start) produces None for all eccentric fields only when no
    eccentric velocity dip is found.

    Returns 13 keys: 9 PHASE_COLS + 4 FORCE_COLS.
    """
    null_result = {
        "contraction_time_s":     None, "eccentric_duration_s":   None,
        "concentric_duration_s":  None, "ecc_con_duration_ratio": None,
        "eccentric_mean_power_w": None, "eccentric_peak_power_w": None,
        "eccentric_auc_j":        None, "concentric_auc_j":       None,
        "mrsi":                   None,
        "peak_grf_n":             None, "peak_grf_bw_ratio":      None,
        "rfd_0_100ms":            None, "concentric_impulse_ns":  None,
    }
    try:
        F = np.asarray(force_array, dtype=float)
        n = len(F)
        if n < 50:
            return null_result

        g = 9.81
        quiet_n = max(10, int(0.05 * fs_hz))

        # Signal resting force: always estimated from the first 50 ms of THIS file.
        # CMJ: plate has full body weight → signal_rest ≈ BW.
        # PPU: plate has upper body only → signal_rest ≈ upper-body weight.
        signal_rest_n = float(np.mean(F[:quiet_n]))
        if signal_rest_n < 10.0:
            return null_result

        # Mass always from signal resting force — correct for each movement type.
        # CMJ: signal_rest ≈ full BW → full body mass.
        # PPU: signal_rest ≈ upper body weight → upper body mass (correct for PPU dynamics).
        mass_kg = signal_rest_n / g

        # For peak_grf_bw_ratio, use full body weight if provided so the ratio is
        # comparable across CMJ and PPU.
        if body_weight_n is not None and body_weight_n > 10.0:
            bw_for_ratio = float(body_weight_n)
        else:
            bw_for_ratio = signal_rest_n

        # Velocity integrates against signal resting force — correct for both CMJ and PPU.
        v = np.cumsum(F - signal_rest_n) / (mass_kg * fs_hz)
        P = F * v

        # Same velocity-based detection for both CMJ and PPU.
        # PPU has a shallower eccentric dip than CMJ, so threshold is -0.02 m/s
        # (PPU with upper-body mass reaches ~-0.05 m/s; CMJ reaches ~-0.9 m/s).
        neg_mask = v < -0.02
        if not np.any(neg_mask):
            return null_result
        ecc_start_idx = int(np.argmax(neg_mask))

        # Bottom: first neg→pos velocity zero-crossing = eccentric→concentric transition
        pk_power_idx = int(np.argmax(P))
        bottom_idx = ecc_start_idx
        for i in range(ecc_start_idx, min(pk_power_idx, n - 1)):
            if v[i] <= 0 and v[i + 1] > 0:
                bottom_idx = i + 1
                break

        if bottom_idx <= ecc_start_idx + 5:
            return null_result

        # Takeoff: GRF drops below 5% of signal resting force after peak power
        pk_power_idx = int(np.argmax(P))
        takeoff_idx = n - 1
        for i in range(pk_power_idx, n - 1):
            if F[i] < 0.05 * signal_rest_n:
                takeoff_idx = i
                break

        contraction_time_s = (takeoff_idx - ecc_start_idx) / fs_hz
        concentric_duration_s = (takeoff_idx - bottom_idx) / fs_hz
        if concentric_duration_s <= 0:
            return null_result

        if bottom_idx > ecc_start_idx + 5:
            eccentric_duration_s   = (bottom_idx - ecc_start_idx) / fs_hz
            ecc_seg                = P[ecc_start_idx:bottom_idx]
            eccentric_mean_power_w = float(np.mean(ecc_seg))
            eccentric_peak_power_w = float(np.min(ecc_seg))
            eccentric_auc_j        = float(abs(np.trapz(ecc_seg, dx=1.0 / fs_hz)))
            ecc_con_duration_ratio = eccentric_duration_s / concentric_duration_s
        else:
            eccentric_duration_s = eccentric_mean_power_w = None
            eccentric_peak_power_w = eccentric_auc_j = ecc_con_duration_ratio = None

        con_seg = P[bottom_idx:takeoff_idx]
        concentric_auc_j = float(np.trapz(con_seg, dx=1.0 / fs_hz))

        mrsi = (jump_height_m / contraction_time_s) if (
            jump_height_m and contraction_time_s > 0) else None

        # Force-specific metrics
        peak_grf_n = float(np.max(F))
        peak_grf_bw_ratio = (peak_grf_n / bw_for_ratio) if bw_for_ratio > 0 else None

        # RFD: slope of GRF from concentric onset (bottom_idx) over first 100 ms
        rfd_end = min(bottom_idx + max(1, int(0.1 * fs_hz)), n - 1)
        rfd_0_100ms = float((F[rfd_end] - F[bottom_idx]) / 0.1) if rfd_end > bottom_idx else None

        # Net concentric impulse above signal resting force (N·s)
        # Uses signal_rest_n so PPU impulse is measured above upper-body weight baseline
        con_force_seg = F[bottom_idx:takeoff_idx] - signal_rest_n
        concentric_impulse_ns = float(np.trapz(con_force_seg, dx=1.0 / fs_hz))

        return {
            "contraction_time_s":     contraction_time_s,
            "eccentric_duration_s":   eccentric_duration_s,
            "concentric_duration_s":  concentric_duration_s,
            "ecc_con_duration_ratio": ecc_con_duration_ratio,
            "eccentric_mean_power_w": eccentric_mean_power_w,
            "eccentric_peak_power_w": eccentric_peak_power_w,
            "eccentric_auc_j":        eccentric_auc_j,
            "concentric_auc_j":       concentric_auc_j,
            "mrsi":                   mrsi,
            "peak_grf_n":             peak_grf_n,
            "peak_grf_bw_ratio":      peak_grf_bw_ratio,
            "rfd_0_100ms":            rfd_0_100ms,
            "concentric_impulse_ns":  concentric_impulse_ns,
        }
    except Exception:
        return null_result
