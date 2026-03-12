#!/usr/bin/env python3
"""
Backfill gender in d_athletes (and any other table with a gender column).

Sets every athlete to Male except the following 11 athletes, who are set to Female:
  Aly Sauerbrei, Ariana Tiffany, Ava Tierney, Becca Little, Carley Balgowan,
  Halle Weis, Katie Scavone, Lily Davia, Sara Little, Skylar Pugh, Tiffany Ariana

Matching is by normalized_name (same logic as athlete_manager). No session.xml scanning.

Usage:
  python python/scripts/backfill_gender.py --dry-run
  python python/scripts/backfill_gender.py
"""

import argparse
import sys
from pathlib import Path

project_root = Path(__file__).resolve().parent.parent.parent
if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))

from python.common.athlete_manager import get_warehouse_connection, normalize_name_for_matching

# Exception list: these athletes are always Female (match by normalized name)
FEMALE_NAMES = [
    "Aly Sauerbrei",
    "Ariana Tiffany",
    "Ava Tierney",
    "Becca Little",
    "Carley Balgowan",
    "Halle Weis",
    "Katie Scavone",
    "Lily Davia",
    "Sara Little",
    "Skylar Pugh",
    "Tiffany Ariana",
]


def main():
    parser = argparse.ArgumentParser(
        description="Backfill gender in d_athletes: Male for all except 11 named athletes (Female)."
    )
    parser.add_argument("--dry-run", action="store_true", help="Only print what would be updated")
    args = parser.parse_args()

    female_normalized = {normalize_name_for_matching(n) for n in FEMALE_NAMES}

    conn = get_warehouse_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT athlete_uuid, name, normalized_name, gender
                FROM analytics.d_athletes
                ORDER BY normalized_name
            """)
            rows = cur.fetchall()

        if not rows:
            print("No athletes in d_athletes.")
            return

        updates = []
        for athlete_uuid, name, normalized_name, current_gender in rows:
            new_gender = "Female" if normalized_name in female_normalized else "Male"
            if current_gender != new_gender:
                updates.append((athlete_uuid, name, normalized_name, current_gender, new_gender))

        print(f"Total athletes: {len(rows)}")
        print(f"Would update:   {len(updates)}")
        if updates:
            print("\nChanges:")
            for athlete_uuid, name, normalized_name, old_val, new_val in updates[:50]:
                print(f"  {name!r} ({normalized_name})  {old_val!r} -> {new_val!r}")
            if len(updates) > 50:
                print(f"  ... and {len(updates) - 50} more")

        if not args.dry_run and updates:
            with conn.cursor() as cur:
                for athlete_uuid, _name, _norm, _old, new_gender in updates:
                    cur.execute(
                        "UPDATE analytics.d_athletes SET gender = %s WHERE athlete_uuid = %s",
                        (new_gender, athlete_uuid),
                    )
            conn.commit()
            print(f"\nUpdated {len(updates)} row(s) in analytics.d_athletes.")
        elif args.dry_run:
            print("\n[DRY RUN] No changes written.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
