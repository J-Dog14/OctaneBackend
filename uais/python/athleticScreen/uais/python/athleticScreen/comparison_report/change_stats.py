"""
Change statistics for the athletic-screen comparison report.

The single-session report answers "where does this athlete sit?". The
comparison report has to answer a harder question: "did anything actually
change, or is this just a different day?"

Everything in here exists to support that judgement:

  - :func:`session_summary`        per-session mean / SD / trial count
  - :func:`pooled_within_sd`       the athlete's own noise floor
  - :func:`population_swc`         smallest worthwhile change (0.2 x pop SD)
  - :func:`classify_change`        the verdict, using the STRICTER of the two
  - :func:`percentile_for`         percentile vs. the population frame
  - :func:`metric_track`           everything the summary page needs, per metric

Verdict rule
------------
A delta is only called a real gain or a real loss when it clears BOTH:

  1. ``1.5 x`` the pooled within-session SD across the athlete's own trials
     (their personal day-to-day noise), and
  2. ``0.2 x`` the population SD for that metric (the conventional smallest
     worthwhile change).

Whichever of those is larger is the bar. Anything under it is reported as
"Held" — the number moved, but not by enough to mean anything. Deltas are
always reported; only the *verdict* is gated.

Direction
---------
Not every metric is "bigger is better". ``METRIC_DIRECTION`` encodes three
cases: ``higher``, ``lower`` (contact time), and ``band`` (kurtosis, which is
scored as distance from the per-movement ideal range). ``time_to_rpd_max_s``
is deliberately ``neutral`` — per REPORT_CLARITY_PLAN.md §5b the preferred
direction is still an open question per movement, so it shows a delta but
never a verdict.
"""
from __future__ import annotations

import math
from typing import Dict, List, Optional, Sequence

import pandas as pd

try:  # scipy is already a dependency of pdf_report.py
    from scipy.stats import percentileofscore
except ImportError:  # pragma: no cover - defensive
    percentileofscore = None


# ---------------------------------------------------------------------------
# Metric metadata
# ---------------------------------------------------------------------------
# How to read a change in each metric.
#   "higher"  -> a bigger number is better
#   "lower"   -> a smaller number is better
#   "band"    -> scored by distance from a per-movement ideal range
#   "neutral" -> show the delta, never render a verdict
METRIC_DIRECTION: Dict[str, str] = {
    "JH_IN": "higher",
    "PP_W_per_kg": "higher",
    "RSI": "higher",
    "auc_j": "higher",
    "rpd_max_w_per_s": "higher",
    "CT": "lower",
    "kurtosis": "band",
    "time_to_rpd_max_s": "neutral",
    "ASYM_PCT": "lower",
}

# Short labels for the summary page. Kept tighter than METRIC_LABELS in
# pdf_report.py because the summary lanes are narrower than a table column.
SUMMARY_LABELS: Dict[str, str] = {
    "JH_IN": "Jump Height",
    "PP_W_per_kg": "Peak Power",
    "RSI": "RSI",
    "auc_j": "Work (AUC)",
    "rpd_max_w_per_s": "Max RPD",
    "CT": "Contact Time",
    "kurtosis": "Curve Shape",
    "time_to_rpd_max_s": "Time to Max RPD",
    "ASYM_PCT": "L/R Asymmetry",
}

METRIC_UNITS: Dict[str, str] = {
    "JH_IN": "in",
    "PP_W_per_kg": "W/kg",
    "RSI": "",
    "auc_j": "J",
    "rpd_max_w_per_s": "W/s",
    "CT": "s",
    "kurtosis": "",
    "time_to_rpd_max_s": "s",
    "ASYM_PCT": "%",
}

# Which metrics lead the summary page, per movement. Ordered by how much
# weight they carry in a review conversation, not alphabetically.
SUMMARY_METRICS: Dict[str, List[str]] = {
    "DJ":  ["JH_IN", "RSI", "PP_W_per_kg", "CT"],
    "CMJ": ["JH_IN", "PP_W_per_kg", "auc_j"],
    "PPU": ["PP_W_per_kg", "rpd_max_w_per_s", "auc_j"],
    "SLV": ["JH_IN", "PP_W_per_kg", "ASYM_PCT"],
}

# Multiplier on the athlete's own pooled trial SD before a change counts.
TRIAL_NOISE_MULTIPLIER = 1.5

# Population SD multiplier — the conventional smallest worthwhile change.
SWC_MULTIPLIER = 0.2

# Verdict vocabulary. Deliberately plain so page 1 reads to an athlete.
VERDICT_UP = "Improved"
VERDICT_DOWN = "Declined"
VERDICT_FLAT = "Held"
VERDICT_NA = "—"

