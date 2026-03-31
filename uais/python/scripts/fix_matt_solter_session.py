"""
Investigation and fix script for Matt Solter's 2025-09-30 athletic screen session.

The athletic screen rows for athlete_uuid = '3d8e534a-5927-4b94-a6bc-42c93c22d284'
(Matt Solter, DOB 1993-06-04) with session_date = 2025-09-30 are believed to contain
data belonging to a different athlete. Rows were created on 2025-11-21.

This script:
  1. Shows the current athletic screen rows for Matt Solter (INSPECT)
  2. Searches for athletes created around 2025-11-21 who have no athletic screen data
     (potential real owners of those numbers)
  3. Interactively deletes the wrong rows after confirmation (FIX)
  4. Updates Matt Solter's has_athletic_screen_data flag after deletion

Usage:
    cd uais && python python/scripts/fix_matt_solter_session.py
    python python/scripts/fix_matt_solter_session.py --fix     # run the delete after confirming
    python python/scripts/fix_matt_solter_session.py --dry-run # show SQL without executing
"""
import sys
from pathlib import Path

python_dir = Path(__file__).parent.parent
if str(python_dir) not in sys.path:
    sys.path.insert(0, str(python_dir))

import argparse
from common.athlete_manager import get_warehouse_connection
from common.athlete_matcher import update_athlete_data_flag

MATT_UUID = "3d8e534a-5927-4b94-a6bc-42c93c22d284"
BAD_SESSION_DATE = "2025-09-30"

ATHLETIC_SCREEN_TABLES = [
    "f_athletic_screen_cmj",
    "f_athletic_screen_dj",
    "f_athletic_screen_ppu",
    "f_athletic_screen_slv",
    "f_athletic_screen_nmt",
]


def inspect(conn):
    print("=" * 70)
    print("STEP 1: Current athletic screen rows for Matt Solter")
    print(f"  UUID: {MATT_UUID}")
    print(f"  Session date to review: {BAD_SESSION_DATE}")
    print("=" * 70)
    for table in ATHLETIC_SCREEN_TABLES:
        with conn.cursor() as cur:
            cur.execute(f"""
                SELECT session_date, trial_name, created_at
                FROM public.{table}
                WHERE athlete_uuid = %s
                ORDER BY session_date, created_at
            """, (MATT_UUID,))
            rows = cur.fetchall()
        if rows:
            print(f"\n  {table}: {len(rows)} row(s)")
            for r in rows:
                print(f"    session_date={r[0]}  trial={r[1]}  created={r[2]}")
        else:
            print(f"\n  {table}: (no rows)")


def find_likely_owners(conn):
    print("\n" + "=" * 70)
    print("STEP 2: Athletes created around 2025-11-21 with NO athletic screen data")
    print("        (likely candidates for the real owner of the mislabelled rows)")
    print("=" * 70)
    with conn.cursor() as cur:
        cur.execute("""
            SELECT a.athlete_uuid, a.name, a.date_of_birth, a.email, a.created_at
            FROM analytics.d_athletes a
            WHERE a.created_at BETWEEN '2025-11-18' AND '2025-11-25'
              AND a.has_athletic_screen_data = FALSE
            ORDER BY a.created_at
        """)
        rows = cur.fetchall()
    if rows:
        print(f"\n  Found {len(rows)} athlete(s):")
        for r in rows:
            print(f"  - {r[1]} | uuid={r[0]} | DOB={r[2]} | email={r[3]} | created={r[4]}")
    else:
        print("\n  No athletes found in that window without athletic screen data.")
        print("  Try widening the date range manually if needed.")

    # Also show athletes WITH athletic screen data from that window (context)
    with conn.cursor() as cur:
        cur.execute("""
            SELECT a.athlete_uuid, a.name, a.date_of_birth, a.created_at
            FROM analytics.d_athletes a
            WHERE a.created_at BETWEEN '2025-11-18' AND '2025-11-25'
              AND a.has_athletic_screen_data = TRUE
              AND a.athlete_uuid != %s
            ORDER BY a.created_at
        """, (MATT_UUID,))
        others = cur.fetchall()
    if others:
        print(f"\n  Athletes WITH athletic screen data in the same window (for context):")
        for r in others:
            print(f"  - {r[1]} | uuid={r[0]} | DOB={r[2]} | created={r[3]}")


