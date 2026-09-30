"""
Front-matter summary page for the athletic-screen comparison report.

This is page 1 — the page you can turn around and show the athlete. The
per-movement pages that follow are unchanged; they stay the dense internal
detail. Everything here exists to answer three questions in one look:

    Where was he?   Where is he now?   Where does that sit in our data?

Layout, top to bottom
---------------------
  Header          athlete name, session date swatches, logo (shared with the
                  movement pages so the report reads as one document)
  Verdict tiles   session count / span, and how many metrics improved,
                  held, or declined
  Change tracks   the core of the page — one lane per metric, each showing
                  the population tier bands, a dot per session, and an arrow
                  from the first session to the last
  Biggest movers  the three largest gains and the three largest losses
  How to read     plain-language note on the noise bar and the cohort

The lanes are the whole idea: a single mark carries both the A-to-B change
and the standing in the population, so neither has to be read off a separate
chart and mentally joined.
"""
from __future__ import annotations

from typing import Dict, List, Optional, Sequence

import matplotlib
matplotlib.use("Agg")  # noqa: E402
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.lines import Line2D  # noqa: E402
from matplotlib.patches import Circle, FancyArrow, Rectangle  # noqa: E402

from .change_stats import (
    VERDICT_COLORS,
    VERDICT_DOWN,
    VERDICT_FLAT,
    VERDICT_NA,
    VERDICT_UP,
    build_tracks,
    format_delta,
    format_value,
    rank_movers,
)
from .config import (
    ACCENT_COLOR,
    MOVEMENT_ORDER,
    PAGE_BG,
    PANEL_BG,
    SESSION_COLORS,
    format_session_label,
    session_color,
)


# ---------------------------------------------------------------------------
# Typography — absolute point sizes, tuned for the 54in-wide page family
# ---------------------------------------------------------------------------
FS_SUPTITLE = 150
FS_SECTION = 58
FS_LANE_LABEL = 46
FS_LANE_MOVE = 32
FS_VALUE = 38
FS_DELTA = 36
FS_VERDICT = 44
FS_TILE_NUM = 120
FS_TILE_LABEL = 36
FS_AXIS = 30
FS_FOOT = 30
FS_MOVER = 38

MUTED = "#98a4ad"
SOFT = "#cfd6dc"
GRID = "#4a5359"

# Population tier bands along the percentile axis. Lifted from
# pdf_report.percentile_to_tier so the summary page and the performance
# tables label the same athlete the same way.
TIER_BANDS = [
    (0, 20, "Low", "#2b3237"),
    (20, 40, "Below Avg", "#334049"),
    (40, 60, "Average", "#3c4f5b"),
    (60, 80, "High", "#456070"),
    (80, 100, "Elite", "#4f7184"),
]

# Asymmetry zones for the SLV L/R lane, which has no population percentile.
ASYM_MAX = 20.0
ASYM_ZONES = [
    (0.0, 5.0, "Balanced", "#2f4d3b"),
    (5.0, 10.0, "Monitor", "#4e4830"),
    (10.0, ASYM_MAX, "Flagged", "#553233"),
]


# ---------------------------------------------------------------------------
# Small drawing helpers
# ---------------------------------------------------------------------------
def _strip_axes(ax) -> None:
    for spine in ax.spines.values():
        spine.set_visible(False)
    ax.set_xticks([])
    ax.set_yticks([])
    ax.set_facecolor(PAGE_BG)


def _session_marker_size(index: int, total: int) -> float:
    """Latest session reads loudest; earlier ones recede."""
    if total <= 1:
        return 900.0
    step = (1400.0 - 650.0) / max(total - 1, 1)
    return 650.0 + step * index


def _draw_band_axis(ax, bands: Sequence, axis_max: float, show_labels: bool,
                    label_pos: str = "above") -> None:
    """Shade the background zones of a lane and optionally label them.

    ``label_pos="above"`` puts the zone names in the gutter over the lane —
    only ever used on the first lane, where there is room. ``"inside"``
    prints them faintly within the bands themselves, for a lane that needs
    its own scale explained mid-page.
    """
    for low, high, label, color in bands:
        ax.add_patch(Rectangle((low, 0.18), high - low, 0.64,
                               facecolor=color, edgecolor="none", zorder=1))
        if not show_labels:
            continue
        if label_pos == "inside":
            ax.text((low + high) / 2, 0.30, label, ha="center", va="center",
                    fontsize=FS_AXIS - 2, color=SOFT, alpha=0.55, zorder=4)
        else:
            ax.text((low + high) / 2, 1.05, label, ha="center", va="bottom",
                    fontsize=FS_AXIS, color=MUTED, zorder=4)
    # Faint separators so the zone edges are legible against each other.
    for _, high, _, _ in bands[:-1]:
        ax.plot([high, high], [0.18, 0.82], color=PAGE_BG, linewidth=2.0, zorder=2)
    ax.set_xlim(0, axis_max)
    ax.set_ylim(0, 1)


