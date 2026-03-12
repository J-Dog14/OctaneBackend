#!/usr/bin/env python3
"""
One-off script to merge 13 named athlete groups into single canonical rows.

For each group, resolves athlete UUIDs from the warehouse, picks canonical by
app_db_uuid > email > created_at, merges all others into that row, and updates
the canonical name. Reports groups where no row has app_db_uuid.

Usage:
    python python/scripts/merge_named_athletes.py --dry-run
    python python/scripts/merge_named_athletes.py
"""

import argparse
import sys
from pathlib import Path

project_root = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(project_root))

from difflib import SequenceMatcher
from psycopg2.extras import RealDictCursor

from python.common.athlete_manager import (
    get_warehouse_connection,
    normalize_name_for_matching,
    _merge_athlete_into_canonical,
    update_athlete_flags,
)
from python.common.athlete_cleanup import clean_athlete_name_for_processing

# 13 groups: each is a list of name variants (typos allowed in DB)
NAMED_ATHLETE_GROUPS = [
    ["bayard lee", "bayard leigh"],
    ["bailey berg", "berg bailey"],
    ["cj guadet", "christopher gaudet"],
    ["connor tack", "conner tack", "tack. connor"],
    ["cody yarborough", "dakota yarborogh", "Yarborough. Cody"],
    ["dom fritton", "dominic fritton"],
    ["Ja brown", "ja'heim brown"],
    ["Junior", "Junior Bigan"],
    ["Miggy delgado", "miguel delgado"],
    ["Roman Maganda", "Roman Magand-aguilar"],
    ["Ariana tiffany", "tifany ariana"],
    ["Zach vennaro", "vennaro zach"],
    ["James eli", "eli james"],
]

SIMILARITY_THRESHOLD = 0.82


def _similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, (a or "").upper(), (b or "").upper()).ratio()


def resolve_group_athletes(conn, group_variants: list) -> list:
    """Return list of athlete rows (dicts) that match any variant in the group."""
    normalized_variants = {normalize_name_for_matching(v) for v in group_variants}
    seen_uuids = set()
    rows = []

    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        # Exact normalized_name match
        cur.execute(
            """
            SELECT athlete_uuid, name, normalized_name, email, app_db_uuid, created_at
            FROM analytics.d_athletes
            WHERE normalized_name = ANY(%s)
            """,
            (list(normalized_variants),),
        )
        for row in cur.fetchall():
            uuid = str(row["athlete_uuid"])
            if uuid not in seen_uuids:
                seen_uuids.add(uuid)
                rows.append(dict(row))

        # Fuzzy: fetch all athletes and add if normalized_name is close to any variant
        cur.execute(
            """
            SELECT athlete_uuid, name, normalized_name, email, app_db_uuid, created_at
            FROM analytics.d_athletes
            """
        )
        for row in cur.fetchall():
            uuid = str(row["athlete_uuid"])
            if uuid in seen_uuids:
                continue
            nn = (row.get("normalized_name") or "").strip()
            if not nn:
                continue
            for nv in normalized_variants:
                if _similarity(nn, nv) >= SIMILARITY_THRESHOLD:
                    seen_uuids.add(uuid)
                    rows.append(dict(row))
                    break

    return rows


def choose_canonical(rows: list) -> tuple:
    """
    Choose canonical (athlete_uuid, row) by: app_db_uuid > email > oldest created_at.
    Returns (canonical_uuid, canonical_row, has_app_link).
    """
    if not rows:
        return None, None, False
    # Prefer non-null app_db_uuid
    with_app = [r for r in rows if r.get("app_db_uuid")]
    if with_app:
        # Among those, prefer non-null email, then oldest created_at
        with_app.sort(
            key=lambda r: (
                0 if (r.get("email") or "").strip() else 1,
                r.get("created_at") or "",
            )
        )
        return str(with_app[0]["athlete_uuid"]), with_app[0], True
    # No app_db_uuid: prefer email then oldest
    rows_sorted = sorted(
        rows,
        key=lambda r: (
            0 if (r.get("email") or "").strip() else 1,
            r.get("created_at") or "",
        ),
    )
    chosen = rows_sorted[0]
    return str(chosen["athlete_uuid"]), chosen, False


def merge_group(conn, group_label: str, variants: list, dry_run: bool) -> dict:
    """
    Resolve athletes for the group, pick canonical, merge others into it.
    Returns dict with keys: merged_count, no_app_db_uuid, canonical_uuid, canonical_name, message.
    """
    athletes = resolve_group_athletes(conn, variants)
    if not athletes:
        return {
            "merged_count": 0,
            "no_app_db_uuid": False,
            "canonical_uuid": None,
            "canonical_name": None,
            "message": f"No athletes found for group: {group_label}",
        }
    if len(athletes) == 1:
        canonical_uuid = str(athletes[0]["athlete_uuid"])
        has_app = bool(athletes[0].get("app_db_uuid"))
        return {
            "merged_count": 0,
            "no_app_db_uuid": not has_app,
            "canonical_uuid": canonical_uuid,
            "canonical_name": athletes[0].get("name"),
            "message": f"Single athlete for {group_label}: {athletes[0].get('name')} ({canonical_uuid})",
        }

    canonical_uuid, canonical_row, has_app = choose_canonical(athletes)
    others = [a for a in athletes if str(a["athlete_uuid"]) != canonical_uuid]
    keep_name = canonical_row.get("name")
    keep_display, keep_normalized = clean_athlete_name_for_processing(keep_name)

    if dry_run:
        return {
            "merged_count": len(others),
            "no_app_db_uuid": not has_app,
            "canonical_uuid": canonical_uuid,
            "canonical_name": keep_name,
            "message": f"[DRY RUN] Would merge {len(others)} into {canonical_uuid} (keep name: {keep_name}); no_app_db_uuid={not has_app}",
        }

    # Merge each other into canonical
    for other in others:
        source_uuid = str(other["athlete_uuid"])
        _merge_athlete_into_canonical(source_uuid, canonical_uuid, conn)

    # Update canonical row name/normalized_name
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE analytics.d_athletes
            SET name = %s, normalized_name = %s, updated_at = NOW()
            WHERE athlete_uuid = %s
            """,
            (keep_display, keep_normalized, canonical_uuid),
        )
    conn.commit()

    return {
        "merged_count": len(others),
        "no_app_db_uuid": not has_app,
        "canonical_uuid": canonical_uuid,
        "canonical_name": keep_name,
        "message": f"Merged {len(others)} into {canonical_uuid} (name: {keep_name})",
    }


def main():
    parser = argparse.ArgumentParser(
        description="Merge 13 named athlete groups; canonical = app_db_uuid or email or oldest."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Resolve groups and report only; no DB updates",
    )
    args = parser.parse_args()

    conn = get_warehouse_connection()
    no_app_groups = []
    try:
        if args.dry_run:
            print("DRY RUN - no changes will be made\n")

        for i, variants in enumerate(NAMED_ATHLETE_GROUPS, 1):
            label = " / ".join(variants[:2]) + (" ..." if len(variants) > 2 else "")
            result = merge_group(conn, label, variants, dry_run=args.dry_run)
            print(result["message"])
            if result.get("no_app_db_uuid"):
                no_app_groups.append(label)

        if no_app_groups:
            print("\n--- Groups with no app_db_uuid (review manually if needed) ---")
            for g in no_app_groups:
                print(f"  - {g}")

        if not args.dry_run:
            print("\nUpdating athlete flags...")
            update_athlete_flags(conn=conn, verbose=False)
            print("Done.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
