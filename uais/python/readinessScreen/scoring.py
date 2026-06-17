"""
Composite readiness score computation.

Exact port of ingestion/scoring.py from the Readiness Screen Tracker repo.
Produces bit-identical rows in f_readiness_screen_score.

Methodology — anchored in published athlete-monitoring literature:

  Buchheit M. (2014) "Monitoring training status with HR measures: do all
    roads lead to Rome?" Front. Physiol.
  Halson SL. (2014) "Monitoring training load to understand fatigue in athletes."
    Sports Med. 44 Suppl 2:S139-S147.
  Hopkins WG. (2004) "How to interpret changes in an athletic performance test."
    Sportscience 8.

The pipeline routes through three tiers based on prior session count:
  Tier 1 (0 prior): z-score vs cohort population mean/SD.
  Tier 2 (1 prior): delta z-score (today − prior) scaled by cohort SD.
  Tier 3 (2+ prior): personal rolling z-score (current methodology).

score = clip(50 + 15 * composite_z, 0, 100).
Bands: READY >= 60, CAUTION 40..60, FATIGUED < 40.
"""
from __future__ import annotations

import json
import math
from datetime import date, timedelta
from typing import Dict, List, Optional, Tuple

try:
    from common.athlete_manager import get_warehouse_connection as get_connection
except ImportError:
    from python.common.athlete_manager import get_warehouse_connection as get_connection

DEFAULT_BASELINE_DAYS = 28
MIN_HISTORY = 2
SCORE_SD_TO_POINTS = 15.0
BAND_READY = 60
BAND_FATIGUED = 40

CMJ_METRICS: List[Tuple[str, str, int]] = [
    ("f_readiness_screen_cmj", "jump_height",            +1),
    ("f_readiness_screen_cmj", "pp_w_per_kg",            +1),
    ("f_readiness_screen_cmj", "force_at_pp",            +1),
    ("f_readiness_screen_cmj", "vel_at_pp",              +1),
    ("f_readiness_screen_cmj", "mrsi",                   +1),
    ("f_readiness_screen_cmj", "contraction_time_s",     -1),
    ("f_readiness_screen_cmj", "ecc_con_duration_ratio", -1),
    ("f_readiness_screen_cmj", "eccentric_mean_power_w", -1),
    ("f_readiness_screen_cmj", "peak_grf_bw_ratio",      +1),
    ("f_readiness_screen_cmj", "rfd_0_100ms",            +1),
    ("f_readiness_screen_cmj", "concentric_impulse_ns",  +1),
]

PPU_METRICS: List[Tuple[str, str, int]] = [
    ("f_readiness_screen_ppu", "jump_height",            +1),
    ("f_readiness_screen_ppu", "pp_w_per_kg",            +1),
    ("f_readiness_screen_ppu", "force_at_pp",            +1),
    ("f_readiness_screen_ppu", "vel_at_pp",              +1),
    ("f_readiness_screen_ppu", "mrsi",                   +1),
    ("f_readiness_screen_ppu", "contraction_time_s",     -1),
    ("f_readiness_screen_ppu", "peak_grf_bw_ratio",      +1),
    ("f_readiness_screen_ppu", "rfd_0_100ms",            +1),
    ("f_readiness_screen_ppu", "concentric_impulse_ns",  +1),
    ("f_readiness_screen_ppu", "ecc_con_duration_ratio", -1),
    ("f_readiness_screen_ppu", "eccentric_mean_power_w", -1),
]

_ATHLETIC_COMPANION: Dict[Tuple[str, str], Tuple[str, str]] = {
    ("f_readiness_screen_cmj", "jump_height"): ("f_athletic_screen_cmj", "jh_in"),
    ("f_readiness_screen_cmj", "pp_w_per_kg"): ("f_athletic_screen_cmj", "pp_w_per_kg"),
    ("f_readiness_screen_cmj", "force_at_pp"): ("f_athletic_screen_cmj", "force_at_pp"),
    ("f_readiness_screen_cmj", "vel_at_pp"):   ("f_athletic_screen_cmj", "vel_at_pp"),
    ("f_readiness_screen_ppu", "jump_height"): ("f_athletic_screen_ppu", "jh_in"),
    ("f_readiness_screen_ppu", "pp_w_per_kg"): ("f_athletic_screen_ppu", "pp_w_per_kg"),
    ("f_readiness_screen_ppu", "force_at_pp"): ("f_athletic_screen_ppu", "force_at_pp"),
    ("f_readiness_screen_ppu", "vel_at_pp"):   ("f_athletic_screen_ppu", "vel_at_pp"),
}

