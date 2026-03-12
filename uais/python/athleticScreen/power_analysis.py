"""
Power curve analysis functions for Athletic Screen.
Handles loading, analyzing, and processing power time series data.
"""
import os
import re
import numpy as np
from scipy import stats
from typing import Union
import pandas as pd


def load_power_txt(txt_path: str) -> np.ndarray:
    """
    Read power time series from a Power.txt file.
    
    Args:
        txt_path: Path to the Power.txt file.
    
    Returns:
        NumPy array of power values.
    """
    vals = []
    with open(txt_path, "r", encoding="utf-8", errors="ignore") as f:
        # Find first numeric row like: "1\t0.00000"
        in_numeric = False
        for line in f:
            line = line.strip()
            if not line:
                continue
            if not in_numeric and re.match(r'^\d+\s+', line):
                in_numeric = True
            if in_numeric and re.match(r'^\d+\s+', line):
                parts = re.split(r'\s+', line)
                if len(parts) >= 2:
                    try:
                        vals.append(float(parts[1]))  # second column = power
                    except ValueError:
                        pass
    if not vals:
        raise ValueError(f"No numeric power values in {txt_path}")
    return np.asarray(vals, dtype=float)


def analyze_power_curve(power: Union[np.ndarray, list], fs_hz: float = 1000.0) -> dict:
    """
    Compute base power curve metrics.
    
    Args:
        power: Power time series (array or list).
        fs_hz: Sampling frequency in Hz.
    
    Returns:
        Dictionary of power curve metrics.
    """
    p = np.asarray(power, dtype=float)
    n = p.size
    t = np.arange(n) / fs_hz

    pk_idx = int(np.nanargmax(p))
    pk_val = float(p[pk_idx])

    thr10 = 0.10 * pk_val
    thr50 = 0.50 * pk_val
    thr90 = 0.90 * pk_val

    try:
        onset_idx = int(np.argmax(p >= thr10))
    except ValueError:
        onset_idx = 0
    post = p[pk_idx:]
    off_rel = np.argmax(post < thr10) if np.any(post < thr10) else (post.size - 1)
    offset_idx = pk_idx + int(off_rel)

    rising = p[:pk_idx+1]
    try:
        i10 = int(np.argmax(rising >= thr10))
        i90 = int(np.argmax(rising >= thr90))
        rise_time = (i90 - i10) / fs_hz if i90 > i10 else np.nan
        rise_slope = (0.8 * pk_val) / rise_time if rise_time and rise_time > 0 else np.nan
    except ValueError:
        i10 = i90 = None
        rise_time = np.nan
        rise_slope = np.nan

    try:
        left_idx = int(np.argmax(rising >= thr50))
    except ValueError:
        left_idx = pk_idx
    falling = p[pk_idx:]
    try:
        right_rel = int(np.argmax(falling <= thr50))
        right_idx = pk_idx + right_rel
    except ValueError:
        right_idx = pk_idx
    fwhm_sec = (right_idx - left_idx) / fs_hz if right_idx > left_idx else np.nan

    a = max(0, onset_idx)
    b = min(n - 1, max(offset_idx, pk_idx))
    auc_joules = float(np.trapezoid(np.nan_to_num(p[a:b+1], nan=0.0), dx=1.0/fs_hz))

    weights = np.clip(p[a:b+1], a_min=0, a_max=None)
    if np.sum(weights) > 0:
        t_window = t[a:b+1]
        t_com = float(np.sum(t_window * weights) / np.sum(weights))
        t_com_norm = (t_com - t[a]) / max(1e-9, (t[b] - t[a]))
    else:
        t_com = np.nan
        t_com_norm = np.nan

    w = int(0.05 * fs_hz)
    lo = max(0, pk_idx - w)
    hi = min(n, pk_idx + w + 1)
    local = p[lo:hi]
    cv_local = float(np.std(local) / np.mean(local)) if np.mean(local) > 0 else np.nan

    return {
        "n_samples": n,
        "fs_hz": fs_hz,
        "peak_power_w": pk_val,
        "time_to_peak_s": float(t[pk_idx]),
        "rise_time_10_90_s": float(rise_time),
        "rise_slope_w_per_s": float(rise_slope),
        "fwhm_s": float(fwhm_sec),
        "auc_j": auc_joules,
        "onset_idx": a,
        "offset_idx": b,
        "peak_idx": pk_idx,
        "t_com_s": t_com,
        "t_com_norm_0to1": t_com_norm,
        "cv_local_peak": cv_local,
        "i10_idx": int(i10) if isinstance(i10, int) else None,
        "i90_idx": int(i90) if isinstance(i90, int) else None,
        "left50_idx": left_idx,
        "right50_idx": right_idx,
    }


