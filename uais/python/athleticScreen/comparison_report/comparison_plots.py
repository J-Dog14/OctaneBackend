"""
Plot primitives for the multi-session comparison report.

Each public function in here renders a single chart on an existing
matplotlib axes (or, for the rings, on a figure at given coordinates). They
are all deliberately small so that page builders in
``comparison_pages.py`` stay readable.

The charts mirror the look of ``pdf_report.py`` (dark panel, bold sans-serif
labels, large fonts) but are adapted to show 2-4 sessions on the same panel.

Sessions are passed in as a list of dicts, e.g.

    [{"date": "2024-01-15", "df": <DataFrame>, "avg": <Series>}, ...]

ordered chronologically (oldest first). The ``avg`` row is the session average
the highest ``PP_FORCEPLATE`` for that session — same selection rule as
the single-session report.
"""
from __future__ import annotations

import glob
import os
import sys
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np
import pandas as pd
from matplotlib.patches import Arc, Circle, FancyArrowPatch
from scipy.interpolate import interp1d
from scipy.stats import percentileofscore

# Reuse styling constants and helpers from the single-session report.
_python_dir = Path(__file__).resolve().parent.parent.parent
if str(_python_dir) not in sys.path:
    sys.path.insert(0, str(_python_dir))

from athleticScreen.pdf_report import (  # noqa: E402
    KURTOSIS_IDEAL_RANGE,
    ELITE_RPD_REFERENCE,
    ELITE_AUC_REFERENCE,
    METRIC_LABELS,
    RADAR_METRICS,
    _kurtosis_radar_value,
    percentile_to_tier,
    pct_color,
)

from .config import (
    PANEL_BG,
    POPULATION_COLOR,
    format_session_label,
    session_color,
)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------
def _style_dark_axes(ax, title: str = "", title_size: int = 60,
                     xlabel: str = "", ylabel: str = "",
                     label_size: int = 27, tick_size: int = 24) -> None:
    """Apply the standard dark-panel matplotlib styling used across pages."""
    if title:
        ax.set_title(title, color="white", fontsize=title_size, fontweight="bold")
    if xlabel:
        ax.set_xlabel(xlabel, color="white", fontsize=label_size)
    if ylabel:
        ax.set_ylabel(ylabel, color="white", fontsize=label_size)
    ax.tick_params(colors="white", labelsize=tick_size)
    for side in ("bottom", "top", "left", "right"):
        ax.spines[side].set_color("white")
    ax.grid(True, color="white", alpha=0.2)
    ax.set_facecolor(PANEL_BG)


def _format_sigfig(value, sigfigs: int) -> str:
    """Format a number to ``sigfigs`` significant figures (matches pdf_report)."""
    if value is None or pd.isna(value):
        return "—"
    if value == 0:
        return "0"
    import math
    order = math.floor(math.log10(abs(value)))
    rounded = round(value, sigfigs - 1 - order)
    if abs(rounded) >= 1:
        if rounded == int(rounded):
            return str(int(rounded))
        decimal_places = max(0, sigfigs - len(str(int(abs(rounded)))))
        fmt = "{:." + str(decimal_places) + "f}"
        return fmt.format(rounded).rstrip("0").rstrip(".")
    decimal_places = sigfigs - 1 - order
    fmt = "{:." + str(decimal_places) + "f}"
    return fmt.format(rounded).rstrip("0").rstrip(".")


def _hex_to_pastel_rgba(hex_color: str, alpha: float = 0.5):
    """Lighten ``hex_color`` toward white and return RGBA at ``alpha``.

    Matches the cell-color helper in pdf_report.performance_table so the
    comparison table feels visually consistent with the single-session one.
    """
    hex_color = hex_color.lstrip("#")
    r = int(hex_color[0:2], 16) / 255.0
    g = int(hex_color[2:4], 16) / 255.0
    b = int(hex_color[4:6], 16) / 255.0
    r = r * 0.5 + 0.5
    g = g * 0.5 + 0.5
    b = b * 0.5 + 0.5
    return (r, g, b, alpha)


def _tier_color_map():
    return {
        "Elite":         _hex_to_pastel_rgba("#00ff00", 0.5),
        "High":          _hex_to_pastel_rgba("#90ee90", 0.5),
        "Average":       _hex_to_pastel_rgba("#808080", 0.5),
        "Below Average": _hex_to_pastel_rgba("#ffff00", 0.5),
        "Low":           _hex_to_pastel_rgba("#d62728", 0.5),
    }