_ATHLETIC_POWER_COLS: frozenset = frozenset({
    "peak_power_w", "rpd_max_w_per_s", "rise_time_10_90_s", "fwhm_s",
    "auc_j", "decay_90_10_s", "t_com_norm_0to1",
    "skewness", "kurtosis", "spectral_centroid_hz",
})

ISO_METRICS: List[Tuple[str, str, int]] = [
    ("f_readiness_screen_y",    "max_force",   +1),
    ("f_readiness_screen_ir90", "max_force",   +1),
    ("f_readiness_screen_y",    "time_to_max", -1),
    ("f_readiness_screen_ir90", "time_to_max", -1),
]

GRIP_METRICS: List[Tuple[str, str, int]] = [
    ("f_readiness_screen_grip", "left_kg",       +1),
    ("f_readiness_screen_grip", "right_kg",      +1),
    ("f_readiness_screen_grip", "max_kg",        +1),
    ("f_readiness_screen_grip", "asymmetry_pct", -1),
]

POWER_CURVE_METRICS: List[Tuple[str, str, int]] = [
    ("f_readiness_screen_power_curve", "peak_power_w",       +1),
    ("f_readiness_screen_power_curve", "rpd_max_w_per_s",    +1),
    ("f_readiness_screen_power_curve", "rise_slope_w_per_s", +1),
    ("f_readiness_screen_power_curve", "auc_j",              +1),
    ("f_readiness_screen_power_curve", "rise_time_10_90_s",  -1),
]

CV_METRICS: List[Tuple[str, str]] = [
    ("f_readiness_screen_cmj", "jump_height"),
    ("f_readiness_screen_cmj", "mrsi"),
    ("f_readiness_screen_cmj", "peak_power_w"),
    ("f_readiness_screen_ppu", "jump_height"),
    ("f_readiness_screen_ppu", "mrsi"),
    ("f_readiness_screen_ppu", "peak_power_w"),
]

_SCORE_GROUPS = {
    "cmj":         CMJ_METRICS,
    "ppu":         PPU_METRICS,
    "iso":         ISO_METRICS,
    "power_curve": POWER_CURVE_METRICS,
    "grip":        GRIP_METRICS,
}


def _label(table: str, col: str) -> str:
    short = table.replace("f_readiness_screen_", "").replace("_power_curve", "power")
    return f"{short}.{col}"