def _draw_track(ax, points: Sequence[Optional[float]], axis_max: float) -> None:
    """Dots for each session plus an arrow from the first to the last.

    ``points`` is aligned with the session list; None entries are skipped
    (a session that has no data for this movement simply has no dot).
    """
    present = [(i, v) for i, v in enumerate(points) if v is not None]
    if not present:
        ax.text(axis_max / 2, 0.5, "no data", ha="center", va="center",
                fontsize=FS_AXIS, color=MUTED, style="italic", zorder=5)
        return

    total = len(points)
    y = 0.5

    # Connector — drawn under the dots, stopping short of the final dot so
    # the arrowhead has room.
    if len(present) > 1:
        xs = [v for _, v in present]
        ax.plot(xs, [y] * len(xs), color=SOFT, linewidth=4.0,
                alpha=0.55, zorder=3, solid_capstyle="round")
        start, end = present[-2][1], present[-1][1]
        span = end - start
        if abs(span) > axis_max * 0.012:
            head = axis_max * 0.018 * (1 if span > 0 else -1)
            ax.add_patch(FancyArrow(
                end - head, y, head * 0.98, 0,
                width=0.0, head_width=0.30, head_length=abs(head),
                length_includes_head=True,
                facecolor=session_color(present[-1][0]),
                edgecolor="none", zorder=4,
            ))

    for order, (session_index, value) in enumerate(present):
        color = session_color(session_index)
        is_last = order == len(present) - 1
        ax.scatter([value], [y],
                   s=_session_marker_size(order, len(present)),
                   facecolor=color if is_last else PAGE_BG,
                   edgecolor=color,
                   linewidths=5.0 if not is_last else 3.0,
                   zorder=6)

    # Call out the latest position numerically — the number a coach quotes.
    last_value = present[-1][1]
    ax.text(last_value, 0.88, f"{last_value:.0f}",
            ha="center", va="bottom", fontsize=FS_AXIS + 4,
            color=session_color(present[-1][0]), fontweight="bold", zorder=7)


# ---------------------------------------------------------------------------
# Page sections
# ---------------------------------------------------------------------------
def _draw_verdict_tiles(fig, tracks: Sequence[Dict], session_dates: Sequence[str],
                        *, top: float, height: float) -> None:
    """Four tiles: sessions compared, then improved / held / declined counts."""
    counts = {
        VERDICT_UP: sum(1 for t in tracks if t["verdict"] == VERDICT_UP),
        VERDICT_FLAT: sum(1 for t in tracks if t["verdict"] == VERDICT_FLAT),
        VERDICT_DOWN: sum(1 for t in tracks if t["verdict"] == VERDICT_DOWN),
    }

    span_text = f"{len(session_dates)} sessions"
    try:
        from datetime import datetime
        d0 = datetime.strptime(str(session_dates[0]), "%Y-%m-%d")
        d1 = datetime.strptime(str(session_dates[-1]), "%Y-%m-%d")
        span_text = f"{(d1 - d0).days} days apart"
    except (ValueError, TypeError, IndexError):
        pass

    tiles = [
        (str(len(session_dates)), "SESSIONS", span_text, ACCENT_COLOR),
        (str(counts[VERDICT_UP]), "IMPROVED", "cleared the noise bar",
         VERDICT_COLORS[VERDICT_UP]),
        (str(counts[VERDICT_FLAT]), "HELD", "moved, but not enough to count",
         VERDICT_COLORS[VERDICT_FLAT]),
        (str(counts[VERDICT_DOWN]), "DECLINED", "cleared the bar downward",
         VERDICT_COLORS[VERDICT_DOWN]),
    ]

    left, right = 0.045, 0.975
    gap = 0.014
    tile_w = (right - left - gap * (len(tiles) - 1)) / len(tiles)

    for i, (number, label, caption, color) in enumerate(tiles):
        x = left + i * (tile_w + gap)
        fig.add_artist(Rectangle((x, top - height), tile_w, height,
                                 transform=fig.transFigure,
                                 facecolor=PANEL_BG, edgecolor="none", zorder=5))
        # Accent rule along the top edge of the tile.
        fig.add_artist(Rectangle((x, top - height * 0.055), tile_w, height * 0.055,
                                 transform=fig.transFigure,
                                 facecolor=color, edgecolor="none", zorder=6))
        fig.text(x + tile_w / 2, top - height * 0.52, number,
                 ha="center", va="center", fontsize=FS_TILE_NUM,
                 color=color, fontweight="bold", zorder=7)
        fig.text(x + tile_w / 2, top - height * 0.74, label,
                 ha="center", va="center", fontsize=FS_TILE_LABEL,
                 color="white", fontweight="bold", zorder=7)
        fig.text(x + tile_w / 2, top - height * 0.88, caption,
                 ha="center", va="center", fontsize=FS_FOOT,
                 color=MUTED, zorder=7)