def show_performance_values(conn):
    """Show the actual performance numbers so the correct athlete can be identified."""
    print("\n" + "=" * 70)
    print(f"STEP 3: Performance numbers in Matt Solter's {BAD_SESSION_DATE} session")
    print("=" * 70)
    with conn.cursor() as cur:
        # CMJ
        cur.execute(f"""
            SELECT trial_name, "JH_IN", "Peak_Power", "PP_W_per_kg", age_at_collection
            FROM public.f_athletic_screen_cmj
            WHERE athlete_uuid = %s AND session_date = %s
            ORDER BY trial_name
        """, (MATT_UUID, BAD_SESSION_DATE))
        rows = cur.fetchall()
    if rows:
        print("\n  CMJ (jump height, peak power):")
        for r in rows:
            print(f"    trial={r[0]:20s}  JH_IN={r[1]}  Peak_Power={r[2]}  PP_W/kg={r[3]}  age={r[4]}")

    with conn.cursor() as cur:
        cur.execute(f"""
            SELECT trial_name, "Peak_Force", "Avg_Force", age_at_collection
            FROM public.f_athletic_screen_ppu
            WHERE athlete_uuid = %s AND session_date = %s
            ORDER BY trial_name
        """, (MATT_UUID, BAD_SESSION_DATE))
        rows = cur.fetchall()
    if rows:
        print("\n  Push-Up (peak force):")
        for r in rows:
            print(f"    trial={r[0]:20s}  Peak_Force={r[1]}  Avg_Force={r[2]}  age={r[3]}")


def delete_bad_rows(conn, dry_run: bool):
    print("\n" + "=" * 70)
    action = "DRY RUN — SQL that would be executed" if dry_run else "STEP 4: Deleting wrong rows"
    print(action)
    print("=" * 70)

    for table in ATHLETIC_SCREEN_TABLES:
        sql = f"""
            DELETE FROM public.{table}
            WHERE athlete_uuid = '{MATT_UUID}'
              AND session_date = '{BAD_SESSION_DATE}'
        """
        if dry_run:
            print(f"\n  Would execute:\n{sql.strip()}")
            continue

        with conn.cursor() as cur:
            cur.execute(sql)
            deleted = cur.rowcount
        conn.commit()
        print(f"  {table}: deleted {deleted} row(s)")

    if not dry_run:
        # Re-check whether Matt Solter has any remaining athletic screen data
        has_any = False
        for table in ATHLETIC_SCREEN_TABLES:
            with conn.cursor() as cur:
                cur.execute(f"""
                    SELECT 1 FROM public.{table} WHERE athlete_uuid = %s LIMIT 1
                """, (MATT_UUID,))
                if cur.fetchone():
                    has_any = True
                    break

        print(f"\n  Matt Solter remaining athletic screen rows: {'YES' if has_any else 'NONE'}")
        update_athlete_data_flag(conn, MATT_UUID, "athletic_screen", has_data=has_any)
        print(f"  has_athletic_screen_data flag updated to: {has_any}")
        print("\nDone. Run audit_data_integrity.py to verify the fix.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Investigate and fix Matt Solter's mislabelled athletic screen session")
    parser.add_argument("--fix", action="store_true", help="Execute the DELETE after interactive confirmation")
    parser.add_argument("--dry-run", action="store_true", help="Show DELETE SQL without executing")
    args = parser.parse_args()

    conn = get_warehouse_connection()
    try:
        inspect(conn)
        find_likely_owners(conn)
        try:
            show_performance_values(conn)
        except Exception as e:
            print(f"\n  (Could not fetch performance detail — column names may differ: {e})")

        if args.fix:
            print(f"\nAbout to DELETE all athletic screen rows for Matt Solter on {BAD_SESSION_DATE}.")
            print("Type 'yes' to confirm, anything else to abort: ", end="", flush=True)
            response = input().strip().lower()
            if response == "yes":
                delete_bad_rows(conn, dry_run=False)
            else:
                print("Aborted — no rows deleted.")
        elif args.dry_run:
            delete_bad_rows(conn, dry_run=True)
        else:
            print("\nRun with --fix to delete the rows, or --dry-run to preview the SQL.")
    finally:
        conn.close()