# ---------------------------------------------------------------------------
# Histogram with overlaid session means
# ---------------------------------------------------------------------------
def comparison_bar_graph(ax, metric: str, sessions: List[Dict], population: pd.DataFrame) -> None:
    """Population histogram with one mean-line per session, color-coded.

    A short legend in the top-right shows each session date and its
    percentile so the chart still reads at a glance without a separate
    legend.
    """
    if metric not in population.columns:
        ax.text(0.5, 0.5, f"Metric '{metric}' not found",
                transform=ax.transAxes, ha="center", va="center",
                color="white", fontsize=20)
        ax.set_facecolor(PANEL_BG)
        return

    pop_values = population[metric].dropna().values
    if len(pop_values) == 0:
        ax.text(0.5, 0.5, "No population data",
                transform=ax.transAxes, ha="center", va="center",
                color="white", fontsize=20)
        ax.set_facecolor(PANEL_BG)
        return

    n_bins = min(30, max(10, int(np.sqrt(len(pop_values)))))
    counts, bin_edges = np.histogram(pop_values, bins=n_bins)
    bin_centers = (bin_edges[:-1] + bin_edges[1:]) / 2
    ax.bar(bin_centers, counts,
           width=(bin_edges[1] - bin_edges[0]) * 0.8,
           color=POPULATION_COLOR, alpha=0.6,
           edgecolor=POPULATION_COLOR, linewidth=0.5)

    # CT is "lower is better" — show min instead of max for the secondary line.
    use_min = metric == "CT"

    legend_lines = []
    for idx, sess in enumerate(sessions):
        df = sess["df"]
        if df.empty or metric not in df.columns:
            continue
        vals = df[metric].dropna().values
        if len(vals) == 0:
            continue

        mean_val = float(vals.mean())
        extreme_val = float(vals.min() if use_min else vals.max())

        color = session_color(idx)
        ax.axvline(x=mean_val, color=color, linestyle="--",
                   linewidth=7.5, alpha=0.95)

        pct = percentileofscore(pop_values, mean_val)
        fmt = "{:.2f}" if metric == "CT" else "{:.1f}"
        legend_lines.append(
            f"{format_session_label(sess['date'])}  •  "
            f"{int(pct)}th  •  μ {fmt.format(mean_val)}  "
            f"({'min' if use_min else 'max'} {fmt.format(extreme_val)})"
        )

    display_label = METRIC_LABELS.get(metric, metric)
    _style_dark_axes(ax, title=display_label, title_size=60,
                     ylabel="Frequency", label_size=30, tick_size=24)
    ax.grid(True, color="white", alpha=0.2, axis="y")

    if legend_lines:
        ax.text(0.98, 0.98, "\n".join(legend_lines),
                transform=ax.transAxes, ha="right", va="top",
                color="white", fontsize=28,
                family="monospace")


def slv_comparison_bar_graph(ax, metric: str, sessions: List[Dict],
                             population: pd.DataFrame) -> None:
    """SLV histogram: each session contributes a solid (Left) and a
    dashed (Right) colored line at the leg-mean of ``metric``."""
    if metric not in population.columns:
        ax.text(0.5, 0.5, f"Metric '{metric}' not found",
                transform=ax.transAxes, ha="center", va="center",
                color="white", fontsize=20)
        ax.set_facecolor(PANEL_BG)
        return

    pop_values = population[metric].dropna().values
    if len(pop_values) == 0:
        ax.text(0.5, 0.5, "No population data",
                transform=ax.transAxes, ha="center", va="center",
                color="white", fontsize=20)
        ax.set_facecolor(PANEL_BG)
        return

    n_bins = min(30, max(10, int(np.sqrt(len(pop_values)))))
    counts, bin_edges = np.histogram(pop_values, bins=n_bins)
    bin_centers = (bin_edges[:-1] + bin_edges[1:]) / 2
    ax.bar(bin_centers, counts,
           width=(bin_edges[1] - bin_edges[0]) * 0.8,
           color=POPULATION_COLOR, alpha=0.6,
           edgecolor=POPULATION_COLOR, linewidth=0.5)

    legend_lines = []
    for idx, sess in enumerate(sessions):
        df = sess["df"]
        if df.empty or metric not in df.columns or "side" not in df.columns:
            continue
        color = session_color(idx)

        left = df[df["side"] == "Left"]
        right = df[df["side"] == "Right"]

        l_mean = float(left[metric].mean()) if not left.empty else np.nan
        r_mean = float(right[metric].mean()) if not right.empty else np.nan

        # Solid = Left, Dashed = Right (same color per session)
        if not np.isnan(l_mean):
            ax.axvline(x=l_mean, color=color, linestyle="-",
                       linewidth=6.5, alpha=0.95)
        if not np.isnan(r_mean):
            ax.axvline(x=r_mean, color=color, linestyle=":",
                       linewidth=6.5, alpha=0.95)

        l_pct = (percentileofscore(pop_values, l_mean)
                 if not np.isnan(l_mean) else float("nan"))
        r_pct = (percentileofscore(pop_values, r_mean)
                 if not np.isnan(r_mean) else float("nan"))
        legend_lines.append(
            f"{format_session_label(sess['date'])}  L:{int(l_pct) if not np.isnan(l_pct) else '–'}th"
            f"  R:{int(r_pct) if not np.isnan(r_pct) else '–'}th"
        )

    display_label = METRIC_LABELS.get(metric, metric)
    _style_dark_axes(ax, title=display_label, title_size=60,
                     ylabel="Frequency", label_size=30, tick_size=24)
    ax.grid(True, color="white", alpha=0.2, axis="y")

    if legend_lines:
        # Two-column-ish hint text: "solid = L, dashed = R" up top
        legend_text = "L = solid   R = dotted\n" + "\n".join(legend_lines)
        ax.text(0.98, 0.98, legend_text,
                transform=ax.transAxes, ha="right", va="top",
                color="white", fontsize=26, family="monospace")


