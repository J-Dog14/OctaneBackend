"""
Database access for the comparison report.

We assume the data is already in the warehouse (athlete + per-session rows
in the public.f_athletic_screen_* tables). This module only reads.

Three things live here:
  - :func:`list_athletes_with_multiple_sessions` – for athlete picker
  - :func:`list_sessions_for_athlete` – for session picker
  - :func:`load_session_dataframes` – pulls per-session athlete frames
    and the population frame for each movement
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import pandas as pd
from sqlalchemy import text

# Make `common` importable when this package is invoked from the CLI entry
# point. Mirrors the path setup in the existing test scripts.
_python_dir = Path(__file__).resolve().parent.parent.parent
if str(_python_dir) not in sys.path:
    sys.path.insert(0, str(_python_dir))

# Reuse the existing population/athlete query helpers — we explicitly do NOT
# duplicate or modify pdf_report.py.
from athleticScreen.pdf_report import (  # noqa: E402
    query_athlete_data,
    query_population_data,
)
from common.config import get_warehouse_engine  # noqa: E402

from .config import MOVEMENT_TO_PG_TABLE


# ---------------------------------------------------------------------------
# Athlete + session discovery
# ---------------------------------------------------------------------------
def _all_session_dates_subquery() -> str:
    """SQL UNION across the four AS fact tables to find any session row.

    We treat *any* row in DJ/CMJ/PPU/SLV as a "session" for that athlete on
    that date. The athlete picker uses this to know who has 2+ sessions.
    """
    parts = [
        f"SELECT athlete_uuid, session_date FROM public.{tbl}"
        for tbl in MOVEMENT_TO_PG_TABLE.values()
    ]
    return " UNION ".join(parts)


def list_athletes_with_multiple_sessions(engine) -> List[Dict]:
    """Return athletes (uuid, name, session_count) who have 2+ AS sessions.

    Sorted by name (case-insensitive) for predictable presentation.
    """
    sub = _all_session_dates_subquery()
    sql = text(
        f"""
        WITH all_sessions AS ({sub})
        SELECT
            da.athlete_uuid AS athlete_uuid,
            da.name         AS name,
            COUNT(DISTINCT s.session_date) AS session_count
        FROM analytics.d_athletes da
        JOIN all_sessions s ON s.athlete_uuid = da.athlete_uuid
        GROUP BY da.athlete_uuid, da.name
        HAVING COUNT(DISTINCT s.session_date) >= 2
        ORDER BY LOWER(da.name)
        """
    )
    with engine.connect() as conn:
        rows = conn.execute(sql).fetchall()

    return [
        {
            "athlete_uuid": r[0],
            "name": r[1],
            "session_count": int(r[2]),
        }
        for r in rows
    ]


def list_sessions_for_athlete(engine, athlete_uuid: str) -> List[Dict]:
    """Return all distinct session dates for an athlete, with movement counts.

    Each entry: ``{"session_date": date, "movements": ["DJ", "CMJ", ...]}``.
    Sorted descending (newest first) — that's the order most coaches scan in.
    """
    parts = []
    for movement, table in MOVEMENT_TO_PG_TABLE.items():
        parts.append(
            f"SELECT session_date, '{movement}' AS movement "
            f"FROM public.{table} WHERE athlete_uuid = :uuid"
        )
    union_sql = " UNION ALL ".join(parts)

    sql = text(
        f"""
        SELECT session_date, movement
        FROM ({union_sql}) AS s
        ORDER BY session_date DESC, movement
        """
    )
    with engine.connect() as conn:
        rows = conn.execute(sql, {"uuid": athlete_uuid}).fetchall()

    sessions: Dict[str, List[str]] = {}
    for session_date, movement in rows:
        key = str(session_date)
        sessions.setdefault(key, [])
        if movement not in sessions[key]:
            sessions[key].append(movement)

    # Preserve descending (DESC) date ordering established by the SQL.
    out: List[Dict] = []
    for date_str, movements in sessions.items():
        out.append({"session_date": date_str, "movements": sorted(movements)})
    return out


def fetch_athlete_gender(engine, athlete_uuid: str) -> Optional[str]:
    """Look up the athlete's gender so the population set can be filtered."""
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT gender FROM analytics.d_athletes WHERE athlete_uuid = :uuid"),
            {"uuid": athlete_uuid},
        ).fetchone()
    if row:
        return row[0]
    return None


# ---------------------------------------------------------------------------
# Per-session dataframe loader
# ---------------------------------------------------------------------------
def load_session_dataframes(
    engine,
    athlete_uuid: str,
    athlete_name: str,
    session_dates: List[str],
    skip_gender_filter: bool = False,
) -> Tuple[Dict[str, List[pd.DataFrame]], Dict[str, pd.DataFrame]]:
    """Pull athlete + population data for every (movement, session) combo.

    Returns
    -------
    session_data : dict
        ``session_data[movement]`` is a list of dataframes — one per
        ``session_dates`` entry, in the SAME order. An empty dataframe is
        used when a session has no rows for that movement.
    population_data : dict
        ``population_data[movement]`` is the population dataframe (already
        filtered to the athlete's gender unless ``skip_gender_filter``).
    """
    gender = None
    if not skip_gender_filter:
        gender = fetch_athlete_gender(engine, athlete_uuid)

    session_data: Dict[str, List[pd.DataFrame]] = {}
    population_data: Dict[str, pd.DataFrame] = {}

    for movement in MOVEMENT_TO_PG_TABLE.keys():
        per_session: List[pd.DataFrame] = []
        for date_str in session_dates:
            df = query_athlete_data(engine, athlete_uuid, date_str, movement)
            if df is None:
                df = pd.DataFrame()
            if not df.empty:
                df = df.copy()
                df["name"] = athlete_name
                df["session_date"] = date_str
            per_session.append(df)
        session_data[movement] = per_session

        # Population — same gender filter as the single-session report.
        pop_df = query_population_data(engine, movement, gender=gender)
        if pop_df is None:
            pop_df = pd.DataFrame()
        population_data[movement] = pop_df

    return session_data, population_data


def all_sessions_have_data(per_session_dfs: List[pd.DataFrame]) -> bool:
    """True iff every dataframe in the list is non-empty."""
    return all(df is not None and not df.empty for df in per_session_dfs)


def get_engine():
    """Convenience wrapper used by the CLI entry point and tests."""
    return get_warehouse_engine()
