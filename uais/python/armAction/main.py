"""
Main execution script for Action Plus movement analysis.
Now integrated with warehouse database.
"""

import os
import sys
from pathlib import Path

# Add parent directory to path for imports
python_dir = Path(__file__).parent.parent
if str(python_dir) not in sys.path:
    sys.path.insert(0, str(python_dir))

from config import APLUS_EVENTS_PATH, APLUS_DATA_PATH
from database import (
    init_temp_table, clear_temp_table,
    ingest_data, get_warehouse_connection
)
from athletes import init_athletes_db, update_athletes_summary
from reports import generate_movement_report
from common.duplicate_detector import check_and_merge_duplicates


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Action Plus movement analysis (Youth Pitch Design)")
    parser.add_argument("--dry-run", action="store_true", help="Parse and print what would be ingested; no DB writes, no report")
    args = parser.parse_args()

    print("Arm Action" + (" [DRY RUN]" if args.dry_run else ""))

    if not os.path.exists(APLUS_DATA_PATH):
        print(f"ERROR: Data file not found: {APLUS_DATA_PATH}")
        sys.exit(1)

    if not os.path.exists(APLUS_EVENTS_PATH):
        print(f"ERROR: Events file not found: {APLUS_EVENTS_PATH}")
        sys.exit(1)

    if args.dry_run:
        ingest_data(APLUS_DATA_PATH, APLUS_EVENTS_PATH, dry_run=True)
        print("Dry run complete.")
        sys.exit(0)

    # Get warehouse connection to verify it works
    try:
        conn = get_warehouse_connection()
        conn.close()
    except Exception as e:
        print(f"ERROR: Failed to connect to warehouse database: {e}")
        print("Please check your database configuration in config/db_connections.yaml")
        sys.exit(1)

    conn = get_warehouse_connection()
    try:
        init_temp_table(conn)
        clear_temp_table(conn)
    finally:
        conn.close()

    init_athletes_db()
    athlete_uuid_env = os.environ.get("ATHLETE_UUID", "").strip() or None
    print("Processing 1 file")
    processed_athlete_uuids, athlete_first_seen = ingest_data(
        APLUS_DATA_PATH, APLUS_EVENTS_PATH, athlete_uuid=athlete_uuid_env
    )

    for name, created in athlete_first_seen:
        print(f"Athlete: {name}")
        print("New athlete profile created" if created else "Successful match with athlete in DB")

    update_athletes_summary()

    if processed_athlete_uuids:
        try:
            conn = get_warehouse_connection()
            check_and_merge_duplicates(conn=conn, athlete_uuids=processed_athlete_uuids)
            conn.close()
        except Exception as e:
            print(f"Warning: Could not check for duplicates: {str(e)}")
    else:
        print("Warning: No athletes processed.")

    generate_movement_report()

    if processed_athlete_uuids:
        print("Successful run and upload.")
