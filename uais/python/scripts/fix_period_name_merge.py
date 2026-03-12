#!/usr/bin/env python3
"""
Merge "Last. First" athlete row(s) into the canonical "First Last" row in d_athletes.

Usage:
    python python/scripts/fix_period_name_merge.py "Carter Duty"
    python python/scripts/fix_period_name_merge.py "Connor Tack"

Finds all rows that match the person (canonical normalized_name or "LAST. FIRST" variant),
merges any variant rows into the canonical one, and ensures the canonical row has
the cleaned display name.
"""
import sys
from pathlib import Path

project_root = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(project_root))

from psycopg2.extras import RealDictCursor

from python.common.athlete_manager import (
    get_warehouse_connection,
    _merge_athlete_into_canonical,
)
from python.common.athlete_cleanup import clean_athlete_name_for_processing


def main():
    if len(sys.argv) < 2:
        print("Usage: python fix_period_name_merge.py \"First Last\"")
        sys.exit(1)
    canonical_display = sys.argv[1].strip()
    if not canonical_display:
        print("Usage: python fix_period_name_merge.py \"First Last\"")
        sys.exit(1)

    display_name, canonical_nn = clean_athlete_name_for_processing(canonical_display)
    # "Last. First" in DB is typically stored as normalized "LAST. FIRST"
    parts = canonical_nn.split()
    if len(parts) == 2:
        period_variant_nn = f"{parts[1]}. {parts[0]}"  # DUTY. CARTER
    else:
        period_variant_nn = None

    conn = get_warehouse_connection()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            variants = [canonical_nn]
            if period_variant_nn:
                variants.append(period_variant_nn)
            placeholders = ",".join(["%s"] * len(variants))
            cur.execute(
                f"""
                SELECT athlete_uuid, name, normalized_name
                FROM analytics.d_athletes
                WHERE normalized_name IN ({placeholders})
                ORDER BY normalized_name
                """,
                tuple(variants),
            )
            rows = cur.fetchall()

        if not rows:
            print(f"No rows found for {canonical_display!r} (normalized: {canonical_nn!r}).")
            return

        print(f"Found {len(rows)} row(s) for {canonical_display!r}:")
        for r in rows:
            print(f"  {r['athlete_uuid']}  name={r['name']!r}  normalized_name={r['normalized_name']!r}")

        canonical_rows = [r for r in rows if (r.get("normalized_name") or "").strip() == canonical_nn]
        to_merge = [r for r in rows if (r.get("normalized_name") or "").strip() != canonical_nn]

        if len(rows) == 1:
            r = rows[0]
            if (r.get("normalized_name") or "").strip() == canonical_nn and (r.get("name") or "").strip() == display_name:
                print("Single row already correct.")
                return
            print(f"Updating single row to name={display_name!r}, normalized_name={canonical_nn!r}")
            with conn.cursor() as cur:
                cur.execute("""
                    UPDATE analytics.d_athletes
                    SET name = %s, normalized_name = %s, updated_at = NOW()
                    WHERE athlete_uuid = %s
                """, (display_name, canonical_nn, r["athlete_uuid"]))
            conn.commit()
            print("Done.")
            return

        if canonical_rows:
            target_uuid = str(canonical_rows[0]["athlete_uuid"])
        else:
            target_uuid = str(rows[0]["athlete_uuid"])
            to_merge = rows[1:]

        for r in to_merge:
            src_uuid = str(r["athlete_uuid"])
            if src_uuid == target_uuid:
                continue
            print(f"Merging {src_uuid} (name={r['name']!r}) into {target_uuid}")
            _merge_athlete_into_canonical(src_uuid, target_uuid, conn)

        with conn.cursor() as cur:
            cur.execute(
                "SELECT name FROM analytics.d_athletes WHERE athlete_uuid = %s",
                (target_uuid,),
            )
            row = cur.fetchone()
        if row and (row[0] or "").strip() != display_name:
            print(f"Updating canonical row name to {display_name!r}")
            with conn.cursor() as cur:
                cur.execute("""
                    UPDATE analytics.d_athletes
                    SET name = %s, normalized_name = %s, updated_at = NOW()
                    WHERE athlete_uuid = %s
                """, (display_name, canonical_nn, target_uuid))
            conn.commit()
        print("Done.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