def _fetch_today_and_baseline(
    cur,
    athlete_uuid: str,
    table: str,
    col: str,
    session_date: date,
    baseline_days: int,
) -> Tuple[Optional[float], List[float]]:
    """Return (today_value, baseline_values).

    For CMJ/PPU core metrics, UNIONs f_athletic_screen_cmj/ppu as supplemental
    sources so prior athletic screen sessions contribute to the baseline.
    For power-curve metrics, also UNIONs inline power columns from athletic screen.
    """
    cutoff = session_date - timedelta(days=baseline_days)
    companion = _ATHLETIC_COMPANION.get((table, col))
    is_power_col = (table == "f_readiness_screen_power_curve" and col in _ATHLETIC_POWER_COLS)

    if companion:
        ath_table, ath_col = companion
        cur.execute(
            f"""
            SELECT AVG(v)::float FROM (
              SELECT {col} AS v FROM public.{table}
               WHERE athlete_uuid = %s AND session_date = %s
              UNION ALL
              SELECT {ath_col} AS v FROM public.{ath_table}
               WHERE athlete_uuid = %s AND session_date = %s
            ) _u
            """,
            (athlete_uuid, session_date, athlete_uuid, session_date),
        )
        today_row = cur.fetchone()
        today = today_row[0] if today_row and today_row[0] is not None else None

        cur.execute(
            f"""
            SELECT session_date, AVG(v)::float FROM (
              SELECT session_date, {col} AS v FROM public.{table}
               WHERE athlete_uuid = %s AND session_date < %s AND session_date >= %s
              UNION ALL
              SELECT session_date, {ath_col} AS v FROM public.{ath_table}
               WHERE athlete_uuid = %s AND session_date < %s AND session_date >= %s
            ) _u
            GROUP BY session_date
            ORDER BY session_date
            """,
            (athlete_uuid, session_date, cutoff, athlete_uuid, session_date, cutoff),
        )
    elif is_power_col:
        cur.execute(
            f"""
            SELECT AVG(v)::float FROM (
              SELECT {col} AS v FROM public.f_readiness_screen_power_curve
               WHERE athlete_uuid = %s AND session_date = %s
              UNION ALL
              SELECT {col} AS v FROM public.f_athletic_screen_cmj
               WHERE athlete_uuid = %s AND session_date = %s
              UNION ALL
              SELECT {col} AS v FROM public.f_athletic_screen_ppu
               WHERE athlete_uuid = %s AND session_date = %s
            ) _u
            """,
            (athlete_uuid, session_date,
             athlete_uuid, session_date,
             athlete_uuid, session_date),
        )
        today_row = cur.fetchone()
        today = today_row[0] if today_row and today_row[0] is not None else None

        cur.execute(
            f"""
            SELECT session_date, AVG(v)::float FROM (
              SELECT session_date, {col} AS v FROM public.f_readiness_screen_power_curve
               WHERE athlete_uuid = %s AND session_date < %s AND session_date >= %s
              UNION ALL
              SELECT session_date, {col} AS v FROM public.f_athletic_screen_cmj
               WHERE athlete_uuid = %s AND session_date < %s AND session_date >= %s
              UNION ALL
              SELECT session_date, {col} AS v FROM public.f_athletic_screen_ppu
               WHERE athlete_uuid = %s AND session_date < %s AND session_date >= %s
            ) _u
            GROUP BY session_date
            ORDER BY session_date
            """,
            (athlete_uuid, session_date, cutoff,
             athlete_uuid, session_date, cutoff,
             athlete_uuid, session_date, cutoff),
        )
    else:
        cur.execute(
            f"""
            SELECT AVG({col})::float
              FROM public.{table}
             WHERE athlete_uuid = %s AND session_date = %s
            """,
            (athlete_uuid, session_date),
        )
        today_row = cur.fetchone()
        today = today_row[0] if today_row and today_row[0] is not None else None

        cur.execute(
            f"""
            SELECT AVG({col})::float
              FROM public.{table}
             WHERE athlete_uuid = %s
               AND session_date <  %s
               AND session_date >= %s
             GROUP BY session_date
             ORDER BY session_date
            """,
            (athlete_uuid, session_date, cutoff),
        )

    baseline = [r[0] for r in cur.fetchall() if r and r[0] is not None]
    return today, baseline


def _zscore(value: float, baseline: List[float]) -> Optional[Tuple[float, float, float]]:
    if value is None or len(baseline) < MIN_HISTORY:
        return None
    n = len(baseline)
    mean = sum(baseline) / n
    var = sum((x - mean) ** 2 for x in baseline) / (n - 1)
    sd = math.sqrt(var)
    if sd == 0:
        return None
    return (value - mean) / sd, mean, sd


def _flag(z: float) -> str:
    if z >= 0.6:
        return "rise"
    if z <= -0.6:
        return "drop"
    return "stable"


