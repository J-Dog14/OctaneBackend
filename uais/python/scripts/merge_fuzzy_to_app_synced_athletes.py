#!/usr/bin/env python3
"""
Merge warehouse athletes that have no app_db_uuid into an app-synced athlete when names fuzzy-match.

Finds pairs (A, B) where A.app_db_uuid IS NULL, B.app_db_uuid IS NOT NULL, and
similarity(A.normalized_name, B.normalized_name) >= 0.90. Merges A into B (moves fact data,
source_athlete_map, deletes A). Keeps B's name.

Usage:
  python python/scripts/merge_fuzzy_to_app_synced_athletes.py --dry-run
  python python/scripts/merge_fuzzy_to_app_synced_athletes.py
"""

import argparse
import sys
from pathlib import Path
from difflib import SequenceMatcher

project_root = Path(__file__).resolve().parent.parent.parent
if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))

from python.common.athlete_manager import (
    get_warehouse_connection,
    _merge_athlete_into_canonical,
    update_athlete_flags,
    NAME_SIMILARITY_THRESHOLD,
)
from psycopg2.extras import RealDictCursor


def similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, (a or "").upper(), (b or "").upper()).ratio()


def main():
    parser = argparse.ArgumentParser(
        description="Merge athletes without app_db_uuid into app-synced athlete when names fuzzy-match."
    )
    parser.add_argument("--dry-run", action="store_true", help="Only print pairs; no merges")
    parser.add_argument(
        "--threshold",
        type=float,
        default=NAME_SIMILARITY_THRESHOLD,
        help=f"Min similarity to merge (default: {NAME_SIMILARITY_THRESHOLD})",
    )
    args = parser.parse_args()

    conn = get_warehouse_connection()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT athlete_uuid, name, normalized_name
                FROM analytics.d_athletes
                WHERE app_db_uuid IS NULL
            """)
            without_app = [dict(r) for r in cur.fetchall()]
            cur.execute("""
                SELECT athlete_uuid, name, normalized_name
                FROM analytics.d_athletes
                WHERE app_db_uuid IS NOT NULL
            """)
            with_app = [dict(r) for r in cur.fetchall()]

        if not without_app or not with_app:
            print("No pairs to consider (need both athletes with and without app_db_uuid).")
            return

        # For each without-app, find best with-app match above threshold
        pairs = []
        for a in without_app:
            best_b = None
            best_ratio = 0.0
            a_norm = (a.get("normalized_name") or "").strip()
            if not a_norm:
                continue
            for b in with_app:
                b_norm = (b.get("normalized_name") or "").strip()
                if not b_norm:
                    continue
                r = similarity(a_norm, b_norm)
                if r >= args.threshold and r > best_ratio:
                    best_ratio = r
                    best_b = b
            if best_b:
                pairs.append((a, best_b, best_ratio))

        if not pairs:
            print("No fuzzy pairs found above threshold.")
            return

        if args.dry_run:
            print(f"[DRY RUN] Would merge {len(pairs)} pair(s) (threshold={args.threshold}):")
            for a, b, r in pairs:
                print(f"  {a['name']} ({a['athlete_uuid']}) -> {b['name']} ({b['athlete_uuid']}) ratio={r:.2f}")
            return

        merged = 0
        for a, b, r in pairs:
            source_uuid = str(a["athlete_uuid"])
            target_uuid = str(b["athlete_uuid"])
            print(f"Merging {a['name']} into {b['name']} (ratio={r:.2f})")
            _merge_athlete_into_canonical(source_uuid, target_uuid, conn)
            merged += 1
        conn.commit()
        print(f"Done. Merged {merged} athlete(s).")
        print("Updating athlete flags...")
        update_athlete_flags(conn=conn, verbose=False)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