# ---------------------------------------------------------------------------
# Radar chart (overlaid sessions)
# ---------------------------------------------------------------------------
def _radar_percentiles(row, population, movement_name: str) -> List[float]:
    """Same percentile transform used by the single-session radar."""
    ideal_kurt = KURTOSIS_IDEAL_RANGE.get(movement_name)
    pcts = []
    for metric in RADAR_METRICS:
        val = row.get(metric, None) if row is not None else None
        if metric == "kurtosis" and ideal_kurt is not None and "kurtosis" in population.columns:
            pop_kurt = population["kurtosis"].dropna()
            pcts.append(_kurtosis_radar_value(val, pop_kurt, ideal_kurt))
        elif metric in population.columns:
            pop_vals = population[metric].dropna()
            if len(pop_vals) > 0 and val is not None and not pd.isna(val):
                pcts.append(percentileofscore(pop_vals, val) / 100.0)
            else:
                pcts.append(0.0)
        else:
            pcts.append(0.0)
    return pcts


def comparison_radar_chart(ax, sessions: List[Dict], population: pd.DataFrame,
                           movement_name: str) -> None:
    """Overlaid radar — one polygon per session in its session color.

    Used by DJ / CMJ / PPU pages. ``ax`` must already be a polar axes.
    """
    N = len(RADAR_METRICS)
    angles = np.linspace(0, 2 * np.pi, N, endpoint=False)
    angles_closed = np.append(angles, angles[0])

    ax.set_theta_offset(np.pi / 2)
    ax.set_theta_direction(-1)
    ax.set_ylim(0, 1)
    ax.set_yticks([0.2, 0.4, 0.6, 0.8, 1.0])
    ax.set_yticklabels(["20th", "40th", "60th", "80th", "100th"],
                       color="white", fontsize=21)
    ax.grid(True, color="white", alpha=0.3, linestyle="--")

    for idx, sess in enumerate(sessions):
        best = sess.get("avg")
        if best is None:
            continue
        pcts = _radar_percentiles(best, population, movement_name)
        pcts_closed = pcts + [pcts[0]]
        color = session_color(idx)
        ax.plot(angles_closed, pcts_closed, linewidth=5.5,
                color=color, marker="o", markersize=6,
                label=format_session_label(sess["date"]))
        ax.fill(angles_closed, pcts_closed, alpha=0.13, color=color)

    ax.set_xticks(angles)
    display_labels = [METRIC_LABELS.get(m, m) for m in RADAR_METRICS]
    ax.set_xticklabels(display_labels, fontsize=36, color="white")
    ax.tick_params(colors="white", pad=60)
    ax.spines["polar"].set_color("white")
    ax.set_facecolor(PANEL_BG)

    leg = ax.legend(loc="upper right", facecolor=PANEL_BG, edgecolor="white",
                    labelcolor="white", fontsize=24,
                    bbox_to_anchor=(1.32, 1.12))
    if leg is not None:
        leg.set_zorder(10)


def slv_comparison_radar_chart(ax, sessions: List[Dict], population: pd.DataFrame,
                               leg: str) -> None:
    """Single-leg radar — overlaid sessions for ``leg`` ('Left' or 'Right').

    Plots one polygon per session in its session color, restricted to the
    requested leg's session average.
    """
    N = len(RADAR_METRICS)
    angles = np.linspace(0, 2 * np.pi, N, endpoint=False)
    angles_closed = np.append(angles, angles[0])

    ax.set_theta_offset(np.pi / 2)
    ax.set_theta_direction(-1)
    ax.set_ylim(0, 1)
    ax.set_yticks([0.2, 0.4, 0.6, 0.8, 1.0])
    ax.set_yticklabels(["20th", "40th", "60th", "80th", "100th"],
                       color="white", fontsize=21)
    ax.grid(True, color="white", alpha=0.3, linestyle="--")

    for idx, sess in enumerate(sessions):
        df = sess["df"]
        if df.empty or "side" not in df.columns:
            continue
        leg_df = df[df["side"] == leg]
        if leg_df.empty:
            continue
        best = leg_df.mean(numeric_only=True)
        pcts = _radar_percentiles(best, population, "SLV")
        pcts_closed = pcts + [pcts[0]]
        color = session_color(idx)
        ax.plot(angles_closed, pcts_closed, linewidth=5.5,
                color=color, marker="o", markersize=6,
                label=format_session_label(sess["date"]))
        ax.fill(angles_closed, pcts_closed, alpha=0.13, color=color)

    ax.set_xticks(angles)
    display_labels = [METRIC_LABELS.get(m, m) for m in RADAR_METRICS]
    ax.set_xticklabels(display_labels, fontsize=30, color="white")
    ax.tick_params(colors="white", pad=50)
    ax.spines["polar"].set_color("white")
    ax.set_facecolor(PANEL_BG)
    ax.set_title(f"{leg} Leg", color="white", fontsize=48,
                 fontweight="bold", pad=42)