def _count_prior_sessions(
    cur,
    athlete_uuid: str,
    session_date: date,
    baseline_days: int,
) -> int:
    cutoff = session_date - timedelta(days=baseline_days)
    cur.execute(
        """
        SELECT COUNT(DISTINCT session_date) FROM (
            SELECT session_date FROM public.f_readiness_screen_cmj
             WHERE athlete_uuid = %s AND session_date < %s AND session_date >= %s
            UNION
            SELECT session_date FROM public.f_readiness_screen_ppu
             WHERE athlete_uuid = %s AND session_date < %s AND session_date >= %s
            UNION
            SELECT session_date FROM public.f_readiness_screen_y
             WHERE athlete_uuid = %s AND session_date < %s AND session_date >= %s
            UNION
            SELECT session_date FROM public.f_readiness_screen_ir90
             WHERE athlete_uuid = %s AND session_date < %s AND session_date >= %s
            UNION
            SELECT session_date FROM public.f_readiness_screen_grip
             WHERE athlete_uuid = %s AND session_date < %s AND session_date >= %s
            UNION
            SELECT session_date FROM public.f_readiness_screen_power_curve
             WHERE athlete_uuid = %s AND session_date < %s AND session_date >= %s
            UNION
            SELECT session_date FROM public.f_athletic_screen_cmj
             WHERE athlete_uuid = %s AND session_date < %s AND session_date >= %s
            UNION
            SELECT session_date FROM public.f_athletic_screen_ppu
             WHERE athlete_uuid = %s AND session_date < %s AND session_date >= %s
        ) _all_sessions
        """,
        (
            athlete_uuid, session_date, cutoff,
            athlete_uuid, session_date, cutoff,
            athlete_uuid, session_date, cutoff,
            athlete_uuid, session_date, cutoff,
            athlete_uuid, session_date, cutoff,
            athlete_uuid, session_date, cutoff,
            athlete_uuid, session_date, cutoff,
            athlete_uuid, session_date, cutoff,
        ),
    )
    row = cur.fetchone()
    return int(row[0]) if row and row[0] is not None else 0


def _fetch_cohort_stats(
    cur,
    table: str,
    col: str,
    exclude_athlete_uuid: str,
) -> Optional[Tuple[float, float, int]]:
    """Return (cohort_mean, cohort_sd, n) across all athletes except the target."""
    companion = _ATHLETIC_COMPANION.get((table, col))
    is_power_col = (table == "f_readiness_screen_power_curve" and col in _ATHLETIC_POWER_COLS)

    if companion:
        ath_table, ath_col = companion
        cur.execute(
            f"""
            SELECT AVG(session_avg)::float, STDDEV_SAMP(session_avg)::float, COUNT(*)
              FROM (
                SELECT athlete_uuid, session_date, AVG(v)::float AS session_avg
                  FROM (
                    SELECT athlete_uuid, session_date, {col} AS v
                      FROM public.{table}
                     WHERE athlete_uuid <> %s AND {col} IS NOT NULL
                    UNION ALL
                    SELECT athlete_uuid, session_date, {ath_col} AS v
                      FROM public.{ath_table}
                     WHERE athlete_uuid <> %s AND {ath_col} IS NOT NULL
                  ) _combined
                 GROUP BY athlete_uuid, session_date
              ) _sessions
            """,
            (exclude_athlete_uuid, exclude_athlete_uuid),
        )
    elif is_power_col:
        cur.execute(
            f"""
            SELECT AVG(session_avg)::float, STDDEV_SAMP(session_avg)::float, COUNT(*)
              FROM (
                SELECT athlete_uuid, session_date, AVG(v)::float AS session_avg
                  FROM (
                    SELECT athlete_uuid, session_date, {col} AS v
                      FROM public.f_readiness_screen_power_curve
                     WHERE athlete_uuid <> %s AND {col} IS NOT NULL
                    UNION ALL
                    SELECT athlete_uuid, session_date, {col} AS v
                      FROM public.f_athletic_screen_cmj
                     WHERE athlete_uuid <> %s AND {col} IS NOT NULL
                    UNION ALL
                    SELECT athlete_uuid, session_date, {col} AS v
                      FROM public.f_athletic_screen_ppu
                     WHERE athlete_uuid <> %s AND {col} IS NOT NULL
                  ) _combined
                 GROUP BY athlete_uuid, session_date
              ) _sessions
            """,
            (exclude_athlete_uuid, exclude_athlete_uuid, exclude_athlete_uuid),
        )
    else:
        cur.execute(
            f"""
            SELECT AVG(session_avg)::float, STDDEV_SAMP(session_avg)::float, COUNT(*)
              FROM (
                SELECT athlete_uuid, session_date, AVG({col})::float AS session_avg
                  FROM public.{table}
                 WHERE athlete_uuid <> %s AND {col} IS NOT NULL
                 GROUP BY athlete_uuid, session_date
              ) _sessions
            """,
            (exclude_athlete_uuid,),
        )

    row = cur.fetchone()
    if not row or row[0] is None or row[2] is None or int(row[2]) < 2:
        return None
    mean_val, sd_val, n = float(row[0]), row[1], int(row[2])
    if sd_val is None or float(sd_val) == 0:
        return None
    return mean_val, float(sd_val), n


