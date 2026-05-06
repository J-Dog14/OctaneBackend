"""
Top-level PDF assembler for the multi-session comparison report.

Public entry point: :func:`create_comparison_pdf`.

Given an athlete UUID + display name and an ordered list of 2-4 session
dates, this loads the data and writes a multi-page PDF with one page per
movement (DJ → CMJ → PPU → SLV) using the page builders in
``comparison_pages``.

Per the user's setup, movements where any of the selected sessions has no
data are skipped entirely (apples-to-apples comparison).
"""
from __future__ import annotations

import os
import shutil
import sys
import tempfile
from datetime import datetime
from pathlib import Path
from typing import List, Optional

from matplotlib.backends.backend_pdf import PdfPages

_python_dir = Path(__file__).resolve().parent.parent.parent
if str(_python_dir) not in sys.path:
    sys.path.insert(0, str(_python_dir))

from .comparison_pages import PAGE_RENDERERS
from .config import MAX_SESSIONS, MOVEMENT_ORDER
from .data_loader import (
    all_sessions_have_data,
    get_engine,
    load_session_dataframes,
)


def _default_logo_path() -> Optional[str]:
    """Return the path to the existing 8ctane logo if it exists, else None."""
    candidate = Path(__file__).resolve().parent.parent / "8ctnae - Faded 8 to Blue.png"
    return str(candidate) if candidate.exists() else None


def _default_filename(athlete_name: str, session_dates: List[str]) -> str:
    """Build a self-describing default output file name.

    Example: ``Riley_Cuddy_comparison_2025-09-01_to_2026-03-25.pdf``
    """
    clean = athlete_name.replace(" ", "_").replace(",", "")
    if not session_dates:
        return f"{clean}_comparison.pdf"
    return f"{clean}_comparison_{session_dates[0]}_to_{session_dates[-1]}.pdf"


def create_comparison_pdf(
    athlete_uuid: str,
    athlete_name: str,
    session_dates: List[str],
    output_dir: str,
    logo_path: Optional[str] = None,
    power_files_dir: Optional[str] = None,
    skip_gender_filter: bool = False,
    engine=None,
    output_filename: Optional[str] = None,
) -> Optional[str]:
    """Generate a comparison PDF for one athlete across 2-4 sessions.

    Parameters
    ----------
    athlete_uuid : str
        UUID from ``analytics.d_athletes``.
    athlete_name : str
        Pretty display name (used in the header and the filename).
    session_dates : list[str]
        ISO ``YYYY-MM-DD`` strings, oldest → newest. Length 2-4.
    output_dir : str
        Folder to write the PDF into; created if it doesn't exist.
    logo_path : str, optional
        Path to the 8ctane logo. Defaults to the shared logo file in the
        ``athleticScreen`` folder.
    power_files_dir : str, optional
        Base folder for ``Power.txt`` files (passed through to the curve
        plotter). When ``None`` the curves are synthesized.
    skip_gender_filter : bool
        If True, compare against the full population regardless of gender.
    engine : SQLAlchemy engine, optional
        Pre-built engine; if omitted, a fresh one is created.
    output_filename : str, optional
        Override the auto-built file name (without directory).

    Returns
    -------
    str | None
        The path the PDF was written to, or None if no pages had any data.
    """
    if not (2 <= len(session_dates) <= MAX_SESSIONS):
        raise ValueError(
            f"session_dates must contain 2 to {MAX_SESSIONS} dates "
            f"(got {len(session_dates)})"
        )

    # Normalize dates to ISO strings, sorted oldest → newest.
    iso_dates = []
    for d in session_dates:
        if isinstance(d, datetime):
            iso_dates.append(d.strftime("%Y-%m-%d"))
        else:
            iso_dates.append(str(d))
    iso_dates = sorted(iso_dates)

    if engine is None:
        engine = get_engine()

    if logo_path is None:
        logo_path = _default_logo_path()

    os.makedirs(output_dir, exist_ok=True)

    filename = output_filename or _default_filename(athlete_name, iso_dates)
    output_pdf = os.path.join(output_dir, filename)

    # Load athlete + population data for all movements.
    session_data, population_data = load_session_dataframes(
        engine, athlete_uuid, athlete_name, iso_dates,
        skip_gender_filter=skip_gender_filter,
    )

    # Write the PDF to a temp file first if we're targeting a Drive folder.
    use_temp = ("My Drive" in output_dir) or ("Google Drive" in output_dir)
    target_pdf = (os.path.join(tempfile.gettempdir(), os.path.basename(output_pdf))
                  if use_temp else output_pdf)

    rendered_any_page = False
    with PdfPages(target_pdf) as pdf:
        for movement in MOVEMENT_ORDER:
            per_session_dfs = session_data.get(movement, [])
            pop_df = population_data.get(movement)
            if pop_df is None or pop_df.empty:
                print(f"Skipping {movement} – no population data.")
                continue
            if not per_session_dfs or len(per_session_dfs) != len(iso_dates):
                print(f"Skipping {movement} – missing session data.")
                continue
            # Skip the movement if any session lacks data (apples-to-apples).
            if not all_sessions_have_data(per_session_dfs):
                missing = [
                    iso_dates[i] for i, df in enumerate(per_session_dfs)
                    if df is None or df.empty
                ]
                print(f"Skipping {movement} – session(s) with no data: {missing}")
                continue

            renderer = PAGE_RENDERERS.get(movement)
            if renderer is None:
                continue

            renderer(pdf, per_session_dfs, pop_df,
                     athlete_name=athlete_name,
                     session_dates=iso_dates,
                     logo_path=logo_path,
                     power_files_dir=power_files_dir)
            rendered_any_page = True

    if not rendered_any_page:
        # PdfPages will create an empty file; remove it so the caller can
        # tell we produced nothing.
        if os.path.exists(target_pdf):
            os.remove(target_pdf)
        print("No pages rendered – check that the athlete has data for the selected sessions.")
        return None

    if use_temp:
        if os.path.exists(output_pdf):
            os.remove(output_pdf)
        shutil.move(target_pdf, output_pdf)

    return output_pdf
