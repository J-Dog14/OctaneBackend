#!/usr/bin/env python3
"""
Backfill date_of_birth in d_athletes from session.xml using file paths already in the DB.

For athletes with date_of_birth IS NULL, looks up one filename from f_arm_action or
f_curveball_test, finds session.xml in that file's directory, parses DOB, and updates
d_athletes. Use this when intake ran but session.xml wasn't found (e.g. different
field name) or to fix existing rows without re-ingesting.

Usage:
  python python/scripts/backfill_dob_from_session_xml.py --dry-run
  python python/scripts/backfill_dob_from_session_xml.py
"""

import argparse
import sys
from pathlib import Path

project_root = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(project_root))

from python.common.athlete_manager import get_warehouse_connection
from python.common.session_xml import get_dob_from_session_xml_next_to_file


def main():
    parser = argparse.ArgumentParser(description="Backfill d_athletes.date_of_birth from session.xml using paths in f_arm_action / f_curveball_test")
    parser.add_argument("--dry-run", action="store_true", help="Only print what would be updated")
    args = parser.parse_args()

    conn = get_warehouse_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT a.athlete_uuid, a.name, a.normalized_name
                FROM analytics.d_athletes a
                WHERE a.date_of_birth IS NULL
                ORDER BY a.name
            """)
            athletes = cur.fetchall()

        if not athletes:
            print("No athletes with NULL date_of_birth.")
            return

        print(f"Found {len(athletes)} athlete(s) with NULL date_of_birth. Checking session.xml from DB file paths...\n")

        updated = 0
        for athlete_uuid, name, normalized_name in athletes:
            # Get one filename from f_arm_action or f_curveball_test for this athlete
            with conn.cursor() as cur:
                cur.execute("""
                    (SELECT filename FROM public.f_arm_action WHERE athlete_uuid = %s AND filename IS NOT NULL AND filename != '' LIMIT 1)
                    UNION ALL
                    (SELECT filename FROM public.f_curveball_test WHERE athlete_uuid = %s AND filename IS NOT NULL AND filename != '' LIMIT 1)
                """, (athlete_uuid, athlete_uuid))
                row = cur.fetchone()
            if not row or not row[0]:
                print(f"  Skip {name}: no file path in f_arm_action or f_curveball_test")
                continue

            file_path = row[0]
            dob = get_dob_from_session_xml_next_to_file(file_path)
            if not dob:
                print(f"  Skip {name}: no DOB in session.xml next to {Path(file_path).name}")
                continue

            print(f"  {name}: DOB {dob} from {Path(file_path).parent / 'session.xml'}")

            if not args.dry_run:
                with conn.cursor() as cur:
                    cur.execute(
                        "UPDATE analytics.d_athletes SET date_of_birth = %s WHERE athlete_uuid = %s",
                        (dob, athlete_uuid),
                    )
                conn.commit()
                updated += 1
            else:
                updated += 1

        print(f"\n{'Would update' if args.dry_run else 'Updated'} {updated} athlete(s).")
        if args.dry_run and updated:
            print("Run without --dry-run to apply.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
