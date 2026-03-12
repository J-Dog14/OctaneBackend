#!/usr/bin/env python3
"""
One-time backfill of email into d_athletes from app/verceldb User table where applicable.

For each d_athletes row with app_db_uuid set, look up the User by uuid and set
d_athletes.email = normalized(User.email) if the User table has an email column.

Usage:
  python python/scripts/backfill_email_d_athletes.py --dry-run
  python python/scripts/backfill_email_d_athletes.py
"""

import argparse
import sys
from pathlib import Path

project_root = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(project_root))

from python.common.athlete_manager import (
    get_verceldb_connection,
    get_warehouse_connection,
    normalize_email,
)


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill email in d_athletes from app User table")
    parser.add_argument("--dry-run", action="store_true", help="Do not write to warehouse")
    args = parser.parse_args()

    try:
        app_conn = get_verceldb_connection()
    except Exception as e:
        print(f"Could not connect to app/verceldb: {e}")
        return 1

    try:
        with app_conn.cursor() as cur:
            cur.execute("""
                SELECT column_name FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'User' AND column_name = 'email'
            """)
            if not cur.fetchone():
                print("App User table has no 'email' column; skipping backfill.")
                app_conn.close()
                return 0
            cur.execute('SELECT uuid, email FROM public."User" WHERE email IS NOT NULL AND TRIM(email) != \'\'')
            rows = cur.fetchall()
    finally:
        app_conn.close()

    if not rows:
        print("No users with email found in app.")
        return 0

    wh_conn = get_warehouse_connection()
    updated = 0
    try:
        for (uuid_val, email_raw) in rows:
            email_norm = normalize_email(email_raw)
            if not email_norm:
                continue
            with wh_conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE analytics.d_athletes
                    SET email = %s
                    WHERE app_db_uuid = %s AND (email IS NULL OR email != %s)
                    """,
                    (email_norm, str(uuid_val), email_norm),
                )
                updated += cur.rowcount
        if not args.dry_run:
            wh_conn.commit()
            print(f"Backfill email: updated {updated} row(s) from app User.")
        else:
            print(f"[DRY RUN] Would update {updated} row(s)")
    finally:
        wh_conn.close()

    return 0


if __name__ == "__main__":
    sys.exit(main())