def _draw_tracks(fig, tracks: Sequence[Dict], session_dates: Sequence[str],
                 *, top: float, bottom: float) -> None:
    """The lane stack — one row per metric."""
    if not tracks:
        fig.text(0.5, (top + bottom) / 2,
                 "No shared metrics across the selected sessions.",
                 ha="center", va="center", fontsize=FS_SECTION, color=MUTED)
        return

    # Column geometry (figure coords).
    col_label_x = 0.048
    col_values_x = 0.225
    track_left = 0.415
    track_width = 0.44
    col_verdict_x = 0.885

    available = top - bottom
    lane_h = min(0.050, available / len(tracks))
    track_h = lane_h * 0.52

    # Section heading + column headers
    fig.text(col_label_x, top + 0.030, "WHAT CHANGED",
             fontsize=FS_SECTION, color="white", fontweight="bold",
             ha="left", va="bottom")
    fig.text(col_values_x, top + 0.014,
             "  →  ".join(format_session_label(d) for d in session_dates),
             fontsize=FS_AXIS + 2, color=MUTED, ha="left", va="bottom")
    fig.text(track_left + track_width / 2, top + 0.014,
             "PERCENTILE VS. OUR DATABASE",
             fontsize=FS_AXIS + 2, color=MUTED, ha="center", va="bottom")
    fig.text(col_verdict_x, top + 0.014, "VERDICT",
             fontsize=FS_AXIS + 2, color=MUTED, ha="left", va="bottom")

    fig.add_artist(Line2D([col_label_x, 0.975], [top + 0.008, top + 0.008],
                          transform=fig.transFigure, color=GRID, linewidth=2.5))

    last_movement = None
    for i, track in enumerate(tracks):
        lane_top = top - i * lane_h
        centre = lane_top - lane_h / 2

        # Zebra the movement groups so the eye can find "the CMJ block".
        if track["movement"] != last_movement:
            fig.add_artist(Line2D([col_label_x, 0.975], [lane_top, lane_top],
                                  transform=fig.transFigure,
                                  color=GRID, linewidth=1.6, alpha=0.8))
            fig.text(col_label_x, centre + lane_h * 0.20, track["movement"],
                     fontsize=FS_LANE_MOVE, color=ACCENT_COLOR,
                     fontweight="bold", ha="left", va="center")
            last_movement = track["movement"]

        # Metric name
        fig.text(col_label_x + 0.038, centre, track["label"],
                 fontsize=FS_LANE_LABEL, color="white", ha="left", va="center")

        # Per-session values, then the signed delta underneath
        value_text = "  →  ".join(
            format_value(v, track["metric"]) if v is not None else "—"
            for v in track["values"]
        )
        unit = track["unit"]
        fig.text(col_values_x, centre + lane_h * 0.13,
                 f"{value_text}{('  ' + unit) if unit else ''}",
                 fontsize=FS_VALUE, color=SOFT, ha="left", va="center")

        delta_bits = [format_delta(track)]
        if track.get("pct_delta") is not None:
            delta_bits.append(f"({track['pct_delta']:+.1f}%)")
        if track.get("pctile_delta") is not None:
            delta_bits.append(f"{track['pctile_delta']:+.0f} pctile")
        fig.text(col_values_x, centre - lane_h * 0.17, "  ".join(delta_bits),
                 fontsize=FS_DELTA, color=MUTED, ha="left", va="center")

        # The lane track itself
        ax = fig.add_axes([track_left, centre - track_h / 2, track_width, track_h])
        _strip_axes(ax)
        if track["metric"] == "ASYM_PCT":
            # No population percentile exists for a derived metric, so this
            # lane switches to an absolute 0-20% asymmetry scale with its own
            # zones. The zone labels are always drawn because they mean
            # something different from the tier bands above them.
            _draw_band_axis(ax, ASYM_ZONES, ASYM_MAX, show_labels=True,
                            label_pos="inside")
            points = [None if v is None else min(v, ASYM_MAX) for v in track["values"]]
            _draw_track(ax, points, ASYM_MAX)
        else:
            _draw_band_axis(ax, TIER_BANDS, 100.0, show_labels=(i == 0))
            _draw_track(ax, track["percentiles"], 100.0)

        # Verdict
        verdict = track["verdict"]
        fig.text(col_verdict_x, centre, verdict,
                 fontsize=FS_VERDICT, color=VERDICT_COLORS.get(verdict, SOFT),
                 fontweight="bold" if verdict in (VERDICT_UP, VERDICT_DOWN) else "normal",
                 ha="left", va="center")

    fig.add_artist(Line2D([col_label_x, 0.975],
                          [top - len(tracks) * lane_h, top - len(tracks) * lane_h],
                          transform=fig.transFigure, color=GRID, linewidth=2.5))