# ---------------------------------------------------------------------------
# Force-Velocity scatter with arrow trajectory
# ---------------------------------------------------------------------------
def _draw_population_fv(ax, population: pd.DataFrame) -> None:
    pop_force = population["Force_at_PP"].dropna()
    pop_vel = population["Vel_at_PP"].dropna()
    common = pop_force.index.intersection(pop_vel.index)
    ax.scatter(pop_force.loc[common], pop_vel.loc[common],
               s=720, color=POPULATION_COLOR, alpha=0.4, label="All Athletes")
    avg_force = pop_force.mean()
    avg_vel = pop_vel.mean()
    ax.axvline(x=avg_force, color="gray", linestyle="--",
               linewidth=6.0, alpha=0.7, zorder=3)
    ax.axhline(y=avg_vel, color="gray", linestyle="--",
               linewidth=6.0, alpha=0.7, zorder=3)


def _annotate_fv_trajectory(ax, points: List[tuple]) -> None:
    """Draw arrows between consecutive (force, vel) tuples."""
    for (x0, y0), (x1, y1) in zip(points[:-1], points[1:]):
        arrow = FancyArrowPatch(
            (x0, y0), (x1, y1),
            arrowstyle="->",
            mutation_scale=42,
            color="white", linewidth=4, alpha=0.85, zorder=4,
        )
        ax.add_patch(arrow)


def comparison_fv_scatter(ax, sessions: List[Dict], population: pd.DataFrame) -> None:
    """Population scatter + per-session colored mean dot + arrow trajectory."""
    if population.empty or "Force_at_PP" not in population.columns:
        ax.text(0.5, 0.5, "No population data",
                transform=ax.transAxes, ha="center", va="center",
                color="white", fontsize=28)
        ax.set_facecolor(PANEL_BG)
        return

    _draw_population_fv(ax, population)

    points = []
    pp_pop = population["PP_FORCEPLATE"].dropna()
    legend_lines = []
    for idx, sess in enumerate(sessions):
        df = sess["df"]
        if df.empty:
            continue
        f_mean = float(df["Force_at_PP"].mean())
        v_mean = float(df["Vel_at_PP"].mean())
        pp_mean = float(df["PP_FORCEPLATE"].mean())
        color = session_color(idx)
        ax.scatter([f_mean], [v_mean], s=1620, color=color, alpha=0.95,
                   zorder=5, marker="o", edgecolors="white", linewidths=2.5)
        points.append((f_mean, v_mean))
        pp_pct = (percentileofscore(pp_pop, pp_mean)
                  if len(pp_pop) > 0 else 0)
        legend_lines.append(
            f"{format_session_label(sess['date'])}  PP {int(pp_pct)}th"
        )

    if len(points) >= 2:
        _annotate_fv_trajectory(ax, points)

    if legend_lines:
        ax.text(0.98, 0.98, "\n".join(legend_lines),
                transform=ax.transAxes, ha="right", va="top",
                color="white", fontsize=27, family="monospace")

    _style_dark_axes(ax, title="Force–Velocity Scatter", title_size=60,
                     xlabel="Force @ PP (N)", ylabel="Vel @ PP (m/s)")


def slv_comparison_fv_scatter(ax, sessions: List[Dict], population: pd.DataFrame,
                              leg: str) -> None:
    """Per-leg FV scatter for SLV, with arrow trajectory between sessions."""
    if population.empty or "Force_at_PP" not in population.columns:
        ax.text(0.5, 0.5, "No population data",
                transform=ax.transAxes, ha="center", va="center",
                color="white", fontsize=28)
        ax.set_facecolor(PANEL_BG)
        return

    _draw_population_fv(ax, population)

    points = []
    legend_lines = []
    pp_pop = population["PP_FORCEPLATE"].dropna()
    for idx, sess in enumerate(sessions):
        df = sess["df"]
        if df.empty or "side" not in df.columns:
            continue
        leg_df = df[df["side"] == leg]
        if leg_df.empty:
            continue
        f_mean = float(leg_df["Force_at_PP"].mean())
        v_mean = float(leg_df["Vel_at_PP"].mean())
        pp_mean = float(leg_df["PP_FORCEPLATE"].mean())
        color = session_color(idx)
        ax.scatter([f_mean], [v_mean], s=1440, color=color, alpha=0.95,
                   zorder=5, marker="o", edgecolors="white", linewidths=2.5)
        points.append((f_mean, v_mean))
        pp_pct = (percentileofscore(pp_pop, pp_mean)
                  if len(pp_pop) > 0 else 0)
        legend_lines.append(
            f"{format_session_label(sess['date'])}  PP {int(pp_pct)}th"
        )

    if len(points) >= 2:
        _annotate_fv_trajectory(ax, points)

    if legend_lines:
        ax.text(0.98, 0.98, "\n".join(legend_lines),
                transform=ax.transAxes, ha="right", va="top",
                color="white", fontsize=24, family="monospace")

    _style_dark_axes(ax, title=f"{leg} Leg F–V Scatter", title_size=48,
                     xlabel="Force @ PP (N)", ylabel="Vel @ PP (m/s)")


