"""
Readiness Screen v2 scoring.

Computes per-metric z-scores against each athlete's rolling 28-day baseline,
aggregates into group z-scores (CMJ, PPU, ISO, power_curve, grip), and writes
one row to f_readiness_screen_score per athlete-session.
"""
import json
import numpy as np
from datetime import date, timedelta
from typing import Optional, List, Tuple, Dict, Any

try:
    from common.athlete_manager import get_warehouse_connection
except ImportError:
    from python.common.athlete_manager import get_warehouse_connection

BASELINE_WINDOW_DAYS = 28
MIN_HISTORY = 3  # minimum baseline sessions for a valid z-score

# (table, column, sign)  sign=+1 → higher is better; sign=-1 → lower is better
ISO_METRICS: List[Tuple[str, str, int]] = [
    ("f_readiness_screen_y",    "max_force",   +1),
    ("f_readiness_screen_ir90", "max_force",   +1),
    ("f_readiness_screen_y",    "time_to_max", -1),
    ("f_readiness_screen_ir90", "time_to_max", -1),
]

CMJ_METRICS: List[Tuple[str, str, int]] = [
    ("f_readiness_screen_cmj", "jump_height",            +1),
    ("f_readiness_screen_cmj", "pp_w_per_kg",            +1),
    ("f_readiness_screen_cmj", "force_at_pp",            +1),
    ("f_readiness_screen_cmj", "vel_at_pp",              +1),
    ("f_readiness_screen_cmj", "mrsi",                   +1),
    ("f_readiness_screen_cmj", "contraction_time_s",     -1),
    ("f_readiness_screen_cmj", "ecc_con_duration_ratio", -1),
    # stored negative; sign=-1 so a more-negative value produces a positive z
    ("f_readiness_screen_cmj", "eccentric_mean_power_w", -1),
]

PPU_METRICS: List[Tuple[str, str, int]] = [
    ("f_readiness_screen_ppu", "jump_height",        +1),
    ("f_readiness_screen_ppu", "pp_w_per_kg",        +1),
    ("f_readiness_screen_ppu", "force_at_pp",        +1),
    ("f_readiness_screen_ppu", "vel_at_pp",          +1),
    ("f_readiness_screen_ppu", "mrsi",               +1),
    ("f_readiness_screen_ppu", "contraction_time_s", -1),
]

GRIP_METRICS: List[Tuple[str, str, int]] = [
    ("f_readiness_screen_grip", "left_kg",       +1),
    ("f_readiness_screen_grip", "right_kg",      +1),
    ("f_readiness_screen_grip", "max_kg",        +1),
    ("f_readiness_screen_grip", "asymmetry_pct", -1),
]

# Intra-session CV is computed for these (table, column) pairs
CV_METRICS: List[Tuple[str, str]] = [
    ("f_readiness_screen_cmj", "jump_height"),
    ("f_readiness_screen_cmj", "mrsi"),
    ("f_readiness_screen_cmj", "peak_power_w"),
    ("f_readiness_screen_ppu", "jump_height"),
    ("f_readiness_screen_ppu", "mrsi"),
    ("f_readiness_screen_ppu", "peak_power_w"),
]

_BANDS = [
    (1.5,  "Elevated"),
    (0.5,  "Above Average"),
    (-0.5, "Average"),
    (-1.5, "Below Average"),
    (None, "Low"),
]


def _band_from_z(z: Optional[float]) -> Optional[str]:
    if z is None:
        return None
    for threshold, label in _BANDS:
        if threshold is None or z >= threshold:
            return label
    return "Low"


def _session_avg(cur, table: str, col: str, athlete_uuid: str, session_date: date) -> Optional[float]:
    """Mean of col across all trials for this athlete-session."""
    cur.execute(
        f"SELECT AVG({col}::numeric) FROM public.{table} "
        f"WHERE athlete_uuid = %s AND session_date = %s AND {col} IS NOT NULL",
        (athlete_uuid, session_date),
    )
    row = cur.fetchone()
    return float(row[0]) if row and row[0] is not None else None


