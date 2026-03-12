"""
Main execution script for youth pitch design analysis.
Now integrated with warehouse database.
"""

import os
import sys
from pathlib import Path

# Add parent directory to path for imports
python_dir = Path(__file__).parent.parent
if str(python_dir) not in sys.path:
    sys.path.insert(0, str(python_dir))

from config import EVENTS_PATH
from database import (
    init_temp_table, clear_temp_table,
    ingest_pitches_with_events, get_warehouse_connection
)
from athletes import init_athletes_db, update_athletes_summary
from parsers import parse_events
from reports import generate_curve_report
from common.duplicate_detector import check_and_merge_duplicates


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Youth Pitch Design curveball analysis")
    parser.add_argument("--dry-run", action="store_true", help="Parse and print what would be ingested; no DB writes, no report")
    parser.add_argument("--report-only", action="store_true", help="Skip ingest; only generate PDF report from existing warehouse data (e.g. after fixing permission error)")
    args = parser.parse_args()

    print("Curveball Test" + (" [DRY RUN]" if args.dry_run else (" [REPORT ONLY]" if args.report_only else "")))

    if args.report_only:
        try:
            conn = get_warehouse_connection()
            conn.close()
        except Exception as e:
            print(f"ERROR: Failed to connect to warehouse database: {e}")
            sys.exit(1)
        generate_curve_report()
        print("Report complete.")
        sys.exit(0)

    if not os.path.exists(EVENTS_PATH):
        print(f"ERROR: Events file not found: {EVENTS_PATH}")
        sys.exit(1)

    events_dict = parse_events(EVENTS_PATH)

    if args.dry_run:
        ingest_pitches_with_events(events_dict, dry_run=True)
        print("Dry run complete.")
        sys.exit(0)

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
    print(f"Processing {len(events_dict)} files")
    athlete_uuid_env = os.environ.get("ATHLETE_UUID", "").strip() or None
    processed_athlete_uuids, athlete_first_seen = ingest_pitches_with_events(
        events_dict, athlete_uuid=athlete_uuid_env
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

    generate_curve_report()

    if processed_athlete_uuids:
        print("Successful run and upload.")