# ---------------------------------------------------------------------------
# Power curve (per-session mean curves overlaid)
# ---------------------------------------------------------------------------
def _load_session_power_curves(df: pd.DataFrame, power_files_dir: Optional[str]) -> List:
    """Return a list of (t_norm, p_norm) tuples for each trial in ``df``.

    Mirrors the loader logic in pdf_report.power_curve, falling back to
    a synthesized Gaussian shape when a Power.txt is missing.
    """
    curves = []
    processed_dir = (os.path.join(power_files_dir, "Processed txt Files")
                     if power_files_dir else None)
    try:
        from athleticScreen.power_analysis import load_power_txt  # noqa: WPS433
    except Exception:
        load_power_txt = None  # type: ignore

    for _, r in df.iterrows():
        trial_name = r.get("trial_name") if "trial_name" in df.columns else None
        power_file = None
        if processed_dir and trial_name and load_power_txt is not None:
            patterns = [
                os.path.join(processed_dir, f"{trial_name}_Power.txt"),
                os.path.join(processed_dir, f"{trial_name}*_Power.txt"),
                os.path.join(power_files_dir, f"{trial_name}_Power.txt"),
                os.path.join(power_files_dir, f"{trial_name}*_Power.txt"),
            ]
            for pattern in patterns:
                matches = glob.glob(pattern)
                if matches:
                    power_file = matches[0]
                    break

        if power_file and os.path.exists(power_file) and load_power_txt is not None:
            try:
                power_data = load_power_txt(power_file)
                if len(power_data) > 0:
                    t_norm = np.linspace(0, 1, len(power_data))
                    p_norm = (power_data - power_data.min()) / (power_data.max() - power_data.min() + 1e-10)
                    curves.append((t_norm, p_norm))
                    continue
            except Exception:  # pragma: no cover - fallback to synthesized
                pass

        # Synthesized fallback so the curve still renders something useful.
        t = np.linspace(0, 1, 200)
        pp_value = r.get("PP_FORCEPLATE", 1.0) or 1.0
        shape = np.exp(-((t - 0.35) ** 2) / 0.06) * pp_value
        curves.append((t, shape / shape.max()))

    return curves


def _mean_curve(curves) -> Optional[np.ndarray]:
    if not curves:
        return None
    t_common = np.linspace(0, 1, 200)
    interps = []
    for t_vals, p_vals in curves:
        f = interp1d(t_vals, p_vals, kind="linear",
                     bounds_error=False, fill_value="extrapolate")
        interps.append(f(t_common))
    return np.mean(interps, axis=0)


def comparison_power_curve(ax, sessions: List[Dict],
                           power_files_dir: Optional[str] = None) -> None:
    """Plot one mean power curve per session, in session color."""
    t_common = np.linspace(0, 1, 200)
    legend_handles = []
    for idx, sess in enumerate(sessions):
        df = sess["df"]
        if df.empty:
            continue
        curves = _load_session_power_curves(df, power_files_dir)
        mean = _mean_curve(curves)
        if mean is None:
            continue
        color = session_color(idx)
        line, = ax.plot(t_common, mean, color=color, linewidth=7,
                        label=format_session_label(sess["date"]))
        legend_handles.append(line)

    if legend_handles:
        ax.legend(handles=legend_handles, loc="upper right",
                  facecolor=PANEL_BG, edgecolor="white",
                  labelcolor="white", fontsize=27)

    _style_dark_axes(ax, title="Power Curve", title_size=60,
                     xlabel="Normalized Time", ylabel="Power (W)")


def slv_comparison_power_curve(ax, sessions: List[Dict],
                               power_files_dir: Optional[str] = None) -> None:
    """SLV power curve: solid line for L, dotted line for R, per session."""
    t_common = np.linspace(0, 1, 200)
    legend_handles = []
    for idx, sess in enumerate(sessions):
        df = sess["df"]
        if df.empty or "side" not in df.columns:
            continue
        color = session_color(idx)
        for side, linestyle, marker in (("Left", "-", "L"), ("Right", ":", "R")):
            sub = df[df["side"] == side]
            if sub.empty:
                continue
            curves = _load_session_power_curves(sub, power_files_dir)
            mean = _mean_curve(curves)
            if mean is None:
                continue
            line, = ax.plot(t_common, mean, color=color, linewidth=6.5,
                            linestyle=linestyle,
                            label=f"{format_session_label(sess['date'])} {marker}")
            legend_handles.append(line)

    if legend_handles:
        ax.legend(handles=legend_handles, loc="upper right",
                  facecolor=PANEL_BG, edgecolor="white",
                  labelcolor="white", fontsize=24)

    _style_dark_axes(ax, title="Power Curve", title_size=60,
                     xlabel="Normalized Time", ylabel="Power (W)")


# ---------------------------------------------------------------------------
# Performance table (multi-session)
# ---------------------------------------------------------------------------
def _tier_for(value: float, pop_series, fallback: str = "Average") -> str:
    if pop_series is None or len(pop_series) == 0 or value is None or pd.isna(value):
        return fallback
    return percentile_to_tier(percentileofscore(pop_series, value))


def _kurtosis_label(value: float) -> str:
    if value is None or pd.isna(value):
        return "—"
    if value < -1.3:
        return "Very Flat"
    if value < -0.4:
        return "Moderately Flat"
    if value < 0.5:
        return "Typical"
    return "Sharp"


def _kurtosis_inside_ideal(value: float, movement_name: str) -> Optional[bool]:
    ideal = KURTOSIS_IDEAL_RANGE.get(movement_name)
    if ideal is None or value is None or pd.isna(value):
        return None
    low, high = ideal
    return low <= value <= high


