#!/usr/bin/env python3
"""
Delete specific athletes and all their data (top-down: fact tables -> source_athlete_map -> d_athletes).
Matches by name: John doe, empty/null name, Sample report.
Use --dry-run to list what would be deleted.
"""

import argparse
import sys
from pathlib import Path

project_root = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(project_root))

from python.common.athlete_manager import get_warehouse_connection

# Names/patterns to delete (case-insensitive match on name; also null/empty)
# Use ILIKE so "Name:" matches "Name: " or placeholder names
DELETE_NAMES = [
    "Y/o",
]

FACT_TABLES = [
    "f_athletic_screen", "f_athletic_screen_cmj", "f_athletic_screen_dj",
    "f_athletic_screen_nmt", "f_athletic_screen_ppu", "f_athletic_screen_slv",
    "f_pro_sup", "f_readiness_screen", "f_readiness_screen_i", "f_readiness_screen_y",
    "f_readiness_screen_t", "f_readiness_screen_ir90", "f_readiness_screen_cmj", "f_readiness_screen_ppu",
    "f_mobility", "f_proteus", "f_kinematics_pitching", "f_kinematics_hitting",
    "f_pitching_trials", "f_arm_action", "f_curveball_test",
]


def find_athletes_to_delete(conn):
    """Return list of (athlete_uuid, name) for athletes we want to delete."""
    with conn.cursor() as cur:
        # Match: null/empty, or ILIKE for each pattern ("Name:" uses %Name:% to catch "Name: ")
        conditions = ["TRIM(COALESCE(name, '')) = ''", "name IS NULL"]
        params = []
        for n in DELETE_NAMES:
            n = n.strip()
            if n.lower() == "name:":
                conditions.append("name ILIKE %s")
                params.append("%Name:%")
            else:
                conditions.append("name ILIKE %s")
                params.append(n)
        where = " OR ".join(conditions)
        cur.execute(
            f"""
            SELECT athlete_uuid, name, normalized_name
            FROM analytics.d_athletes
            WHERE {where}
            """,
            params,
        )
        rows = cur.fetchall()
    return [(str(r[0]), r[1] or "(null/empty)") for r in rows]


def delete_athlete_data(conn, athlete_uuid, dry_run=False):
    """Delete all data for athlete_uuid from fact tables, source_athlete_map, then d_athletes."""
    deleted = {}
    with conn.cursor() as cur:
        for table in FACT_TABLES:
            cur.execute(
                """
                SELECT COUNT(*) FROM information_schema.columns
                WHERE table_schema = %s AND table_name = %s AND column_name = 'athlete_uuid'
                """,
                ("public", table),
            )
            if cur.fetchone()[0] == 0:
                continue
            if not dry_run:
                cur.execute("DELETE FROM public.%s WHERE athlete_uuid = %%s" % table, (athlete_uuid,))
                if cur.rowcount > 0:
                    deleted[table] = cur.rowcount
            else:
                cur.execute("SELECT COUNT(*) FROM public.%s WHERE athlete_uuid = %%s" % table, (athlete_uuid,))
                n = cur.fetchone()[0]
                if n > 0:
                    deleted[table] = n

        cur.execute("SELECT COUNT(*) FROM analytics.source_athlete_map WHERE athlete_uuid = %s", (athlete_uuid,))
        n = cur.fetchone()[0]
        if n > 0:
            deleted["analytics.source_athlete_map"] = n
        if not dry_run:
            cur.execute("DELETE FROM analytics.source_athlete_map WHERE athlete_uuid = %s", (athlete_uuid,))

        if not dry_run:
            cur.execute("DELETE FROM analytics.d_athletes WHERE athlete_uuid = %s", (athlete_uuid,))
            deleted["analytics.d_athletes"] = 1
        else:
            deleted["analytics.d_athletes"] = 1
    return deleted


def main():
    parser = argparse.ArgumentParser(description="Delete athletes by name (John doe, empty name, Sample report).")
    parser.add_argument("--dry-run", action="store_true", help="Only list athletes and row counts; no deletes")
    args = parser.parse_args()

    conn = get_warehouse_connection()
    try:
        athletes = find_athletes_to_delete(conn)
        if not athletes:
            print("No athletes found matching: John doe, empty name, or Sample report.")
            return

        print(f"Found {len(athletes)} athlete(s) to delete:")
        for uuid, name in athletes:
            print(f"  {uuid}  name={name!r}")

        if args.dry_run:
            print("\n[DRY RUN] Would delete the following:")
            for athlete_uuid, name in athletes:
                counts = delete_athlete_data(conn, athlete_uuid, dry_run=True)
                print(f"  {name}: {counts}")
            return

        for athlete_uuid, name in athletes:
            counts = delete_athlete_data(conn, athlete_uuid, dry_run=False)
            print(f"Deleted {name}: {counts}")
        conn.commit()
        print("Done.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
