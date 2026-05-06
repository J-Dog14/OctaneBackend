"""
Shared constants for the athletic-screen comparison report.

Anything that more than one comparison module needs (color palette,
movement labels, max-session limit) lives here so the call sites stay tidy.
"""
from __future__ import annotations

# Maximum number of sessions the user can compare on a single report.
MAX_SESSIONS = 4

# Distinct, colorblind-friendlier palette used to identify each session.
# Order is chronological: index 0 = oldest selected session, last = newest.
SESSION_COLORS = [
    "#2c99d4",  # blue   (matches existing report accent — used for oldest session)
    "#ff8c00",  # orange
    "#2ecc71",  # green
    "#e91e63",  # magenta/pink
]

# Visual constants reused from the single-session report (kept as local
# copies so we don't have to import private styling internals).
ACCENT_COLOR = "#2c99d4"
PANEL_BG = "#373e43"   # axes background
PAGE_BG = "black"

# Population scatter color (kept as the existing accent so context reads as
# "background population" while session colors stand out).
POPULATION_COLOR = "#2c99d4"

# Movement order on the report and pretty titles.
MOVEMENT_ORDER = ["DJ", "CMJ", "PPU", "SLV"]

MOVEMENT_TITLES = {
    "DJ": "Drop\nJump",
    "CMJ": "Counter\nMovement Jump",
    "PPU": "Plyo\nPushup",
    "SLV": "Single Leg\nVertical",
}

# PostgreSQL fact-table names per movement (mirrors pdf_report.py constants).
MOVEMENT_TO_PG_TABLE = {
    "CMJ": "f_athletic_screen_cmj",
    "DJ": "f_athletic_screen_dj",
    "PPU": "f_athletic_screen_ppu",
    "SLV": "f_athletic_screen_slv",
}


def session_color(index: int) -> str:
    """Return the color for the session at chronological position ``index`` (0-based).

    Falls back to blue if more than ``MAX_SESSIONS`` are passed in (defensive).
    """
    if index < 0:
        index = 0
    if index >= len(SESSION_COLORS):
        return SESSION_COLORS[-1]
    return SESSION_COLORS[index]


def format_session_label(date_str: str) -> str:
    """Format an ISO-style date (YYYY-MM-DD) as 'MM/DD/YYYY' for legends/headers."""
    from datetime import datetime
    try:
        return datetime.strptime(str(date_str), "%Y-%m-%d").strftime("%m/%d/%Y")
    except (ValueError, TypeError):
        return str(date_str)