def _ideal_text(var: str, movement_name: str) -> str:
    if var == "rpd":
        return f">{_format_sigfig(ELITE_RPD_REFERENCE.get(movement_name, 25000), 4)}"
    if var == "auc":
        return f">{_format_sigfig(ELITE_AUC_REFERENCE.get(movement_name, 1100), 4)}"
    if var == "kurtosis":
        ideal = KURTOSIS_IDEAL_RANGE.get(movement_name)
        if ideal:
            low, high = ideal
            return f"{_format_sigfig(low, 3)} to {_format_sigfig(high, 3)}"
        return "-0.4 to 0.5"
    return ""


def _build_table_cells(sessions: List[Dict], movement_name: str,
                       population: pd.DataFrame, slv_leg: Optional[str] = None):
    """Produce text + tier color matrices for the comparison performance table.

    For DJ/CMJ/PPU ``slv_leg`` is None and we use the session's ``avg`` row.
    For SLV, ``slv_leg`` is 'Left' or 'Right' and we average that leg's
    trials within each session.
    """
    rpd_pop = population["rpd_max_w_per_s"].dropna() if "rpd_max_w_per_s" in population.columns else pd.Series([])
    auc_pop = population["auc_j"].dropna() if "auc_j" in population.columns else pd.Series([])
    color_map = _tier_color_map()
    KURT_INSIDE = _hex_to_pastel_rgba("#00ff00", 0.5)
    KURT_OUTSIDE = _hex_to_pastel_rgba("#d62728", 0.5)
    NEUTRAL = color_map["Average"]

    rpd_row = []
    kurt_row = []
    auc_row = []

    for sess in sessions:
        df = sess["df"]
        if slv_leg is not None and not df.empty and "side" in df.columns:
            df = df[df["side"] == slv_leg]

        if df is None or df.empty:
            rpd_row.append(("—", NEUTRAL))
            kurt_row.append(("—", NEUTRAL))
            auc_row.append(("—", NEUTRAL))
            continue

        row = df.mean(numeric_only=True)
        rpd_val = row.get("rpd_max_w_per_s", np.nan)
        kurt_val = row.get("kurtosis", np.nan)
        auc_val = row.get("auc_j", np.nan)

        rpd_tier = _tier_for(rpd_val, rpd_pop)
        auc_tier = _tier_for(auc_val, auc_pop)
        kurt_inside = _kurtosis_inside_ideal(kurt_val, movement_name)

        rpd_row.append((
            f"{_format_sigfig(rpd_val, 4)}\n{rpd_tier}",
            color_map.get(rpd_tier, NEUTRAL),
        ))
        kurt_color = (
            KURT_INSIDE if kurt_inside is True
            else KURT_OUTSIDE if kurt_inside is False
            else NEUTRAL
        )
        kurt_row.append((
            f"{_format_sigfig(kurt_val, 3)}\n{_kurtosis_label(kurt_val)}",
            kurt_color,
        ))
        auc_row.append((
            f"{_format_sigfig(auc_val, 4)}\n{auc_tier}",
            color_map.get(auc_tier, NEUTRAL),
        ))

    return rpd_row, kurt_row, auc_row


def comparison_performance_table(ax, sessions: List[Dict], movement_name: str,
                                 population: pd.DataFrame) -> None:
    """One column per session — value on top, tier label below the value.

    The whole cell is colored by tier (Max RPD / Work AUC) or by per-athlete
    in-ideal-range (Kurtosis), matching the single-session report.
    """
    ax.axis("off")
    ax.set_facecolor(PANEL_BG)

    rpd_row, kurt_row, auc_row = _build_table_cells(sessions, movement_name, population)

    # Header
    headers = ["Variable"]
    for sess in sessions:
        headers.append(format_session_label(sess["date"]))
    headers.append("Ideal Values")

    # Body
    body = [
        ["Max RPD (W/s)"] + [c[0] for c in rpd_row] + [_ideal_text("rpd", movement_name)],
        ["Kurtosis"]      + [c[0] for c in kurt_row] + [_ideal_text("kurtosis", movement_name)],
        ["Work (AUC)"]    + [c[0] for c in auc_row] + [_ideal_text("auc", movement_name)],
    ]
    cell_colors = [
        ["#373e43"] + [c[1] for c in rpd_row] + ["#373e43"],
        ["#373e43"] + [c[1] for c in kurt_row] + ["#373e43"],
        ["#373e43"] + [c[1] for c in auc_row] + ["#373e43"],
    ]

    n_cols = len(headers)
    # Variable label gets a chunkier column; sessions share the rest evenly.
    var_w = 0.18
    ideal_w = 0.18
    sess_w = (1.0 - var_w - ideal_w) / max(1, len(sessions))
    col_widths = [var_w] + [sess_w] * len(sessions) + [ideal_w]

    table = ax.table(cellText=body, colLabels=headers,
                     cellColours=cell_colors,
                     cellLoc="center", loc="center",
                     colWidths=col_widths,
                     bbox=[0.02, 0.05, 0.96, 0.9])
    table.auto_set_font_size(False)
    table.set_fontsize(30)

    # Header styling
    for i in range(n_cols):
        cell = table[(0, i)]
        cell.set_facecolor(PANEL_BG)
        cell.set_text_props(weight="bold", color="white", fontsize=30)
        cell.set_edgecolor("white")
        cell.set_linewidth(1.5)

    # Body styling
    for r in range(1, 4):
        for c in range(n_cols):
            cell = table[(r, c)]
            cell.set_text_props(color="white", fontsize=28,
                                weight="bold" if c not in (0, n_cols - 1) else "normal")
            cell.set_edgecolor("white")

    table.scale(1, 1.4)