VERDICT_COLORS = {
    VERDICT_UP: "#2ecc71",
    VERDICT_DOWN: "#e74c3c",
    VERDICT_FLAT: "#cfd6dc",
    VERDICT_NA: "#7d8890",
}


# ---------------------------------------------------------------------------
# Per-session aggregation
# ---------------------------------------------------------------------------
def _clean(series: Optional[pd.Series]) -> pd.Series:
    """Coerce to numeric and drop NaN/inf. Always returns a Series."""
    if series is None:
        return pd.Series(dtype=float)
    s = pd.to_numeric(series, errors="coerce")
    return s.replace([float("inf"), float("-inf")], pd.NA).dropna().astype(float)


def asymmetry_pct(df: pd.DataFrame) -> Optional[float]:
    """Left/right asymmetry for SLV, as a percent of the stronger side.

    Uses jump height because it is the metric coaches quote. Returns None
    when the frame has no usable ``side`` split.
    """
    if df is None or df.empty or "side" not in df.columns or "JH_IN" not in df.columns:
        return None
    sides = df["side"].astype(str).str.strip().str.lower()
    left = _clean(df.loc[sides.str.startswith("l"), "JH_IN"])
    right = _clean(df.loc[sides.str.startswith("r"), "JH_IN"])
    if left.empty or right.empty:
        return None
    lm, rm = float(left.mean()), float(right.mean())
    stronger = max(lm, rm)
    if stronger <= 0:
        return None
    return abs(lm - rm) / stronger * 100.0


def session_summary(df: pd.DataFrame, metric: str) -> Dict:
    """Mean, SD and trial count for one metric within one session.

    ``ASYM_PCT`` is derived rather than read from a column, and has no
    meaningful within-session SD (it is already a single derived number),
    so its ``sd`` comes back as None.
    """
    if metric == "ASYM_PCT":
        value = asymmetry_pct(df)
        return {"mean": value, "sd": None, "n": 1 if value is not None else 0}

    if df is None or df.empty or metric not in df.columns:
        return {"mean": None, "sd": None, "n": 0}

    values = _clean(df[metric])
    if values.empty:
        return {"mean": None, "sd": None, "n": 0}

    return {
        "mean": float(values.mean()),
        "sd": float(values.std(ddof=1)) if len(values) > 1 else None,
        "n": int(len(values)),
    }


def pooled_within_sd(summaries: Sequence[Dict]) -> Optional[float]:
    """Pool the per-session SDs into one estimate of the athlete's noise.

    Standard pooled SD: sqrt( sum((n_i - 1) * sd_i^2) / sum(n_i - 1) ).
    Sessions with fewer than two trials contribute nothing. Returns None
    when no session had enough trials to estimate spread.
    """
    num = 0.0
    den = 0
    for s in summaries:
        sd, n = s.get("sd"), s.get("n") or 0
        if sd is None or n < 2 or not math.isfinite(sd):
            continue
        num += (n - 1) * (sd ** 2)
        den += (n - 1)
    if den <= 0 or num <= 0:
        return None
    return math.sqrt(num / den)


def population_swc(pop_df: pd.DataFrame, metric: str) -> Optional[float]:
    """Smallest worthwhile change: 0.2 x the population SD for this metric."""
    if pop_df is None or pop_df.empty:
        return None
    if metric == "ASYM_PCT":
        # Asymmetry isn't a stored column; derive a population spread from the
        # per-side jump-height distribution instead.
        if "side" not in pop_df.columns or "JH_IN" not in pop_df.columns:
            return None
        values = _clean(pop_df["JH_IN"])
        if len(values) < 2 or values.mean() == 0:
            return None
        # Express the SD as a percent of the mean so it lives on the same
        # scale as the asymmetry number itself.
        return SWC_MULTIPLIER * float(values.std(ddof=1)) / float(values.mean()) * 100.0
    if metric not in pop_df.columns:
        return None
    values = _clean(pop_df[metric])
    if len(values) < 2:
        return None
    return SWC_MULTIPLIER * float(values.std(ddof=1))


def change_threshold(trial_sd: Optional[float], swc: Optional[float]) -> Optional[float]:
    """The bar a delta has to clear: the stricter (larger) of the two tests.

    When only one test is available, that one is used. When neither is, the
    caller gets None and should decline to render a verdict.
    """
    candidates = []
    if trial_sd is not None and math.isfinite(trial_sd) and trial_sd > 0:
        candidates.append(TRIAL_NOISE_MULTIPLIER * trial_sd)
    if swc is not None and math.isfinite(swc) and swc > 0:
        candidates.append(swc)
    if not candidates:
        return None
    return max(candidates)