def _near_misses(tracks: Sequence[Dict], sign: int, limit: int) -> List[Dict]:
    """Held lanes that still moved in percentile terms, largest first.

    Without this, a session where several metrics slid ten or more percentile
    points but none cleared the noise bar would print an empty losses column —
    technically correct and practically misleading. These get listed, clearly
    marked as within-noise, underneath any real verdicts.
    """
    if limit <= 0:
        return []
    candidates = []
    for track in tracks:
        if track.get("verdict") != VERDICT_FLAT:
            continue
        moved = track.get("pctile_delta")
        if moved is None or abs(moved) < 5:
            continue
        if (moved > 0) == (sign > 0):
            candidates.append(track)
    candidates.sort(key=lambda t: abs(t["pctile_delta"]), reverse=True)
    return candidates[:limit]


def _draw_movers(fig, tracks: Sequence[Dict], *, top: float, height: float) -> None:
    """Two short columns: biggest gains and biggest losses."""
    gains = rank_movers(tracks, VERDICT_UP, limit=3)
    losses = rank_movers(tracks, VERDICT_DOWN, limit=3)

    # Fill any remaining slots with within-noise movement so a column is never
    # blank while the lanes above clearly show things moving.
    gain_extras = _near_misses(tracks, +1, 3 - len(gains))
    loss_extras = _near_misses(tracks, -1, 3 - len(losses))

    columns = [
        ("BIGGEST GAINS", gains, gain_extras, VERDICT_COLORS[VERDICT_UP],
         "Nothing moved upward."),
        ("BIGGEST LOSSES", losses, loss_extras, VERDICT_COLORS[VERDICT_DOWN],
         "Nothing moved downward."),
    ]

    left, right = 0.045, 0.975
    gap = 0.02
    col_w = (right - left - gap) / 2

    for i, (heading, items, extras, color, empty_text) in enumerate(columns):
        x = left + i * (col_w + gap)
        fig.add_artist(Rectangle((x, top - height), col_w, height,
                                 transform=fig.transFigure,
                                 facecolor=PANEL_BG, edgecolor="none", zorder=5))
        fig.add_artist(Rectangle((x, top - height), col_w * 0.006, height,
                                 transform=fig.transFigure,
                                 facecolor=color, edgecolor="none", zorder=6))
        fig.text(x + 0.016, top - height * 0.17, heading,
                 fontsize=FS_TILE_LABEL, color=color,
                 fontweight="bold", ha="left", va="center", zorder=7)

        rows = [(t, True) for t in items] + [(t, False) for t in extras]
        if not rows:
            fig.text(x + 0.016, top - height * 0.55, empty_text,
                     fontsize=FS_MOVER, color=MUTED, style="italic",
                     ha="left", va="center", zorder=7)
            continue

        for j, (track, is_verdict) in enumerate(rows):
            y = top - height * (0.38 + j * 0.21)
            name = f"{track['movement']}  {track['label']}"
            if not is_verdict:
                name += "   (within noise)"
            fig.text(x + 0.016, y, name,
                     fontsize=FS_MOVER,
                     color="white" if is_verdict else MUTED,
                     ha="left", va="center", zorder=7)
            detail = format_delta(track)
            if track.get("pctile_delta") is not None:
                detail += f"   {track['pctile_delta']:+.0f} percentile pts"
            fig.text(x + col_w - 0.016, y, detail,
                     fontsize=FS_MOVER,
                     color=color if is_verdict else MUTED,
                     ha="right", va="center", zorder=7)


