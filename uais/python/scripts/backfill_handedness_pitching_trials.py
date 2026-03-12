#!/usr/bin/env python3
"""
Backfill handedness in f_pitching_trials from owner_filename.

Plan: Athletic-Screen-First. handedness ENUM (Left, Right):
- If owner_filename contains "LH" (case-insensitive) -> Left
- If owner_filename contains "RH" (case-insensitive) -> Right

Usage:
  python python/scripts/backfill_handedness_pitching_trials.py --dry-run
  python python/scripts/backfill_handedness_pitching_trials.py
"""

import argparse
import sys
from pathlib import Path

project_root = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(project_root))

from python.common.athlete_manager import get_warehouse_connection


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill handedness in f_pitching_trials from owner_filename")
    parser.add_argument("--dry-run", action="store_true", help="Do not write to DB")
    args = parser.parse_args()

    conn = get_warehouse_connection()
    try:
        with conn.cursor() as cur:
            # Left: filename contains LH (PostgreSQL enum value 'Left')
            cur.execute(
                """
                UPDATE public.f_pitching_trials
                SET handedness = 'Left'
                WHERE handedness IS NULL AND owner_filename ILIKE '%LH%'
                """
            )
            left_count = cur.rowcount
            # Right: filename contains RH
            cur.execute(
                """
                UPDATE public.f_pitching_trials
                SET handedness = 'Right'
                WHERE handedness IS NULL AND owner_filename ILIKE '%RH%'
                """
            )
            right_count = cur.rowcount
        if not args.dry_run:
            conn.commit()
            print(f"Backfill handedness: set Left={left_count}, Right={right_count}")
        else:
            print(f"[DRY RUN] Would set Left={left_count}, Right={right_count}")
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