def _baseline_session_avgs(cur, table: str, col: str, athlete_uuid: str,
                            session_date: date) -> List[float]:
    """One value per baseline session (mean across trials), excluding today."""
    cutoff = session_date - timedelta(days=BASELINE_WINDOW_DAYS)
    cur.execute(
        f"""
        SELECT AVG({col}::numeric)
        FROM public.{table}
        WHERE athlete_uuid = %s
          AND session_date >= %s AND session_date < %s
          AND {col} IS NOT NULL
        GROUP BY session_date
        ORDER BY session_date
        """,
        (athlete_uuid, cutoff, session_date),
    )
    return [float(r[0]) for r in cur.fetchall()]


def _z(today: float, baseline: List[float], sign: int) -> Optional[float]:
    if len(baseline) < MIN_HISTORY:
        return None
    mu = float(np.mean(baseline))
    sd = float(np.std(baseline, ddof=1))
    if sd == 0:
        return None
    return float(sign * (today - mu) / sd)


def _score_group(
    cur,
    metrics: List[Tuple[str, str, int]],
    athlete_uuid: str,
    session_date: date,
    flags: Dict[str, Any],
) -> Tuple[Optional[float], int]:
    """
    Z-score each metric in the group against the athlete's 28-day baseline.
    Returns (group_z, n_scored) and populates flags dict.
    """
    zs = []
    for table, col, sign in metrics:
        key = f"{table.replace('f_readiness_screen_', '')}.{col}"
        today = _session_avg(cur, table, col, athlete_uuid, session_date)
        if today is None:
            continue
        baseline = _baseline_session_avgs(cur, table, col, athlete_uuid, session_date)
        if len(baseline) < MIN_HISTORY:
            flags[key] = {
                "today": today,
                "flag": "insufficient_history",
                "n_history": len(baseline),
                "sign": sign,
            }
            continue
        z_val = _z(today, baseline, sign)
        if z_val is not None:
            zs.append(z_val)
            flags[key] = {
                "today": today,
                "z": z_val,
                "n_history": len(baseline),
                "sign": sign,
            }
    group_z = float(np.mean(zs)) if zs else None
    return group_z, len(zs)


def _power_curve_z(cur, athlete_uuid: str, session_date: date,
                   flags: Dict[str, Any]) -> Tuple[Optional[float], int]:
    """Z-score CMJ peak_power_w from the power_curve table."""
    cur.execute(
        """
        SELECT AVG(peak_power_w::numeric)
        FROM public.f_readiness_screen_power_curve
        WHERE athlete_uuid = %s AND session_date = %s
          AND movement_type = 'CMJ' AND peak_power_w IS NOT NULL
        """,
        (athlete_uuid, session_date),
    )
    r = cur.fetchone()
    today = float(r[0]) if r and r[0] is not None else None
    if today is None:
        return None, 0

    cutoff = session_date - timedelta(days=BASELINE_WINDOW_DAYS)
    cur.execute(
        """
        SELECT AVG(peak_power_w::numeric)
        FROM public.f_readiness_screen_power_curve
        WHERE athlete_uuid = %s
          AND session_date >= %s AND session_date < %s
          AND movement_type = 'CMJ' AND peak_power_w IS NOT NULL
        GROUP BY session_date
        """,
        (athlete_uuid, cutoff, session_date),
    )
    baseline = [float(r[0]) for r in cur.fetchall()]
    key = "power_curve.peak_power_w"
    if len(baseline) < MIN_HISTORY:
        flags[key] = {
            "today": today,
            "flag": "insufficient_history",
            "n_history": len(baseline),
            "sign": +1,
        }
        return None, 0
    z_val = _z(today, baseline, +1)
    if z_val is not None:
        flags[key] = {"today": today, "z": z_val, "n_history": len(baseline), "sign": +1}
        return z_val, 1
    return None, 0


def _intra_cv(cur, table: str, col: str, athlete_uuid: str, session_date: date) -> Optional[float]:
    cur.execute(
        f"SELECT {col}::numeric FROM public.{table} "
        f"WHERE athlete_uuid = %s AND session_date = %s AND {col} IS NOT NULL",
        (athlete_uuid, session_date),
    )
    vals = [float(r[0]) for r in cur.fetchall()]
    if len(vals) < 2:
        return None
    mu = float(np.mean(vals))
    return float(np.std(vals, ddof=1) / abs(mu)) if mu != 0 else None


