#!/usr/bin/env python3
"""
Backfill columns lost during the db push migration.

Lost columns restored by this script:
  1. f_hitting_trials.name        -- athlete display name from analytics.d_athletes
  2. f_pitching_trials.name       -- athlete display name from analytics.d_athletes
  3. f_pitching_trials.handedness -- derived from owner_filename (LH -> Left, RH -> Right)
  4. d_athletes.has_hitting_trial_data  \\ refreshed by calling
  5. d_athletes.hitting_trial_count     /  update_athlete_data_flags()

Usage:
  python python/scripts/backfill_lost_columns.py --dry-run
  python python/scripts/backfill_lost_columns.py
"""

import argparse
import sys
from pathlib import Path

project_root = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(project_root))

from python.common.athlete_manager import get_warehouse_connection


def backfill_trial_names(cur, dry_run: bool) -> tuple[int, int]:
    """Backfill name on f_hitting_trials and f_pitching_trials from analytics.d_athletes."""
    cur.execute("""
        UPDATE public.f_hitting_trials ft
        SET name = da.name
        FROM analytics.d_athletes da
        WHERE ft.athlete_uuid = da.athlete_uuid
          AND (ft.name IS NULL OR ft.name = '')
          AND da.name IS NOT NULL
          AND da.name != ''
    """)
    hitting_count = cur.rowcount

    cur.execute("""
        UPDATE public.f_pitching_trials ft
        SET name = da.name
        FROM analytics.d_athletes da
        WHERE ft.athlete_uuid = da.athlete_uuid
          AND (ft.name IS NULL OR ft.name = '')
          AND da.name IS NOT NULL
          AND da.name != ''
    """)
    pitching_count = cur.rowcount

    return hitting_count, pitching_count


def backfill_handedness(cur, dry_run: bool) -> tuple[int, int]:
    """Backfill handedness on f_pitching_trials from owner_filename."""
    cur.execute("""
        UPDATE public.f_pitching_trials
        SET handedness = 'Left'
        WHERE handedness IS NULL
          AND owner_filename ILIKE '%LH%'
    """)
    left_count = cur.rowcount

    cur.execute("""
        UPDATE public.f_pitching_trials
        SET handedness = 'Right'
        WHERE handedness IS NULL
          AND owner_filename ILIKE '%RH%'
    """)
    right_count = cur.rowcount

    return left_count, right_count


def refresh_athlete_flags(cur) -> None:
    """Call the warehouse function to refresh all d_athletes flags and counts."""
    cur.execute("SELECT update_athlete_data_flags()")


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill columns lost during db push migration")
    parser.add_argument("--dry-run", action="store_true", help="Preview changes without writing to DB")
    args = parser.parse_args()

    conn = get_warehouse_connection()
    try:
        with conn.cursor() as cur:
            hitting_names, pitching_names = backfill_trial_names(cur, args.dry_run)
            left_hand, right_hand = backfill_handedness(cur, args.dry_run)
            if not args.dry_run:
                refresh_athlete_flags(cur)

        if not args.dry_run:
            conn.commit()
            print("Backfill complete:")
            print(f"  f_hitting_trials.name  filled: {hitting_names}")
            print(f"  f_pitching_trials.name filled: {pitching_names}")
            print(f"  f_pitching_trials.handedness  Left={left_hand}, Right={right_hand}")
            print("  d_athletes has_hitting_trial_data / hitting_trial_count -> refreshed via update_athlete_data_flags()")
        else:
            conn.rollback()
            print("[DRY RUN] Would apply:")
            print(f"  f_hitting_trials.name  rows to fill: {hitting_names}")
            print(f"  f_pitching_trials.name rows to fill: {pitching_names}")
            print(f"  f_pitching_trials.handedness  Left={left_hand}, Right={right_hand}")
            print("  d_athletes flags would be refreshed via update_athlete_data_flags()")
        return 0
    except Exception as exc:
        conn.rollback()
        print(f"[ERROR] {exc}", file=sys.stderr)
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
