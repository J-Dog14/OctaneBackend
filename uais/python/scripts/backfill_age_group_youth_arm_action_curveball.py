#!/usr/bin/env python3
"""
Backfill age_group = 'YOUTH' in d_athletes for athletes who have no DOB but have
arm_action or curveball_test data (default for Youth Pitch Design sources).

Only updates rows where date_of_birth IS NULL and age_group IS NULL and
(has_arm_action_data = true OR has_curveball_test_data = true).

Usage:
  python python/scripts/backfill_age_group_youth_arm_action_curveball.py --dry-run
  python python/scripts/backfill_age_group_youth_arm_action_curveball.py
"""

import argparse
import sys
from pathlib import Path

project_root = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(project_root))

from python.common.athlete_manager import get_warehouse_connection


def main():
    parser = argparse.ArgumentParser(
        description="Set age_group = YOUTH for d_athletes with no DOB but with arm_action or curveball_test data"
    )
    parser.add_argument("--dry-run", action="store_true", help="Only print what would be updated")
    args = parser.parse_args()

    conn = get_warehouse_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT athlete_uuid, name, has_arm_action_data, has_curveball_test_data
                FROM analytics.d_athletes
                WHERE date_of_birth IS NULL
                  AND (age_group IS NULL OR age_group = '')
                  AND (has_arm_action_data = true OR has_curveball_test_data = true)
                ORDER BY name
            """)
            rows = cur.fetchall()

        if not rows:
            print("No athletes with NULL DOB and arm_action/curveball_test data need age_group update.")
            return

        print(f"Found {len(rows)} athlete(s) with NULL DOB and arm_action/curveball_test data (age_group will be set to YOUTH):\n")
        for athlete_uuid, name, has_arm, has_curve in rows:
            sources = []
            if has_arm:
                sources.append("arm_action")
            if has_curve:
                sources.append("curveball_test")
            print(f"  {name}  ({', '.join(sources)})")

        if args.dry_run:
            print(f"\n[DRY RUN] Would set age_group = 'YOUTH' for {len(rows)} row(s). Run without --dry-run to apply.")
            return

        with conn.cursor() as cur:
            cur.execute("""
                UPDATE analytics.d_athletes
                SET age_group = 'YOUTH'
                WHERE date_of_birth IS NULL
                  AND (age_group IS NULL OR age_group = '')
                  AND (has_arm_action_data = true OR has_curveball_test_data = true)
            """)
            updated = cur.rowcount
        conn.commit()
        print(f"\nUpdated age_group to YOUTH for {updated} athlete(s).")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