def _draw_footnote(fig, session_dates: Sequence[str], cohort_note: str,
                   *, top: float) -> None:
    """Plain-language note on how to read the page."""
    lines = [
        "HOW TO READ THIS PAGE",
        "Each row is one metric. The hollow dot is where he started, the solid dot is where he is now, "
        "and the shaded bands are how our whole database is spread out on that metric.",
        "A change is only called Improved or Declined when it beats both his own trial-to-trial spread "
        "and the smallest change that matters across the population — whichever of those two is stricter. "
        "Everything else reads as Held.",
        cohort_note,
    ]

    fig.text(0.045, top, lines[0], fontsize=FS_TILE_LABEL, color="white",
             fontweight="bold", ha="left", va="top")
    y = top - 0.016
    for line in lines[1:]:
        fig.text(0.045, y, line, fontsize=FS_FOOT, color=MUTED,
                 ha="left", va="top", wrap=False)
        y -= 0.013

    # Session legend repeated at the foot of the page so the dot colors are
    # decodable without flipping back to the header.
    x = 0.045
    y -= 0.008
    for i, date_str in enumerate(session_dates):
        fig.add_artist(Circle((x, y), 0.0035, transform=fig.transFigure,
                              facecolor=SESSION_COLORS[min(i, len(SESSION_COLORS) - 1)],
                              edgecolor="white", linewidth=1.2, zorder=7))
        fig.text(x + 0.010, y, format_session_label(date_str),
                 fontsize=FS_FOOT, color=SOFT, ha="left", va="center")
        x += 0.115


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------
def summary_page(pdf, session_data: Dict[str, List], population_data: Dict,
                 athlete_name: str, session_dates: Sequence[str],
                 logo_path: Optional[str] = None,
                 header_fn=None,
                 kurtosis_ideal: Optional[Dict] = None,
                 cohort_note: str = "") -> bool:
    """Render the summary page into ``pdf``.

    Returns True when a page was written. ``header_fn`` is the shared header
    helper from ``comparison_pages`` — passed in rather than imported so this
    module stays independent of the page builders.
    """
    tracks = build_tracks(session_data, population_data, session_dates,
                          MOVEMENT_ORDER, kurtosis_ideal=kurtosis_ideal)
    if not tracks:
        print("Summary page skipped – no comparable metrics across the selected sessions.")
        return False

    if not cohort_note:
        cohort_note = ("Percentiles are against every athlete in our database who has "
                       "performed that movement, matched on gender.")

    fig = plt.figure(figsize=(54, 72), facecolor=PAGE_BG)
    fig.patch.set_facecolor(PAGE_BG)

    _draw_verdict_tiles(fig, tracks, session_dates, top=0.885, height=0.075)

    tracks_top = 0.760
    # Reserve the lower third for movers + footnote regardless of lane count.
    tracks_bottom = max(0.215, tracks_top - len(tracks) * 0.050)
    _draw_tracks(fig, tracks, session_dates, top=tracks_top, bottom=tracks_bottom)

    _draw_movers(fig, tracks, top=0.196, height=0.095)
    _draw_footnote(fig, session_dates, cohort_note, top=0.075)

    # No giant suptitle here. The movement pages centre one, but on this page
    # that lane is already occupied — the session-date swatches sit centre-left
    # and the logo sits top-right — and a 150pt title would cost the tiles
    # their room. The header plus the "WHAT CHANGED" heading name the page.
    if header_fn is not None:
        header_fn(fig, athlete_name, session_dates, logo_path,
                  name_y=0.96, dates_top_y=0.935, accent_y=0.905)

    pdf.savefig(fig, facecolor=PAGE_BG, edgecolor="none")
    plt.close(fig)
    return True
