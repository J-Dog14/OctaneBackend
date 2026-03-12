#!/usr/bin/env python3
"""
Backfill audit for height/weight in d_athletes. Ensures all values are in inches and pounds.

Rules:
  1. Height <= 3: treat as meters -> convert to inches (height * 39.3701); assume weight is kg -> convert to lbs (weight * 2.2046226).
  2. Height in [3.5, 7] (feet-only, inches clipped): look up from f_pitching_trials, f_hitting_trials, f_pro_sup; if found use that; else set height (and weight) to NULL.
  3. All other heights: leave unchanged.

After updating d_athletes, propagates new height/weight to f_pitching_trials, f_hitting_trials, f_pro_sup for each changed athlete.

Usage:
  python python/scripts/backfill_height_weight_audit.py --dry-run
  python python/scripts/backfill_height_weight_audit.py --dry-run --limit 20
  python python/scripts/backfill_height_weight_audit.py
"""

import argparse
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

project_root = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(project_root))

from psycopg2.extras import RealDictCursor

from python.common.athlete_manager import get_warehouse_connection
from python.common.units import METERS_TO_INCHES, KG_TO_LBS

# Thresholds from plan
HEIGHT_METERS_MAX = 3.0  # heights <= this are treated as meters
FEET_ONLY_MIN = 3.5
FEET_ONLY_MAX = 7.0

FACT_TABLES_WITH_HEIGHT_WEIGHT = ["f_pitching_trials", "f_hitting_trials", "f_pro_sup"]


def _float(val: Any) -> Optional[float]:
    if val is None:
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def _table_has_height_weight(conn, schema: str, table: str) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = %s AND table_name = %s
              AND column_name IN ('height', 'weight')
            LIMIT 1
            """,
            (schema, table),
        )
        return cur.fetchone() is not None


def _get_best_height_weight_from_fact_tables(conn, athlete_uuid: str) -> Tuple[Optional[float], Optional[float]]:
    """Return (height_in, weight_lb) from the first fact table that has non-NULL values for this athlete."""
    for table in FACT_TABLES_WITH_HEIGHT_WEIGHT:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT height, weight FROM public.{table}
                WHERE athlete_uuid = %s AND (height IS NOT NULL OR weight IS NOT NULL)
                ORDER BY session_date DESC NULLS LAST
                LIMIT 1
                """,
                (athlete_uuid,),
            )
            row = cur.fetchone()
        if row and (row[0] is not None or row[1] is not None):
            return (_float(row[0]), _float(row[1]))
    return (None, None)


def main():
    parser = argparse.ArgumentParser(
        description="Audit and backfill d_athletes height/weight (inches and lbs); propagate to fact tables."
    )
    parser.add_argument("--dry-run", action="store_true", help="Only report changes, do not write")
    parser.add_argument("--limit", type=int, default=0, help="Max number of athletes to process (0 = no limit)")
    args = parser.parse_args()

    conn = get_warehouse_connection()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT athlete_uuid, name, normalized_name, height, weight
                FROM analytics.d_athletes
                WHERE height IS NOT NULL OR weight IS NOT NULL
                ORDER BY normalized_name
                """
            )
            athletes = cur.fetchall()

        if not athletes:
            print("No athletes with height or weight in d_athletes.")
            return

        if args.limit > 0:
            athletes = athletes[: args.limit]
            print(f"Limiting to first {args.limit} athletes.")

        changes: List[Dict[str, Any]] = []
        reason_meters = 0
        reason_feet_only_filled = 0
        reason_feet_only_null = 0

        for a in athletes:
            athlete_uuid = a["athlete_uuid"]
            old_h = _float(a.get("height"))
            old_w = _float(a.get("weight"))
            new_h: Optional[float] = None
            new_w: Optional[float] = None
            reason = ""

            # Rule 1: height <= 3 -> treat as meters (and weight as kg)
            if old_h is not None and old_h <= HEIGHT_METERS_MAX:
                new_h = old_h * METERS_TO_INCHES
                new_w = (old_w * KG_TO_LBS) if old_w is not None else None
                reason = "height_meters"
            # Rule 2: height in feet-only range
            elif old_h is not None and FEET_ONLY_MIN <= old_h <= FEET_ONLY_MAX:
                ref_h, ref_w = _get_best_height_weight_from_fact_tables(conn, athlete_uuid)
                if ref_h is not None or ref_w is not None:
                    new_h = ref_h
                    new_w = ref_w
                    reason = "feet_only_from_fact"
                else:
                    new_h = None
                    new_w = None
                    reason = "feet_only_null"
            else:
                continue

            if (new_h != old_h) or (new_w != old_w):
                if reason == "height_meters":
                    reason_meters += 1
                elif reason == "feet_only_from_fact":
                    reason_feet_only_filled += 1
                else:
                    reason_feet_only_null += 1
                changes.append({
                    "athlete_uuid": athlete_uuid,
                    "name": a.get("name"),
                    "old_height": old_h,
                    "old_weight": old_w,
                    "new_height": new_h,
                    "new_weight": new_w,
                    "reason": reason,
                })

        print(f"Total athletes with height/weight: {len(athletes)}")
        print(f"Changes to apply: {len(changes)}")
        print(f"  From meters (rule 1): {reason_meters}")
        print(f"  Feet-only filled from fact: {reason_feet_only_filled}")
        print(f"  Feet-only set to NULL: {reason_feet_only_null}")
        if changes:
            print("\nSample changes:")
            for c in changes[:25]:
                print(
                    f"  {c['name']!r} | height {c['old_height']} -> {c['new_height']} | "
                    f"weight {c['old_weight']} -> {c['new_weight']} | {c['reason']}"
                )
            if len(changes) > 25:
                print(f"  ... and {len(changes) - 25} more")

        if not args.dry_run and changes:
            for c in changes:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        UPDATE analytics.d_athletes
                        SET height = %s, weight = %s, updated_at = NOW()
                        WHERE athlete_uuid = %s
                        """,
                        (c["new_height"], c["new_weight"], c["athlete_uuid"]),
                    )
                # Propagate to fact tables
                for table in FACT_TABLES_WITH_HEIGHT_WEIGHT:
                    if not _table_has_height_weight(conn, "public", table):
                        continue
                    try:
                        with conn.cursor() as cur:
                            cur.execute(
                                f"""
                                UPDATE public.{table}
                                SET height = %s, weight = %s
                                WHERE athlete_uuid = %s
                                """,
                                (c["new_height"], c["new_weight"], c["athlete_uuid"]),
                            )
                    except Exception as e:
                        print(f"  Warning: update {table} for {c['athlete_uuid']}: {e}")
            conn.commit()
            print(f"\nUpdated {len(changes)} athlete(s) in d_athletes and propagated to fact tables.")
        elif args.dry_run and changes:
            print("\n[DRY RUN] No changes written.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