def analyze_power_curve_advanced(power: Union[np.ndarray, list], fs_hz: float = 1000.0) -> dict:
    """
    Compute advanced power curve metrics including RPD, work distribution, and shape statistics.
    
    Args:
        power: Power time series (array or list).
        fs_hz: Sampling frequency in Hz.
    
    Returns:
        Dictionary of advanced power curve metrics.
    """
    base = analyze_power_curve(power, fs_hz)
    p = np.asarray(power, dtype=float)
    n = p.size

    # Rate of Power Development (RPD)
    dp = np.gradient(p, 1.0/fs_hz)
    base["rpd_max_w_per_s"] = float(np.nanmax(dp))
    base["time_to_rpd_max_s"] = float(np.nanargmax(dp) / fs_hz)

    # Early/late work around peak
    a, b, pk = base["onset_idx"], base["offset_idx"], base["peak_idx"]
    auc_pre = float(np.trapezoid(np.nan_to_num(p[a:pk+1], nan=0.0), dx=1.0/fs_hz)) if pk >= a else np.nan
    auc_post = float(np.trapezoid(np.nan_to_num(p[pk:b+1], nan=0.0), dx=1.0/fs_hz)) if b >= pk else np.nan
    total = (0 if not np.isfinite(auc_pre) else auc_pre) + (0 if not np.isfinite(auc_post) else auc_post)
    base["auc_pre_j"] = auc_pre
    base["auc_post_j"] = auc_post
    base["work_early_pct"] = float(100.0 * auc_pre / total) if total > 0 else np.nan

    # Decay time 90→10% of peak on falling limb
    fall = p[pk:]
    thr90 = 0.90 * p[pk]
    thr10 = 0.10 * p[pk]
    i90 = int(np.argmax(fall <= thr90)) if np.any(fall <= thr90) else 0
    i10 = int(np.argmax(fall <= thr10)) if np.any(fall <= thr10) else len(fall)-1
    base["decay_90_10_s"] = (i10 - i90) / fs_hz if i10 > i90 else np.nan

    # Shape statistics
    finite = np.isfinite(p)
    base["skewness"] = float(stats.skew(p[finite])) if np.any(finite) else np.nan
    base["kurtosis"] = float(stats.kurtosis(p[finite], fisher=True)) if np.any(finite) else np.nan

    # Spectral centroid
    x = p - np.nanmean(p)
    X = np.abs(np.fft.rfft(np.nan_to_num(x)))
    freqs = np.fft.rfftfreq(x.size, d=1.0/fs_hz)
    base["spectral_centroid_hz"] = float(np.sum(freqs * X) / max(1e-12, np.sum(X)))

    return base


def update_table_with_power_metrics(conn, table: str, folder_path: str, fs_hz: float = 1000.0):
    """
    Update a table with power analysis metrics for all rows.
    
    Args:
        conn: SQLite connection.
        table: Table name.
        folder_path: Directory containing Power.txt files.
        fs_hz: Sampling frequency.
    """
    from database import ensure_power_metric_columns, POWER_METRIC_COLS
    
    cursor = conn.cursor()
    ensure_power_metric_columns(conn, table)

    # Pull identifying fields per table
    if table == "SLV":
        cursor.execute("SELECT id, trial_name, side FROM SLV")
        rows = cursor.fetchall()
    else:
        cursor.execute(f"SELECT id, trial_name FROM {table}")
        rows = [(r[0], r[1], None) for r in cursor.fetchall()]

    # Prepare dynamic UPDATE
    set_clause = ", ".join([f"{c} = ?" for (c, _) in POWER_METRIC_COLS])
    sql = f"UPDATE {table} SET {set_clause} WHERE id = ?"

    updated = 0
    missing = 0
    failed = 0

    for rec in rows:
        id_, trial_name, _side = rec
        if not trial_name:
            missing += 1
            continue

        power_path = os.path.join(folder_path, f"{trial_name}_Power.txt")
        if not os.path.exists(power_path):
            missing += 1
            continue

        try:
            s = load_power_txt(power_path)
            m = analyze_power_curve_advanced(s, fs_hz=fs_hz)

            # Order must match POWER_METRIC_COLS
            values = [
                m.get("peak_power_w"),
                m.get("time_to_peak_s"),
                m.get("rpd_max_w_per_s"),
                m.get("time_to_rpd_max_s"),
                m.get("rise_time_10_90_s"),
                m.get("fwhm_s"),
                m.get("auc_j"),
                m.get("work_early_pct"),
                m.get("decay_90_10_s"),
                m.get("t_com_norm_0to1"),
                m.get("skewness"),
                m.get("kurtosis"),
                m.get("spectral_centroid_hz"),
                id_,
            ]
            cursor.execute(sql, values)
            updated += 1

        except Exception as e:
            print(f"WARNING: {table} id={id_} trial={trial_name}: power parse/analysis failed: {e}")
            failed += 1

    conn.commit()
    print(f"{table}: updated={updated}, missing_power_files={missing}, failed={failed}")