def _build_null_result(per_metric: Dict, baseline_days: int,
                       scoring_tier: str, note: str) -> Dict:
    return {
        "composite_score":    None,
        "composite_z":        None,
        "band":               "INSUFFICIENT_HISTORY",
        "cmj_z":              None,
        "ppu_z":              None,
        "iso_z":              None,
        "power_curve_z":      None,
        "grip_z":             None,
        "metrics_used":       0,
        "baseline_window_days": baseline_days,
        "scoring_tier":       scoring_tier,
        "flags_json":         json.dumps({"per_metric": per_metric, "note": note}),
    }


def _g_avg(arr: List[float]) -> Optional[float]:
    return round(sum(arr) / len(arr), 3) if arr else None


def _score_first_run(cur, athlete_uuid, session_date, baseline_days) -> Dict:
    per_metric: Dict[str, dict] = {}
    group_zs: Dict[str, List[float]] = {k: [] for k in _SCORE_GROUPS}
    all_zs: List[float] = []

    for group_name, metric_list in _SCORE_GROUPS.items():
        for table, col, sign in metric_list:
            today, _ = _fetch_today_and_baseline(
                cur, athlete_uuid, table, col, session_date, baseline_days
            )
            label = _label(table, col)
            if today is None:
                continue
            cohort = _fetch_cohort_stats(cur, table, col, athlete_uuid)
            if cohort is None:
                per_metric[label] = {
                    "today": round(today, 4), "flag": "insufficient_history",
                    "n_history": 0, "sign": sign, "cohort_basis": True,
                }
                continue
            cohort_mean, cohort_sd, n = cohort
            z_signed = sign * (today - cohort_mean) / cohort_sd
            per_metric[label] = {
                "today": round(today, 4), "mean": round(cohort_mean, 4),
                "sd": round(cohort_sd, 4), "z": round(z_signed, 3),
                "flag": _flag(z_signed), "n_history": n,
                "sign": sign, "cohort_basis": True,
            }
            group_zs[group_name].append(z_signed)
            all_zs.append(z_signed)

    if not all_zs:
        return _build_null_result(per_metric, baseline_days, "FIRST_RUN",
                                  "No cohort data available for peer comparison.")

    composite_z = sum(all_zs) / len(all_zs)
    score = max(0.0, min(100.0, 50.0 + SCORE_SD_TO_POINTS * composite_z))
    band = "READY" if score >= BAND_READY else ("FATIGUED" if score < BAND_FATIGUED else "CAUTION")
    return {
        "composite_score": round(score, 1), "composite_z": round(composite_z, 3),
        "band": band, "cmj_z": _g_avg(group_zs["cmj"]), "ppu_z": _g_avg(group_zs["ppu"]),
        "iso_z": _g_avg(group_zs["iso"]), "power_curve_z": _g_avg(group_zs["power_curve"]),
        "grip_z": _g_avg(group_zs["grip"]), "metrics_used": len(all_zs),
        "baseline_window_days": baseline_days, "scoring_tier": "FIRST_RUN",
        "flags_json": json.dumps({"per_metric": per_metric}),
    }


