#!/usr/bin/env python3
"""
Backfill app_db_uuid on d_athletes where it is NULL.

For each warehouse athlete with app_db_uuid IS NULL, calls check_verceldb_for_uuid(normalized_name)
(which uses exact match then fuzzy similarity >= VERCELDB_FUZZY_THRESHOLD). If an app user is
found, sets app_db_uuid and app_db_synced_at.

Usage:
  python python/scripts/backfill_app_uuid_fuzzy.py --dry-run
  python python/scripts/backfill_app_uuid_fuzzy.py
"""

import argparse
import sys
from pathlib import Path

project_root = Path(__file__).resolve().parent.parent.parent
if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))

from python.common.athlete_manager import (
    get_warehouse_connection,
    check_verceldb_for_uuid,
)


def main():
    parser = argparse.ArgumentParser(
        description="Set app_db_uuid on d_athletes where NULL and fuzzy match finds app user."
    )
    parser.add_argument("--dry-run", action="store_true", help="Only print what would be updated")
    args = parser.parse_args()

    conn = get_warehouse_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT athlete_uuid, name, normalized_name
                FROM analytics.d_athletes
                WHERE app_db_uuid IS NULL
                ORDER BY created_at
            """)
            rows = cur.fetchall()

        if not rows:
            print("No athletes with app_db_uuid NULL.")
            return

        updates = []
        for row in rows:
            athlete_uuid, name, normalized_name = row[0], row[1], row[2]
            app_uuid = check_verceldb_for_uuid(normalized_name)
            if app_uuid:
                updates.append((app_uuid, athlete_uuid, name))

        if args.dry_run:
            print(f"[DRY RUN] Would set app_db_uuid for {len(updates)} athlete(s):")
            for app_uuid, athlete_uuid, name in updates:
                print(f"  {name} ({athlete_uuid}) -> app_db_uuid={app_uuid}")
            return

        with conn.cursor() as cur:
            for app_uuid, athlete_uuid, name in updates:
                cur.execute("""
                    UPDATE analytics.d_athletes
                    SET app_db_uuid = %s, app_db_synced_at = NOW(), updated_at = NOW()
                    WHERE athlete_uuid = %s
                """, (app_uuid, athlete_uuid))
                print(f"Updated {name} ({athlete_uuid}) -> app_db_uuid={app_uuid}")
        conn.commit()
        print(f"Done. Updated {len(updates)} row(s).")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