def _baseline_mean_cv(cur, table: str, col: str, athlete_uuid: str,
                      session_date: date) -> Optional[float]:
    cutoff = session_date - timedelta(days=BASELINE_WINDOW_DAYS)
    cur.execute(
        f"""
        SELECT STDDEV_SAMP({col}::numeric), AVG({col}::numeric)
        FROM public.{table}
        WHERE athlete_uuid = %s
          AND session_date >= %s AND session_date < %s
          AND {col} IS NOT NULL
        GROUP BY session_date
        HAVING COUNT(*) >= 2
        """,
        (athlete_uuid, cutoff, session_date),
    )
    cvs = []
    for sd, mu in cur.fetchall():
        if mu is not None and float(mu) != 0 and sd is not None:
            cvs.append(float(sd) / abs(float(mu)))
    return float(np.mean(cvs)) if cvs else None


def compute_and_upsert_score(athlete_uuid: str, session_date: date,
                              conn=None) -> Optional[dict]:
    """
    Compute the composite readiness score for one athlete-session and upsert it.
    Returns the score row dict, or None on error.
    """
    close_conn = conn is None
    if conn is None:
        conn = get_warehouse_connection()

    try:
        with conn.cursor() as cur:
            per_metric: Dict[str, Any] = {}

            cmj_z,  n_cmj  = _score_group(cur, CMJ_METRICS,  athlete_uuid, session_date, per_metric)
            ppu_z,  n_ppu  = _score_group(cur, PPU_METRICS,  athlete_uuid, session_date, per_metric)
            iso_z,  n_iso  = _score_group(cur, ISO_METRICS,  athlete_uuid, session_date, per_metric)
            grip_z, n_grip = _score_group(cur, GRIP_METRICS, athlete_uuid, session_date, per_metric)
            pc_z,   n_pc   = _power_curve_z(cur, athlete_uuid, session_date, per_metric)

            group_zs = [z for z in [cmj_z, ppu_z, iso_z, pc_z, grip_z] if z is not None]
            composite_z = float(np.mean(group_zs)) if group_zs else None
            composite_score = composite_z
            band = _band_from_z(composite_z)
            metrics_used = n_cmj + n_ppu + n_iso + n_grip + n_pc

            # Intra-session CV
            intra: Dict[str, Any] = {}
            for table, col in CV_METRICS:
                key = f"{table.replace('f_readiness_screen_', '')}.{col}"
                today_cv = _intra_cv(cur, table, col, athlete_uuid, session_date)
                if today_cv is None:
                    continue
                base_cv = _baseline_mean_cv(cur, table, col, athlete_uuid, session_date)
                flag = "elevated" if (base_cv is not None and today_cv > 2 * base_cv) else "stable"
                intra[key] = {"today_cv": today_cv, "baseline_mean_cv": base_cv, "flag": flag}

            flags_json: Dict[str, Any] = {"per_metric": per_metric}
            if intra:
                flags_json["intra_session"] = intra

            score_row = {
                "athlete_uuid": athlete_uuid,
                "session_date": session_date,
                "composite_score": composite_score,
                "composite_z": composite_z,
                "band": band,
                "cmj_z": cmj_z,
                "ppu_z": ppu_z,
                "iso_z": iso_z,
                "power_curve_z": pc_z,
                "grip_z": grip_z,
                "metrics_used": metrics_used,
                "baseline_window_days": BASELINE_WINDOW_DAYS,
                "flags_json": json.dumps(flags_json),
            }

            cur.execute(
                "SELECT 1 FROM public.f_readiness_screen_score "
                "WHERE athlete_uuid = %s AND session_date = %s",
                (athlete_uuid, session_date),
            )
            exists = cur.fetchone() is not None

            update_cols = [c for c in score_row if c not in ("athlete_uuid", "session_date")]
            if exists:
                set_clause = ", ".join(f"{c} = %s" for c in update_cols)
                vals = [score_row[c] for c in update_cols] + [athlete_uuid, session_date]
                cur.execute(
                    f"UPDATE public.f_readiness_screen_score SET {set_clause} "
                    f"WHERE athlete_uuid = %s AND session_date = %s",
                    vals,
                )
            else:
                cols = list(score_row.keys())
                cur.execute(
                    f"INSERT INTO public.f_readiness_screen_score ({', '.join(cols)}) "
                    f"VALUES ({', '.join(['%s'] * len(cols))})",
                    [score_row[c] for c in cols],
                )
            conn.commit()
            return score_row

    except Exception as e:
        print(f"Scoring error for {athlete_uuid} {session_date}: {e}")
        import traceback
        traceback.print_exc()
        return None
    finally:
        if close_conn:
            conn.close()