# ---------------------------------------------------------------------------
# Verdicts
# ---------------------------------------------------------------------------
def _band_distance(value: float, ideal: Sequence[float]) -> float:
    """Distance from an ideal range; 0 when inside it.

    Mirrors the deviation-from-ideal transform described in
    REPORT_CLARITY_PLAN.md §5, so the summary page and the radar agree about
    what a "good" kurtosis looks like.
    """
    low, high = float(ideal[0]), float(ideal[1])
    if low <= value <= high:
        return 0.0
    return min(abs(value - low), abs(value - high))


def classify_change(metric: str, first: Optional[float], last: Optional[float],
                    threshold: Optional[float],
                    ideal_band: Optional[Sequence[float]] = None) -> str:
    """Turn a first-to-last delta into Improved / Declined / Held / n-a.

    ``threshold`` comes from :func:`change_threshold`. When it is None the
    verdict is withheld rather than guessed.
    """
    direction = METRIC_DIRECTION.get(metric, "higher")
    if first is None or last is None or direction == "neutral":
        return VERDICT_NA

    if direction == "band":
        if not ideal_band:
            return VERDICT_NA
        # For a banded metric, "better" means closer to the ideal range.
        first_d = _band_distance(first, ideal_band)
        last_d = _band_distance(last, ideal_band)
        delta = last_d - first_d          # negative = moved toward ideal
        if threshold is None or abs(delta) < threshold:
            return VERDICT_FLAT
        return VERDICT_UP if delta < 0 else VERDICT_DOWN

    delta = last - first
    if threshold is None:
        return VERDICT_NA
    if abs(delta) < threshold:
        return VERDICT_FLAT
    improved = delta > 0 if direction == "higher" else delta < 0
    return VERDICT_UP if improved else VERDICT_DOWN


def percentile_for(pop_df: pd.DataFrame, metric: str,
                   value: Optional[float]) -> Optional[float]:
    """Percentile of ``value`` within the population, oriented so that
    higher always means better.

    Lower-is-better metrics (contact time, asymmetry) are inverted, and
    banded metrics (kurtosis) are percentiled on distance-from-ideal and
    then inverted — the same treatment the radar uses.
    """
    if value is None or pop_df is None or pop_df.empty or percentileofscore is None:
        return None
    if metric == "ASYM_PCT":
        return None  # no stored population distribution for a derived metric
    if metric not in pop_df.columns:
        return None
    values = _clean(pop_df[metric])
    if values.empty:
        return None
    try:
        pct = float(percentileofscore(values, value, kind="mean"))
    except Exception:
        return None
    if METRIC_DIRECTION.get(metric) == "lower":
        pct = 100.0 - pct
    return max(0.0, min(100.0, pct))


def percentile_band_for(pop_df: pd.DataFrame, metric: str, value: Optional[float],
                        ideal_band: Optional[Sequence[float]]) -> Optional[float]:
    """Percentile for a banded metric, scored on closeness to ideal."""
    if (value is None or pop_df is None or pop_df.empty
            or percentileofscore is None or not ideal_band
            or metric not in pop_df.columns):
        return None
    pop_values = _clean(pop_df[metric])
    if pop_values.empty:
        return None
    pop_dist = pop_values.apply(lambda v: _band_distance(float(v), ideal_band))
    try:
        pct = float(percentileofscore(pop_dist, _band_distance(value, ideal_band),
                                      kind="mean"))
    except Exception:
        return None
    return max(0.0, min(100.0, 100.0 - pct))