def slv_comparison_performance_table(ax, sessions: List[Dict],
                                     population: pd.DataFrame) -> None:
    """SLV table: rows alternate L / R for each metric, one column per session."""
    ax.axis("off")
    ax.set_facecolor(PANEL_BG)

    l_rpd, l_kurt, l_auc = _build_table_cells(sessions, "SLV", population, slv_leg="Left")
    r_rpd, r_kurt, r_auc = _build_table_cells(sessions, "SLV", population, slv_leg="Right")

    headers = ["Variable", "Side"]
    for sess in sessions:
        headers.append(format_session_label(sess["date"]))
    headers.append("Ideal Values")

    rows = [
        ("Max RPD (W/s)", "L", l_rpd, _ideal_text("rpd", "SLV")),
        ("Max RPD (W/s)", "R", r_rpd, _ideal_text("rpd", "SLV")),
        ("Kurtosis",      "L", l_kurt, _ideal_text("kurtosis", "SLV")),
        ("Kurtosis",      "R", r_kurt, _ideal_text("kurtosis", "SLV")),
        ("Work (AUC)",    "L", l_auc, _ideal_text("auc", "SLV")),
        ("Work (AUC)",    "R", r_auc, _ideal_text("auc", "SLV")),
    ]

    body = []
    cell_colors = []
    for var, side, cells, ideal in rows:
        body.append([var, side] + [c[0] for c in cells] + [ideal])
        cell_colors.append(["#373e43", "#373e43"] + [c[1] for c in cells] + ["#373e43"])

    n_cols = len(headers)
    var_w = 0.16
    side_w = 0.06
    ideal_w = 0.18
    sess_w = (1.0 - var_w - side_w - ideal_w) / max(1, len(sessions))
    col_widths = [var_w, side_w] + [sess_w] * len(sessions) + [ideal_w]

    table = ax.table(cellText=body, colLabels=headers,
                     cellColours=cell_colors,
                     cellLoc="center", loc="center",
                     colWidths=col_widths,
                     bbox=[0.02, 0.05, 0.96, 0.9])
    table.auto_set_font_size(False)
    table.set_fontsize(28)

    for i in range(n_cols):
        cell = table[(0, i)]
        cell.set_facecolor(PANEL_BG)
        cell.set_text_props(weight="bold", color="white", fontsize=28)
        cell.set_edgecolor("white")
        cell.set_linewidth(1.5)

    for r in range(1, len(rows) + 1):
        for c in range(n_cols):
            cell = table[(r, c)]
            cell.set_text_props(color="white", fontsize=26,
                                weight="bold" if 1 < c < n_cols - 1 else "normal")
            cell.set_edgecolor("white")

    table.scale(1, 1.2)


# ---------------------------------------------------------------------------
# Force/Velocity rings — one ring per session per metric
# ---------------------------------------------------------------------------
def _draw_single_ring(ax, value: float, percentile: float, unit: str,
                      label_below: str, value_size: int = 60,
                      unit_size: int = 36, label_size: int = 28) -> None:
    """Draw one ring at the center of ``ax`` (data coords 0..1 each axis)."""
    ax.set_aspect("equal")
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.axis("off")
    ax.set_facecolor(PANEL_BG)

    cx, cy = 0.5, 0.55
    r = 0.34

    pct_100 = max(0.0, min(100.0, percentile * 100.0))
    color = pct_color(pct_100)

    ax.add_patch(Circle((cx, cy), r, fill=False, color="#303030",
                        linewidth=18, alpha=1.0))
    if percentile > 0:
        theta_start = 90
        theta_end = 90 + (percentile * 360)
        ax.add_patch(Arc((cx, cy), r * 2, r * 2, angle=0,
                         theta1=theta_start, theta2=theta_end,
                         color=color, linewidth=36, alpha=0.9))

    ax.text(cx, cy + 0.05, f"{int(pct_100)}",
            color="white", fontsize=value_size,
            ha="center", va="center", weight="bold")
    ax.text(cx, cy - 0.07, f"{value:.1f} {unit}",
            color="white", fontsize=unit_size,
            ha="center", va="center")
    if label_below:
        ax.text(cx, 0.06, label_below,
                color="white", fontsize=label_size,
                ha="center", va="center", weight="bold")