def _score_a_to_b(cur, athlete_uuid, session_date, baseline_days) -> Dict:
    per_metric: Dict[str, dict] = {}
    group_zs: Dict[str, List[float]] = {k: [] for k in _SCORE_GROUPS}
    all_zs: List[float] = []

    for group_name, metric_list in _SCORE_GROUPS.items():
        for table, col, sign in metric_list:
            today, baseline = _fetch_today_and_baseline(
                cur, athlete_uuid, table, col, session_date, baseline_days
            )
            label = _label(table, col)
            if today is None or not baseline:
                continue
            prior_value = baseline[0]
            cohort = _fetch_cohort_stats(cur, table, col, athlete_uuid)
            if cohort is None:
                per_metric[label] = {
                    "today": round(today, 4), "mean": round(prior_value, 4),
                    "flag": "insufficient_history", "n_history": 1,
                    "sign": sign, "a_to_b_basis": True,
                }
                continue
            _, cohort_sd, _ = cohort
            z_signed = sign * (today - prior_value) / cohort_sd
            per_metric[label] = {
                "today": round(today, 4), "mean": round(prior_value, 4),
                "sd": round(cohort_sd, 4), "z": round(z_signed, 3),
                "flag": _flag(z_signed), "n_history": 1,
                "sign": sign, "a_to_b_basis": True,
            }
            group_zs[group_name].append(z_signed)
            all_zs.append(z_signed)

    if not all_zs:
        return _build_null_result(per_metric, baseline_days, "A_TO_B",
                                  "No comparable data from prior session.")

    composite_z = sum(all_zs) / len(all_zs)
    score = max(0.0, min(100.0, 50.0 + SCORE_SD_TO_POINTS * composite_z))
    band = "READY" if score >= BAND_READY else ("FATIGUED" if score < BAND_FATIGUED else "CAUTION")
    return {
        "composite_score": round(score, 1), "composite_z": round(composite_z, 3),
        "band": band, "cmj_z": _g_avg(group_zs["cmj"]), "ppu_z": _g_avg(group_zs["ppu"]),
        "iso_z": _g_avg(group_zs["iso"]), "power_curve_z": _g_avg(group_zs["power_curve"]),
        "grip_z": _g_avg(group_zs["grip"]), "metrics_used": len(all_zs),
        "baseline_window_days": baseline_days, "scoring_tier": "A_TO_B",
        "flags_json": json.dumps({"per_metric": per_metric}),
    }


def _score_readiness(cur, athlete_uuid, session_date, baseline_days) -> Dict:
    per_metric: Dict[str, dict] = {}
    group_zs: Dict[str, List[float]] = {k: [] for k in _SCORE_GROUPS}
    all_zs: List[float] = []

    for group_name, metric_list in _SCORE_GROUPS.items():
        for table, col, sign in metric_list:
            today, baseline = _fetch_today_and_baseline(
                cur, athlete_uuid, table, col, session_date, baseline_days
            )
            if today is None:
                continue
            label = _label(table, col)
            if len(baseline) < MIN_HISTORY:
                per_metric[label] = {
                    "today": round(today, 4), "flag": "insufficient_history",
                    "n_history": len(baseline), "sign": sign,
                }
                continue
            z_result = _zscore(today, baseline)
            if z_result is None:
                continue
            z, mean, sd = z_result
            z_signed = sign * z
            per_metric[label] = {
                "today": round(today, 4), "mean": round(mean, 4),
                "sd": round(sd, 4), "z": round(z_signed, 3),
                "flag": _flag(z_signed), "n_history": len(baseline), "sign": sign,
            }
            group_zs[group_name].append(z_signed)
            all_zs.append(z_signed)

    if not all_zs:
        return _build_null_result(per_metric, baseline_days, "READINESS",
                                  "Need >=2 historical sessions in at least one metric.")

    composite_z = sum(all_zs) / len(all_zs)
    score = max(0.0, min(100.0, 50.0 + SCORE_SD_TO_POINTS * composite_z))
    band = "READY" if score >= BAND_READY else ("FATIGUED" if score < BAND_FATIGUED else "CAUTION")
    return {
        "composite_score": round(score, 1), "composite_z": round(composite_z, 3),
        "band": band, "cmj_z": _g_avg(group_zs["cmj"]), "ppu_z": _g_avg(group_zs["ppu"]),
        "iso_z": _g_avg(group_zs["iso"]), "power_curve_z": _g_avg(group_zs["power_curve"]),
        "grip_z": _g_avg(group_zs["grip"]), "metrics_used": len(all_zs),
        "baseline_window_days": baseline_days, "scoring_tier": "READINESS",
        "flags_json": json.dumps({"per_metric": per_metric}),
    }


