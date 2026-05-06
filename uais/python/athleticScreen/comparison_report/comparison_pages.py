"""
Per-movement page builders for the comparison PDF.

Each ``*_page`` function in here takes a ``PdfPages`` instance, the per-session
dataframes for that movement, the population dataframe, and the meta info
(athlete name, list of session dates) and renders one A-portrait-shaped page
to the PDF.

Layouts mirror the single-session report (``pdf_report.py``) closely:
  - DJ uses a tall figure with 4 histograms up top
  - CMJ / PPU use the standard 2-histogram layout
  - SLV uses the standard layout but with two side-by-side radars / FV
    scatters and a 4-row ring grid (Left/Right × Force/Velocity)

We deliberately do NOT touch ``pdf_report.py``. The two header helpers and
the logo helper are imported from it as-is.
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Dict, List, Optional

import matplotlib
matplotlib.use("Agg")  # noqa: E402  (must be before pyplot import)
import matplotlib.pyplot as plt  # noqa: E402
import pandas as pd  # noqa: E402
from matplotlib.lines import Line2D  # noqa: E402
from matplotlib.patches import Rectangle  # noqa: E402

_python_dir = Path(__file__).resolve().parent.parent.parent
if str(_python_dir) not in sys.path:
    sys.path.insert(0, str(_python_dir))

# Reuse the existing logo helper. We don't reuse the existing add_header_*
# helpers because those bake in a single date string; we compose our own
# header so we can render a session-date list.
from athleticScreen.pdf_report import add_logo  # noqa: E402

from .comparison_plots import (
    comparison_bar_graph,
    comparison_fv_scatter,
    comparison_force_velocity_rings,
    comparison_performance_table,
    comparison_power_curve,
    comparison_radar_chart,
    slv_comparison_bar_graph,
    slv_comparison_force_velocity_rings,
    slv_comparison_fv_scatter,
    slv_comparison_performance_table,
    slv_comparison_power_curve,
    slv_comparison_radar_chart,
)
from .config import (
    ACCENT_COLOR,
    MOVEMENT_TITLES,
    PAGE_BG,
    PANEL_BG,
    SESSION_COLORS,
    format_session_label,
)


# ---------------------------------------------------------------------------
# Shared header — vertical accent bar, athlete name, session-date list, logo
# ---------------------------------------------------------------------------
def _add_comparison_header(fig, athlete_name: str, session_dates: List[str],
                           logo_path: Optional[str], *,
                           name_y: float = 0.965,
                           dates_top_y: float = 0.945,
                           accent_y: float = 0.91) -> None:
    """Header used on every comparison page.

    Lays out: vertical accent bar on the far left, "Comparison Report" tag
    above the athlete name, a stacked list of session dates colored to match
    the session palette, a horizontal accent line, and the logo on the right.
    """
    # Vertical accent bar
    bar_width = 0.03
    fig.add_artist(Rectangle((0, 0), bar_width, 1,
                             transform=fig.transFigure,
                             facecolor=ACCENT_COLOR, zorder=1001))

    # Title row + athlete name
    fig.text(0.07, name_y, athlete_name,
             fontsize=72, color="white", ha="left", va="top",
             fontweight="bold", fontfamily="sans-serif", style="italic",
             zorder=1002)
    fig.text(0.07, name_y - 0.018, "Comparison Report",
             fontsize=42, color="#cfd6dc", ha="left", va="top",
             fontfamily="sans-serif",
             zorder=1002)

    # Session-date legend strip — small colored squares + dates, in the
    # white space between the name and the right-hand logo.
    label_x = 0.39
    for i, date_str in enumerate(session_dates):
        y = dates_top_y - i * 0.013
        # Color swatch
        fig.add_artist(Rectangle((label_x, y - 0.004), 0.012, 0.011,
                                 transform=fig.transFigure,
                                 facecolor=SESSION_COLORS[
                                     min(i, len(SESSION_COLORS) - 1)],
                                 edgecolor="white", linewidth=1.0,
                                 zorder=1002))
        fig.text(label_x + 0.018, y,
                 format_session_label(date_str),
                 fontsize=32, color="white", ha="left", va="center",
                 fontweight="bold", zorder=1002)

    # Horizontal accent line
    fig.add_artist(Line2D([0.05, 0.98], [accent_y, accent_y],
                          transform=fig.transFigure,
                          color=ACCENT_COLOR, linewidth=9, zorder=1002))

    # Logo
    add_logo(fig, logo_path, position="top-right")


def _set_axes_backgrounds(fig) -> None:
    for ax in fig.get_axes():
        if hasattr(ax, "set_facecolor"):
            ax.set_facecolor(PANEL_BG)


def _build_sessions_with_avg(per_session_dfs: List[pd.DataFrame],
                             session_dates: List[str]) -> List[Dict]:
    """Pair each session date with its dataframe and the session-average row.

    For SLV per-leg averages are computed inside the SLV plot helpers themselves.
    """
    sessions = []
    for date_str, df in zip(session_dates, per_session_dfs):
        if df is None or df.empty:
            sessions.append({"date": date_str, "df": pd.DataFrame(), "avg": None})
            continue
        avg = df.mean(numeric_only=True)
        sessions.append({"date": date_str, "df": df, "avg": avg})
    return sessions


# ---------------------------------------------------------------------------
# DJ page (4 histograms + scatter + radar + power curve + table + rings)
# ---------------------------------------------------------------------------
def dj_page(pdf, per_session_dfs, pop_df, athlete_name: str,
            session_dates: List[str], logo_path: Optional[str] = None,
            power_files_dir: Optional[str] = None) -> None:
    sessions = _build_sessions_with_avg(per_session_dfs, session_dates)
    if not any(not s["df"].empty for s in sessions):
        return

    fig = plt.figure(figsize=(54, 90), facecolor=PAGE_BG)
    fig.patch.set_facecolor(PAGE_BG)

    # 4 histograms on top — JH_IN, PP_W_per_kg, RSI, CT
    bar_metrics = ["JH_IN", "PP_W_per_kg", "RSI", "CT"]
    graph_w = 0.35
    graph_h = 0.16

    # First row of two
    top_bottom = 0.73
    top_h = 0.19
    h_spacing = (1.0 - 2 * graph_w) / 3
    v_spacing = (top_h - graph_h) / 2
    for i, metric in enumerate(bar_metrics[:2]):
        x = h_spacing + i * (graph_w + h_spacing)
        ax = fig.add_axes([x, top_bottom + v_spacing, graph_w, graph_h])
        comparison_bar_graph(ax, metric, sessions, pop_df)

    # Second row of two
    second_top = top_bottom
    second_bottom = 0.55
    second_h = second_top - second_bottom
    v_spacing2 = (second_h - graph_h) / 2
    for i, metric in enumerate(bar_metrics[2:]):
        x = h_spacing + i * (graph_w + h_spacing)
        ax = fig.add_axes([x, second_bottom + v_spacing2, graph_w, graph_h])
        comparison_bar_graph(ax, metric, sessions, pop_df)

    # Radar (left) + power curve (right)
    ax_radar = fig.add_axes([0.11, 0.042, 0.29, 0.22], polar=True)
    comparison_radar_chart(ax_radar, sessions, pop_df, "DJ")

    ax_power = fig.add_axes([0.50, 0.11, 0.43, 0.13])
    comparison_power_curve(ax_power, sessions, power_files_dir)

    # Performance table
    ax_table = fig.add_axes([0.435, 0.002, 0.56, 0.10])
    comparison_performance_table(ax_table, sessions, "DJ", pop_df)

    # FV scatter (left) + rings (right)
    ax_fv = fig.add_axes([0.09, 0.285, 0.50, 0.24])
    comparison_fv_scatter(ax_fv, sessions, pop_df)
    comparison_force_velocity_rings(
        fig, sessions, pop_df,
        group_left=0.66, group_bottom=0.27,
        group_width=0.30, group_height=0.24,
    )

    # Page title
    plt.suptitle(MOVEMENT_TITLES["DJ"], fontsize=150, color="white",
                 fontweight="bold", fontfamily="sans-serif", style="italic")

    _add_comparison_header(fig, athlete_name, session_dates, logo_path,
                           name_y=0.965, dates_top_y=0.948, accent_y=0.928)
    _set_axes_backgrounds(fig)
    pdf.savefig(fig, facecolor=PAGE_BG, edgecolor="none")
    plt.close(fig)


# ---------------------------------------------------------------------------
# CMJ / PPU pages (2 histograms + scatter + radar + power curve + table + rings)
# ---------------------------------------------------------------------------
def _generic_two_bar_page(pdf, movement_name: str, per_session_dfs, pop_df,
                          athlete_name: str, session_dates: List[str],
                          logo_path: Optional[str], power_files_dir: Optional[str]) -> None:
    sessions = _build_sessions_with_avg(per_session_dfs, session_dates)
    if not any(not s["df"].empty for s in sessions):
        return

    fig = plt.figure(figsize=(54, 65), facecolor=PAGE_BG)
    fig.patch.set_facecolor(PAGE_BG)

    # Top: two histograms
    graph_w = 0.38
    graph_h = 0.22
    top_bottom = 0.647
    h_spacing = (1.0 - 2 * graph_w) / 3
    for i, metric in enumerate(["JH_IN", "PP_W_per_kg"]):
        x = h_spacing + i * (graph_w + h_spacing)
        ax = fig.add_axes([x, top_bottom, graph_w, graph_h])
        comparison_bar_graph(ax, metric, sessions, pop_df)

    # Radar + power curve
    ax_radar = fig.add_axes([0.11, 0.055, 0.29, 0.22], polar=True)
    comparison_radar_chart(ax_radar, sessions, pop_df, movement_name)
    ax_power = fig.add_axes([0.50, 0.125, 0.43, 0.16])
    comparison_power_curve(ax_power, sessions, power_files_dir)

    # Performance table
    ax_table = fig.add_axes([0.435, -0.025, 0.56, 0.17])
    comparison_performance_table(ax_table, sessions, movement_name, pop_df)

    # FV scatter + rings
    ax_fv = fig.add_axes([0.09, 0.325, 0.50, 0.283])
    comparison_fv_scatter(ax_fv, sessions, pop_df)
    comparison_force_velocity_rings(
        fig, sessions, pop_df,
        group_left=0.66, group_bottom=0.30,
        group_width=0.30, group_height=0.30,
    )

    plt.suptitle(MOVEMENT_TITLES[movement_name], fontsize=150,
                 color="white", fontweight="bold",
                 fontfamily="sans-serif", style="italic", y=0.978)

    _add_comparison_header(fig, athlete_name, session_dates, logo_path,
                           name_y=0.96, dates_top_y=0.935, accent_y=0.90)
    _set_axes_backgrounds(fig)
    pdf.savefig(fig, facecolor=PAGE_BG, edgecolor="none")
    plt.close(fig)


def cmj_page(pdf, per_session_dfs, pop_df, athlete_name: str,
             session_dates: List[str], logo_path: Optional[str] = None,
             power_files_dir: Optional[str] = None) -> None:
    _generic_two_bar_page(pdf, "CMJ", per_session_dfs, pop_df,
                          athlete_name, session_dates, logo_path, power_files_dir)


def ppu_page(pdf, per_session_dfs, pop_df, athlete_name: str,
             session_dates: List[str], logo_path: Optional[str] = None,
             power_files_dir: Optional[str] = None) -> None:
    _generic_two_bar_page(pdf, "PPU", per_session_dfs, pop_df,
                          athlete_name, session_dates, logo_path, power_files_dir)


# ---------------------------------------------------------------------------
# SLV page — two radars side-by-side + per-leg FV scatters + 4-row rings
# ---------------------------------------------------------------------------
def slv_page(pdf, per_session_dfs, pop_df, athlete_name: str,
             session_dates: List[str], logo_path: Optional[str] = None,
             power_files_dir: Optional[str] = None) -> None:
    sessions = _build_sessions_with_avg(per_session_dfs, session_dates)
    if not any(not s["df"].empty for s in sessions):
        return

    # SLV needs the most vertical real-estate of any page: histograms,
    # two radars, a full-width power curve, two FV scatters, four rows of
    # rings (Left/Right × Force/Velocity), and a 6-row × N-col performance
    # table. We use a tall figure and divide it into clearly stacked bands.
    fig = plt.figure(figsize=(54, 130), facecolor=PAGE_BG)
    fig.patch.set_facecolor(PAGE_BG)

    # Band 1 — Histograms (top)
    graph_w = 0.38
    graph_h = 0.115
    top_bottom = 0.815
    h_spacing = (1.0 - 2 * graph_w) / 3
    for i, metric in enumerate(["JH_IN", "PP_W_per_kg"]):
        x = h_spacing + i * (graph_w + h_spacing)
        ax = fig.add_axes([x, top_bottom, graph_w, graph_h])
        slv_comparison_bar_graph(ax, metric, sessions, pop_df)

    # Band 2 — Two radars (Left | Right) side-by-side
    ax_radar_left = fig.add_axes([0.05, 0.625, 0.42, 0.16], polar=True)
    slv_comparison_radar_chart(ax_radar_left, sessions, pop_df, leg="Left")
    ax_radar_right = fig.add_axes([0.53, 0.625, 0.42, 0.16], polar=True)
    slv_comparison_radar_chart(ax_radar_right, sessions, pop_df, leg="Right")

    # Band 3 — Full-width power curve
    ax_power = fig.add_axes([0.09, 0.51, 0.86, 0.075])
    slv_comparison_power_curve(ax_power, sessions, power_files_dir)

    # Band 4 — Per-leg FV scatters
    ax_fv_left = fig.add_axes([0.06, 0.36, 0.42, 0.115])
    slv_comparison_fv_scatter(ax_fv_left, sessions, pop_df, leg="Left")
    ax_fv_right = fig.add_axes([0.53, 0.36, 0.42, 0.115])
    slv_comparison_fv_scatter(ax_fv_right, sessions, pop_df, leg="Right")

    # Band 5 — 4-row × N-col ring grid
    slv_comparison_force_velocity_rings(
        fig, sessions, pop_df,
        group_left=0.18, group_bottom=0.135,
        group_width=0.78, group_height=0.20,
    )

    # Band 6 — Performance table (bottom; needs ~6 rows of vertical room)
    ax_table = fig.add_axes([0.04, 0.012, 0.92, 0.105])
    slv_comparison_performance_table(ax_table, sessions, pop_df)

    plt.suptitle(MOVEMENT_TITLES["SLV"], fontsize=150,
                 color="white", fontweight="bold",
                 fontfamily="sans-serif", style="italic", y=0.985)

    _add_comparison_header(fig, athlete_name, session_dates, logo_path,
                           name_y=0.975, dates_top_y=0.962, accent_y=0.95)
    _set_axes_backgrounds(fig)
    pdf.savefig(fig, facecolor=PAGE_BG, edgecolor="none")
    plt.close(fig)


# ---------------------------------------------------------------------------
# Movement → page renderer dispatch
# ---------------------------------------------------------------------------
PAGE_RENDERERS = {
    "DJ": dj_page,
    "CMJ": cmj_page,
    "PPU": ppu_page,
    "SLV": slv_page,
}