def comparison_force_velocity_rings(fig, sessions: List[Dict], population: pd.DataFrame,
                                    *, group_left: float, group_bottom: float,
                                    group_width: float, group_height: float) -> None:
    """Lay out a 2-row × N-col grid of rings for Force (top) and Velocity (bottom).

    Each session contributes one Force ring and one Velocity ring; the
    ring's percentile is computed against the population for the relevant
    metric. Session date is shown below each ring.
    """
    n = len(sessions)
    if n == 0:
        return

    # Title above the group
    fig.text(group_left + group_width / 2, group_bottom + group_height + 0.012,
             "@ Peak Power", ha="center", va="bottom",
             color="white", fontsize=44, fontweight="bold",
             transform=fig.transFigure)

    row_h = (group_height - 0.025) / 2
    cell_w = group_width / n

    pop_force = population["Force_at_PP"].dropna() if "Force_at_PP" in population.columns else pd.Series([])
    pop_vel = population["Vel_at_PP"].dropna() if "Vel_at_PP" in population.columns else pd.Series([])

    # Row labels (Force / Velocity) in the left margin
    row_force_y = group_bottom + row_h + 0.015 + row_h / 2
    row_vel_y = group_bottom + row_h / 2
    fig.text(group_left - 0.018, row_force_y, "Force",
             ha="right", va="center", color="white",
             fontsize=32, fontweight="bold",
             transform=fig.transFigure)
    fig.text(group_left - 0.018, row_vel_y, "Velocity",
             ha="right", va="center", color="white",
             fontsize=32, fontweight="bold",
             transform=fig.transFigure)

    for idx, sess in enumerate(sessions):
        df = sess["df"]
        if df.empty:
            continue
        best = sess["avg"]
        f_val = float(best.get("Force_at_PP", np.nan))
        v_val = float(best.get("Vel_at_PP", np.nan))
        f_pct = (percentileofscore(pop_force, f_val) / 100.0
                 if len(pop_force) else 0.0)
        v_pct = (percentileofscore(pop_vel, v_val) / 100.0
                 if len(pop_vel) else 0.0)

        x = group_left + idx * cell_w
        # Force ring (top row)
        ax_f = fig.add_axes([x, group_bottom + row_h + 0.025, cell_w, row_h])
        _draw_single_ring(ax_f, f_val, f_pct, "N",
                          format_session_label(sess["date"]))
        # Velocity ring (bottom row)
        ax_v = fig.add_axes([x, group_bottom, cell_w, row_h])
        _draw_single_ring(ax_v, v_val, v_pct, "m/s",
                          format_session_label(sess["date"]))


def slv_comparison_force_velocity_rings(fig, sessions: List[Dict],
                                        population: pd.DataFrame, *,
                                        group_left: float, group_bottom: float,
                                        group_width: float, group_height: float) -> None:
    """SLV ring grid: 4 rows × N columns.

    Rows top→bottom: Left Force, Left Velocity, Right Force, Right Velocity.
    Each column is a session.
    """
    n = len(sessions)
    if n == 0:
        return

    fig.text(group_left + group_width / 2, group_bottom + group_height + 0.005,
             "@ Peak Power", ha="center", va="bottom",
             color="white", fontsize=42, fontweight="bold",
             transform=fig.transFigure)

    rows = [
        ("Left",  "force",    "Force"),
        ("Left",  "velocity", "Velocity"),
        ("Right", "force",    "Force"),
        ("Right", "velocity", "Velocity"),
    ]
    n_rows = len(rows)
    row_h = (group_height - 0.05) / n_rows
    cell_w = group_width / n

    pop_force = population["Force_at_PP"].dropna() if "Force_at_PP" in population.columns else pd.Series([])
    pop_vel = population["Vel_at_PP"].dropna() if "Vel_at_PP" in population.columns else pd.Series([])

    # Row labels — show "Left Leg" before its two rows, "Right Leg" before
    # its two rows. Each row also shows its metric (Force/Velocity).
    for r_idx, (leg, metric, label) in enumerate(rows):
        # Top-down: r_idx 0 is the topmost row
        row_top_y = group_bottom + group_height - (r_idx + 1) * row_h - r_idx * 0.005
        center_y = row_top_y + row_h / 2
        # Combined leg + metric label
        fig.text(group_left - 0.018, center_y, f"{leg}\n{label}",
                 ha="right", va="center", color="white",
                 fontsize=24, fontweight="bold",
                 transform=fig.transFigure)

    for idx, sess in enumerate(sessions):
        df = sess["df"]
        if df.empty or "side" not in df.columns:
            continue
        x = group_left + idx * cell_w

        for r_idx, (leg, metric, _label) in enumerate(rows):
            row_top_y = group_bottom + group_height - (r_idx + 1) * row_h - r_idx * 0.005
            sub = df[df["side"] == leg]
            if sub.empty:
                continue
            best = sub.mean(numeric_only=True)
            if metric == "force":
                val = float(best.get("Force_at_PP", np.nan))
                pct = (percentileofscore(pop_force, val) / 100.0
                       if len(pop_force) else 0.0)
                unit = "N"
            else:
                val = float(best.get("Vel_at_PP", np.nan))
                pct = (percentileofscore(pop_vel, val) / 100.0
                       if len(pop_vel) else 0.0)
                unit = "m/s"

            ax = fig.add_axes([x, row_top_y, cell_w, row_h])
            label_below = (format_session_label(sess["date"])
                           if r_idx == n_rows - 1 else "")
            _draw_single_ring(ax, val, pct, unit, label_below,
                              value_size=44, unit_size=26, label_size=20)