def compute_intra_session_cv(
    athlete_uuid: str,
    session_date: date,
    baseline_days: int = DEFAULT_BASELINE_DAYS,
) -> Dict:
    cutoff = session_date - timedelta(days=baseline_days)
    result: Dict = {}
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            for table, col in CV_METRICS:
                label = _label(table, col)
                try:
                    cur.execute(
                        f"SELECT {col} FROM public.{table}"
                        f" WHERE athlete_uuid = %s AND session_date = %s"
                        f"   AND {col} IS NOT NULL",
                        (athlete_uuid, session_date),
                    )
                    today_vals = [r[0] for r in cur.fetchall() if r[0] is not None]
                    if len(today_vals) < 2:
                        continue
                    n = len(today_vals)
                    mean_v = sum(today_vals) / n
                    if mean_v == 0:
                        continue
                    sd_v = math.sqrt(sum((x - mean_v) ** 2 for x in today_vals) / (n - 1))
                    today_cv = sd_v / abs(mean_v)

                    cur.execute(
                        f"""
                        SELECT session_date,
                               STDDEV({col}) / NULLIF(ABS(AVG({col})), 0) AS cv
                          FROM public.{table}
                         WHERE athlete_uuid = %s
                           AND session_date < %s
                           AND session_date >= %s
                           AND {col} IS NOT NULL
                         GROUP BY session_date
                        HAVING COUNT(*) >= 2
                        """,
                        (athlete_uuid, session_date, cutoff),
                    )
                    baseline_cvs = [r[1] for r in cur.fetchall() if r[1] is not None]
                    baseline_mean_cv = (
                        sum(baseline_cvs) / len(baseline_cvs)
                    ) if baseline_cvs else None
                    flag = (
                        "elevated" if baseline_mean_cv and today_cv > 2.0 * baseline_mean_cv
                        else "stable"
                    )
                    result[label] = {
                        "today_cv": round(today_cv, 4),
                        "baseline_mean_cv": round(baseline_mean_cv, 4) if baseline_mean_cv else None,
                        "flag": flag,
                        "n_trials": n,
                    }
                except Exception:
                    pass
    finally:
        conn.close()
    return result


def compute_score_for_session(
    athlete_uuid: str,
    session_date: date,
    baseline_days: int = DEFAULT_BASELINE_DAYS,
) -> Dict:
    """Route to the correct scoring tier and return the score dict."""
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            n_prior = _count_prior_sessions(cur, athlete_uuid, session_date, baseline_days)
            if n_prior == 0:
                result = _score_first_run(cur, athlete_uuid, session_date, baseline_days)
            elif n_prior == 1:
                result = _score_a_to_b(cur, athlete_uuid, session_date, baseline_days)
            else:
                result = _score_readiness(cur, athlete_uuid, session_date, baseline_days)
    finally:
        conn.close()

    intra_session = compute_intra_session_cv(athlete_uuid, session_date, baseline_days)
    flags = json.loads(result["flags_json"])
    flags["intra_session"] = intra_session
    result["flags_json"] = json.dumps(flags)
    return result


def upsert_score(athlete_uuid: str, session_date: date, score_dict: Dict) -> None:
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO public.f_readiness_screen_score
                    (athlete_uuid, session_date, composite_score, composite_z, band,
                     cmj_z, ppu_z, iso_z, power_curve_z, grip_z,
                     metrics_used, baseline_window_days, flags_json, scoring_tier)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s)
                ON CONFLICT (athlete_uuid, session_date) DO UPDATE SET
                    composite_score      = EXCLUDED.composite_score,
                    composite_z          = EXCLUDED.composite_z,
                    band                 = EXCLUDED.band,
                    cmj_z                = EXCLUDED.cmj_z,
                    ppu_z                = EXCLUDED.ppu_z,
                    iso_z                = EXCLUDED.iso_z,
                    power_curve_z        = EXCLUDED.power_curve_z,
                    grip_z               = EXCLUDED.grip_z,
                    metrics_used         = EXCLUDED.metrics_used,
                    baseline_window_days = EXCLUDED.baseline_window_days,
                    flags_json           = EXCLUDED.flags_json,
                    scoring_tier         = EXCLUDED.scoring_tier
                """,
                (
                    athlete_uuid, session_date,
                    score_dict["composite_score"], score_dict["composite_z"], score_dict["band"],
                    score_dict["cmj_z"], score_dict["ppu_z"], score_dict["iso_z"],
                    score_dict["power_curve_z"], score_dict.get("grip_z"),
                    score_dict["metrics_used"], score_dict["baseline_window_days"],
                    score_dict["flags_json"], score_dict.get("scoring_tier"),
                ),
            )
        conn.commit()
    finally:
        conn.close()


def compute_and_upsert_score(
    athlete_uuid: str,
    session_date: date,
    conn=None,
) -> Dict:
    """Public API used by main.py. Compute + persist in one call."""
    score_dict = compute_score_for_session(athlete_uuid, session_date)
    upsert_score(athlete_uuid, session_date, score_dict)
    return score_dict
