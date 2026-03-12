#!/usr/bin/env python3
"""
One-time sync: set f_pro_sup height and weight from d_athletes for every row.

d_athletes is the source of truth (imperial after height/weight audit). Pro Sup
was sometimes populated with metric or mixed values at insert time. This script
overwrites f_pro_sup.height and f_pro_sup.weight with the athlete's current
d_athletes values so the table is consistently imperial.

Usage:
  python python/scripts/sync_f_pro_sup_height_weight_from_d_athletes.py --dry-run
  python python/scripts/sync_f_pro_sup_height_weight_from_d_athletes.py
"""

import argparse
import sys
from pathlib import Path

project_root = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(project_root))

from python.common.athlete_manager import get_warehouse_connection


def main():
    parser = argparse.ArgumentParser(
        description="Set f_pro_sup height/weight from d_athletes (imperial source of truth)."
    )
    parser.add_argument("--dry-run", action="store_true", help="Only report row count, do not UPDATE")
    args = parser.parse_args()

    conn = get_warehouse_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE public.f_pro_sup ps
                SET height = a.height, weight = a.weight
                FROM analytics.d_athletes a
                WHERE ps.athlete_uuid = a.athlete_uuid
                  AND (a.height IS NOT NULL OR a.weight IS NOT NULL)
                """
            )
            updated = cur.rowcount
        if not args.dry_run:
            conn.commit()
            print(f"Updated {updated} row(s) in f_pro_sup from d_athletes.")
        else:
            print(f"[DRY RUN] Would update {updated} row(s) in f_pro_sup from d_athletes.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
