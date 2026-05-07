"""
Athletic-Screen Comparison Report — main entry point.

Run this script to generate a multi-session comparison PDF for one athlete.

It assumes the athletic-screen data is already loaded in the warehouse
(public.f_athletic_screen_dj / cmj / ppu / slv) — this script only reads.

Workflow
--------
1. Lists athletes who have 2+ sessions (filterable by name fragment).
2. Lists that athlete's session dates so you can pick 2-4 to compare.
3. Pulls per-session data + population data, and writes a PDF that
   mirrors the look of the single-session report
   (`pdf_report.generate_pdf_report`) with one page per movement.

Configuration
-------------
Output folder + (optional) Power.txt directory are defined at the top of
``main()``. Edit them in place if you want a different default.

CLI usage
---------
    python create_comparison_report.py
"""
from __future__ import annotations

import os
import sys
import traceback
from pathlib import Path

# Make ``common`` importable when running this file directly.
_python_dir = Path(__file__).resolve().parent.parent
if str(_python_dir) not in sys.path:
    sys.path.insert(0, str(_python_dir))

from athleticScreen.comparison_report.athlete_selector import (
    prompt_for_athlete,
    prompt_for_sessions,
)
from athleticScreen.comparison_report.comparison_pdf import create_comparison_pdf
from athleticScreen.comparison_report.data_loader import get_engine
from athleticScreen.comparison_report.config import format_session_label


# ---------------------------------------------------------------------------
# Configuration — edit these to point at your environment
# ---------------------------------------------------------------------------
DEFAULT_OUTPUT_DIR = r"D:\Athletic Screen 2.0\Reports"

# Where Power.txt files live, if any. ``None`` means the power curve will
# be synthesized (matches the existing report's fallback behavior).
DEFAULT_POWER_FILES_DIR: str | None = None
# Example: r"D:\Athletic Screen 2.0\Output Files"

# Set True to compare against the full population regardless of gender.
SKIP_GENDER_FILTER = False


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> int:
    print("=" * 60)
    print("Athletic Screen — Comparison Report")
    print("=" * 60)

    try:
        engine = get_engine()
    except Exception as exc:  # pragma: no cover - environmental
        print(f"ERROR: Could not connect to warehouse: {exc}")
        traceback.print_exc()
        return 1

    try:
        athlete = prompt_for_athlete(engine)
        if not athlete:
            print("Cancelled.")
            return 0

        session_dates = prompt_for_sessions(engine, athlete)
        if not session_dates:
            print("Cancelled.")
            return 0

        print()
        print("-" * 60)
        print(f"Athlete : {athlete['name']}")
        print(f"UUID    : {athlete['athlete_uuid']}")
        print("Sessions:")
        for d in session_dates:
            print(f"  • {format_session_label(d)}")
        print(f"Output  : {DEFAULT_OUTPUT_DIR}")
        print("-" * 60)
        print("Generating PDF...")

        output_path = create_comparison_pdf(
            athlete_uuid=athlete["athlete_uuid"],
            athlete_name=athlete["name"],
            session_dates=session_dates,
            output_dir=DEFAULT_OUTPUT_DIR,
            power_files_dir=DEFAULT_POWER_FILES_DIR,
            skip_gender_filter=SKIP_GENDER_FILTER,
            engine=engine,
        )

        if output_path and os.path.exists(output_path):
            print()
            print(f"✓ Comparison report written: {output_path}")
            return 0

        print("\n✗ No PDF produced — see warnings above.")
        return 2

    except KeyboardInterrupt:
        print("\nInterrupted.")
        return 130
    except Exception as exc:  # pragma: no cover - top-level safety
        print(f"\nERROR: {exc}")
        traceback.print_exc()
        return 1
    finally:
        try:
            engine.dispose()
        except Exception:
            pass


if __name__ == "__main__":
    sys.exit(main())
