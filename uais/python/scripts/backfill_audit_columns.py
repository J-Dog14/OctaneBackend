"""
Backfill audit trail columns on existing warehouse fact-table rows.

After running add_audit_trail_columns.sql to add source_file and upload_batch_id
to all fact tables, run this script to set 'UNKNOWN' on rows that predate the
audit trail system (so NULLs are meaningful: NULL = row was added before columns
existed, 'UNKNOWN' = columns exist but source info was unavailable).

Usage:
    cd uais && python python/scripts/backfill_audit_columns.py [--dry-run]
"""
import sys
from pathlib import Path

python_dir = Path(__file__).parent.parent
if str(python_dir) not in sys.path:
    sys.path.insert(0, str(python_dir))

import argparse
from common.athlete_manager import get_warehouse_connection

FACT_TABLES = [
    "f_athletic_screen_cmj",
    "f_athletic_screen_dj",
    "f_athletic_screen_ppu",
    "f_athletic_screen_slv",
    "f_athletic_screen_nmt",
    "f_readiness_screen",
    "f_readiness_screen_i",
    "f_readiness_screen_y",
    "f_readiness_screen_t",
    "f_readiness_screen_ir90",
    "f_readiness_screen_cmj",
    "f_readiness_screen_ppu",
    "f_pro_sup",
    "f_arm_action",
    "f_curveball_test",
    "f_mobility",
    "f_proteus",
    "f_pitching_trials",
    "f_hitting_trials",
    "f_kinematics_pitching",
    "f_kinematics_hitting",
]


def backfill_table(conn, table: str, dry_run: bool) -> int:
    """Set source_file='UNKNOWN' and upload_batch_id='UNKNOWN' on rows where both are NULL.
    Returns number of rows updated (or that would be updated in dry-run mode).
    """
    # First check that the columns exist (the migration may not have been run yet)
    with conn.cursor() as cur:
        cur.execute("""
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = %s
              AND column_name IN ('source_file', 'upload_batch_id')
        """, (table,))
        found = {row[0] for row in cur.fetchall()}

    missing = {"source_file", "upload_batch_id"} - found
    if missing:
        print(f"  SKIP {table}: columns not found ({', '.join(sorted(missing))}) — run add_audit_trail_columns.sql first")
        return 0

    # Count rows to be updated
    with conn.cursor() as cur:
        cur.execute(f"""
            SELECT COUNT(*) FROM public.{table}
            WHERE source_file IS NULL OR upload_batch_id IS NULL
        """)
        count = cur.fetchone()[0]

    if count == 0:
        print(f"  {table}: no rows to update")
        return 0

    if dry_run:
        print(f"  {table}: would update {count} row(s) [DRY RUN]")
        return count

    with conn.cursor() as cur:
        cur.execute(f"""
            UPDATE public.{table}
            SET
                source_file     = COALESCE(source_file,     'UNKNOWN'),
                upload_batch_id = COALESCE(upload_batch_id, 'UNKNOWN')
            WHERE source_file IS NULL OR upload_batch_id IS NULL
        """)
    conn.commit()
    print(f"  {table}: updated {count} row(s)")
    return count


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Backfill source_file and upload_batch_id on existing fact rows")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be updated without writing")
    args = parser.parse_args()

    print("Audit column backfill" + (" [DRY RUN]" if args.dry_run else ""))
    conn = get_warehouse_connection()
    try:
        total = 0
        for table in FACT_TABLES:
            total += backfill_table(conn, table, dry_run=args.dry_run)
        print(f"\nTotal rows {'to update' if args.dry_run else 'updated'}: {total}")
    finally:
        conn.close()