# ---------------------------------------------------------------------------
# The thing the summary page actually consumes
# ---------------------------------------------------------------------------
def metric_track(metric: str, movement: str,
                 per_session_dfs: Sequence[pd.DataFrame],
                 session_dates: Sequence[str],
                 pop_df: pd.DataFrame,
                 ideal_band: Optional[Sequence[float]] = None) -> Optional[Dict]:
    """Assemble one row of the summary page for one metric.

    Returns None when the athlete has no usable data for this metric in any
    selected session — the caller drops the lane entirely rather than
    printing an empty row.

    Keys
    ----
    metric, movement, label, unit, direction
    values        per-session means, aligned with ``session_dates`` (None where missing)
    percentiles   per-session percentiles, same alignment, oriented higher-is-better
    first, last   the first and last non-None values
    delta         last - first in raw units
    pct_delta     percent change relative to ``first``
    pctile_delta  percentile points gained or lost
    verdict       Improved / Declined / Held / —
    threshold     the bar the delta had to clear
    trial_sd      pooled within-session SD (None when < 2 trials everywhere)
    swc           population smallest worthwhile change
    """
    summaries = [session_summary(df, metric) for df in per_session_dfs]
    values = [s["mean"] for s in summaries]
    if all(v is None for v in values):
        return None

    banded = METRIC_DIRECTION.get(metric) == "band"
    if banded:
        percentiles = [percentile_band_for(pop_df, metric, v, ideal_band) for v in values]
    else:
        percentiles = [percentile_for(pop_df, metric, v) for v in values]

    present = [(i, v) for i, v in enumerate(values) if v is not None]
    first_i, first = present[0]
    last_i, last = present[-1]

    trial_sd = pooled_within_sd(summaries)
    swc = population_swc(pop_df, metric)
    threshold = change_threshold(trial_sd, swc)

    delta = None if (first is None or last is None) else last - first
    pct_delta = None
    if delta is not None and first not in (None, 0):
        pct_delta = delta / abs(first) * 100.0

    pctile_delta = None
    if percentiles[first_i] is not None and percentiles[last_i] is not None:
        pctile_delta = percentiles[last_i] - percentiles[first_i]

    return {
        "metric": metric,
        "movement": movement,
        "label": SUMMARY_LABELS.get(metric, metric),
        "unit": METRIC_UNITS.get(metric, ""),
        "direction": METRIC_DIRECTION.get(metric, "higher"),
        "dates": list(session_dates),
        "values": values,
        "percentiles": percentiles,
        "first": first,
        "last": last,
        "first_index": first_i,
        "last_index": last_i,
        "delta": delta,
        "pct_delta": pct_delta,
        "pctile_delta": pctile_delta,
        "trial_sd": trial_sd,
        "swc": swc,
        "threshold": threshold,
        "verdict": classify_change(metric, first, last, threshold, ideal_band),
    }


def build_tracks(session_data: Dict[str, List[pd.DataFrame]],
                 population_data: Dict[str, pd.DataFrame],
                 session_dates: Sequence[str],
                 movement_order: Sequence[str],
                 kurtosis_ideal: Optional[Dict[str, Sequence[float]]] = None,
                 include_kurtosis: bool = False) -> List[Dict]:
    """Build every summary lane, in movement order.

    ``include_kurtosis`` is off by default — curve shape earns its space on
    the per-movement detail pages, not on the page you hand an athlete.
    """
    kurtosis_ideal = kurtosis_ideal or {}
    tracks: List[Dict] = []
    for movement in movement_order:
        per_session = session_data.get(movement) or []
        if not per_session:
            continue
        pop_df = population_data.get(movement)
        if pop_df is None:
            pop_df = pd.DataFrame()

        metrics = list(SUMMARY_METRICS.get(movement, []))
        if include_kurtosis:
            metrics.append("kurtosis")

        for metric in metrics:
            band = kurtosis_ideal.get(movement) if metric == "kurtosis" else None
            track = metric_track(metric, movement, per_session, session_dates,
                                 pop_df, ideal_band=band)
            if track is not None:
                tracks.append(track)
    return tracks


def rank_movers(tracks: Sequence[Dict], verdict: str, limit: int = 3) -> List[Dict]:
    """Biggest movers with a given verdict, ranked by percentile points moved.

    Falls back to percent change when a lane has no percentile (asymmetry),
    so a derived metric can still surface as a headline.
    """
    def magnitude(t: Dict) -> float:
        if t.get("pctile_delta") is not None:
            return abs(float(t["pctile_delta"]))
        if t.get("pct_delta") is not None:
            return abs(float(t["pct_delta"]))
        return 0.0

    matching = [t for t in tracks if t.get("verdict") == verdict]
    matching.sort(key=magnitude, reverse=True)
    return matching[:limit]


def format_value(value: Optional[float], metric: str) -> str:
    """Format a metric value for display, with metric-appropriate precision."""
    if value is None or (isinstance(value, float) and not math.isfinite(value)):
        return "—"
    if metric in ("rpd_max_w_per_s", "auc_j"):
        return f"{value:,.0f}"
    if metric in ("CT", "time_to_rpd_max_s"):
        return f"{value:.3f}"
    if metric == "ASYM_PCT":
        return f"{value:.1f}"
    return f"{value:.2f}"


def format_delta(track: Dict) -> str:
    """Signed delta with unit, e.g. '+1.24 in' or '-0.011 s'."""
    delta = track.get("delta")
    if delta is None or not math.isfinite(delta):
        return "—"
    unit = track.get("unit") or ""
    body = format_value(abs(delta), track.get("metric", ""))
    sign = "+" if delta >= 0 else "-"
    return f"{sign}{body}{(' ' + unit) if unit else ''}"
