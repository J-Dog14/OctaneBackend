#!/usr/bin/env python3
"""
Delete Static trials from public.f_pitching_trials.

By default deletes rows where owner_filename is exactly 'Static' OR starts with 'Static '.
Use --exact-only to delete only exact 'Static'.

Usage:
  python python/scripts/delete_static_pitching_trials.py
  python python/scripts/delete_static_pitching_trials.py --exact-only
"""

import argparse
import sys
from pathlib import Path

project_root = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(project_root))

from python.common.athlete_manager import get_warehouse_connection


def main() -> int:
    parser = argparse.ArgumentParser(description="Delete Static trials from f_pitching_trials")
    parser.add_argument("--exact-only", action="store_true", help="Only delete rows where owner_filename = 'Static'")
    args = parser.parse_args()

    conn = get_warehouse_connection()
    try:
        with conn.cursor() as cur:
            if args.exact_only:
                cur.execute("DELETE FROM public.f_pitching_trials WHERE owner_filename = 'Static'")
            else:
                cur.execute(
                    "DELETE FROM public.f_pitching_trials "
                    "WHERE owner_filename = 'Static' OR owner_filename ILIKE 'Static %'"
                )
            deleted = cur.rowcount
        conn.commit()
        print(f"Deleted {deleted} Static trial row(s) from public.f_pitching_trials")
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

