#!/usr/bin/env python3
"""
Data Integrity Audit Script for UAIS Warehouse.

Produces a human-readable report of data quality issues across all fact tables
and the d_athletes master record. Run this periodically or after any data concern
is raised to surface problems early.

Usage:
    cd uais
    python python/scripts/audit_data_integrity.py
    python python/scripts/audit_data_integrity.py --csv output.csv
    python python/scripts/audit_data_integrity.py --fix-flags   # re-run update_athlete_flags after review
"""

import sys
import csv
import argparse
import logging
from pathlib import Path
from datetime import date, timedelta
from typing import List, Dict, Any

project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from python.common.athlete_manager import get_warehouse_connection
from psycopg2.extras import RealDictCursor

logging.basicConfig(level=logging.WARNING, format="%(levelname)s: %(message)s")

# ── helpers ──────────────────────────────────────────────────────────────────

def _hdr(title: str):
    print(f"\n{'='*72}")
    print(f"  {title}")
    print(f"{'='*72}")


def _ok(msg: str):
    print(f"  ✓ {msg}")


def _warn(msg: str):
    print(f"  ⚠  {msg}")


def _issue(msg: str):
    print(f"  ✗ {msg}")


# ── individual checks ─────────────────────────────────────────────────────────

def check_orphaned_fact_rows(conn) -> List[Dict]:
    """Fact rows whose athlete_uuid has no matching d_athletes record."""
    issues = []
    tables = [
        "f_athletic_screen_cmj", "f_athletic_screen_dj", "f_athletic_screen_ppu",
        "f_athletic_screen_slv", "f_athletic_screen_nmt",
        "f_readiness_screen", "f_readiness_screen_i", "f_readiness_screen_y",
        "f_readiness_screen_t", "f_readiness_screen_ir90",
        "f_readiness_screen_cmj", "f_readiness_screen_ppu",
        "f_pro_sup", "f_arm_action", "f_curveball_test",
        "f_mobility", "f_proteus",
        "f_pitching_trials", "f_hitting_trials",
    ]
    _hdr("CHECK 1: Orphaned fact rows (no matching athlete)")
    found_any = False
    for table in tables:
        with conn.cursor() as cur:
            try:
                cur.execute(f"""
                    SELECT f.athlete_uuid, COUNT(*) AS row_count
                    FROM public.{table} f
                    LEFT JOIN analytics.d_athletes a ON a.athlete_uuid = f.athlete_uuid
                    WHERE a.athlete_uuid IS NULL
                    GROUP BY f.athlete_uuid
                """)
                rows = cur.fetchall()
                if rows:
                    found_any = True
                    for r in rows:
                        msg = f"{table}: {r[1]} orphaned rows for uuid={r[0]}"
                        _issue(msg)
                        issues.append({"check": "orphaned_rows", "table": table, "athlete_uuid": r[0], "detail": msg})
            except Exception as e:
                _warn(f"Could not check {table}: {e}")
                conn.rollback()
    if not found_any:
        _ok("No orphaned fact rows found")
    return issues


def check_null_age_with_dob(conn) -> List[Dict]:
    """Fact rows where age_at_collection is NULL but athlete has a DOB."""
    issues = []
    tables_with_age = [
        "f_athletic_screen_cmj", "f_athletic_screen_dj", "f_athletic_screen_ppu",
        "f_athletic_screen_slv", "f_athletic_screen_nmt",
        "f_readiness_screen",
        "f_pro_sup", "f_arm_action", "f_curveball_test", "f_mobility", "f_proteus",
    ]
    _hdr("CHECK 2: NULL age_at_collection despite athlete having DOB")
    found_any = False
    for table in tables_with_age:
        with conn.cursor() as cur:
            try:
                cur.execute(f"""
                    SELECT f.athlete_uuid, a.name, COUNT(*) AS row_count
                    FROM public.{table} f
                    JOIN analytics.d_athletes a ON a.athlete_uuid = f.athlete_uuid
                    WHERE f.age_at_collection IS NULL
                      AND a.date_of_birth IS NOT NULL
                    GROUP BY f.athlete_uuid, a.name
                    ORDER BY a.name
                """)
                rows = cur.fetchall()
                if rows:
                    found_any = True
                    for r in rows:
                        msg = f"{table}: {r[2]} rows for {r[1]} ({r[0]}) have NULL age — re-run pipeline to backfill"
                        _warn(msg)
                        issues.append({"check": "null_age_with_dob", "table": table,
                                       "athlete_uuid": r[0], "name": r[1], "detail": msg})
            except Exception as e:
                _warn(f"Could not check {table}: {e}")
                conn.rollback()
    if not found_any:
        _ok("All fact rows with DOB have age_at_collection populated")
    return issues


def check_unrealistic_age(conn) -> List[Dict]:
    """Fact rows with age_at_collection outside 8–65 range."""
    issues = []
    tables_with_age = [
        "f_athletic_screen_cmj", "f_athletic_screen_dj", "f_athletic_screen_ppu",
        "f_athletic_screen_slv", "f_athletic_screen_nmt",
        "f_readiness_screen", "f_pro_sup", "f_arm_action",
        "f_curveball_test", "f_mobility", "f_proteus",
    ]
    _hdr("CHECK 3: Unrealistic age_at_collection (< 8 or > 65)")
    found_any = False
    for table in tables_with_age:
        with conn.cursor() as cur:
            try:
                cur.execute(f"""
                    SELECT f.athlete_uuid, a.name, f.session_date,
                           f.age_at_collection
                    FROM public.{table} f
                    JOIN analytics.d_athletes a ON a.athlete_uuid = f.athlete_uuid
                    WHERE f.age_at_collection IS NOT NULL
                      AND (f.age_at_collection < 8 OR f.age_at_collection > 65)
                    ORDER BY a.name, f.session_date
                    LIMIT 50
                """)
                rows = cur.fetchall()
                if rows:
                    found_any = True
                    for r in rows:
                        msg = (f"{table}: {r[1]} ({r[0]}) on {r[2]} has "
                               f"age_at_collection={r[3]:.1f} — likely wrong DOB or wrong session date")
                        _issue(msg)
                        issues.append({"check": "unrealistic_age", "table": table,
                                       "athlete_uuid": r[0], "name": r[1],
                                       "session_date": str(r[2]), "age": r[3], "detail": msg})
            except Exception as e:
                _warn(f"Could not check {table}: {e}")
                conn.rollback()
    if not found_any:
        _ok("All age_at_collection values are in realistic range")
    return issues


def check_stale_session_dates(conn) -> List[Dict]:
    """
    Fact rows where session_date is more than 60 days before created_at.
    A very large gap suggests the stale-filename-date bug (before session.xml fix).
    """
    issues = []
    tables = [
        "f_athletic_screen_cmj", "f_athletic_screen_dj", "f_athletic_screen_ppu",
        "f_athletic_screen_slv", "f_athletic_screen_nmt",
        "f_readiness_screen", "f_pro_sup", "f_arm_action",
        "f_curveball_test", "f_mobility", "f_proteus",
    ]
    _hdr("CHECK 4: Session date vs row created_at gap > 60 days (stale date suspect)")
    found_any = False
    for table in tables:
        with conn.cursor() as cur:
            try:
                # check if created_at exists in table
                cur.execute(f"""
                    SELECT column_name FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = %s
                    AND column_name = 'created_at'
                """, (table,))
                if not cur.fetchone():
                    continue

                cur.execute(f"""
                    SELECT f.athlete_uuid, a.name, f.session_date, f.created_at::date,
                           (f.created_at::date - f.session_date) AS gap_days
                    FROM public.{table} f
                    JOIN analytics.d_athletes a ON a.athlete_uuid = f.athlete_uuid
                    WHERE (f.created_at::date - f.session_date) > 60
                    ORDER BY gap_days DESC
                    LIMIT 30
                """)
                rows = cur.fetchall()
                if rows:
                    found_any = True
                    for r in rows:
                        msg = (f"{table}: {r[1]} ({r[0]}) — session_date={r[2]}, "
                               f"inserted={r[3]}, gap={r[4]} days — may be stale filename date")
                        _warn(msg)
                        issues.append({"check": "stale_session_date", "table": table,
                                       "athlete_uuid": r[0], "name": r[1],
                                       "session_date": str(r[2]), "created_at": str(r[3]),
                                       "gap_days": r[4], "detail": msg})
            except Exception as e:
                _warn(f"Could not check {table}: {e}")
                conn.rollback()
    if not found_any:
        _ok("No large session_date vs created_at gaps detected")
    return issues


def check_duplicate_normalized_names(conn) -> List[Dict]:
    """Athletes sharing the same normalized_name — should not exist after deduplication."""
    issues = []
    _hdr("CHECK 5: Athletes with duplicate normalized_name")
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("""
            SELECT normalized_name, COUNT(*) AS cnt,
                   array_agg(athlete_uuid ORDER BY created_at) AS uuids,
                   array_agg(name ORDER BY created_at) AS names
            FROM analytics.d_athletes
            WHERE normalized_name IS NOT NULL AND normalized_name != ''
            GROUP BY normalized_name
            HAVING COUNT(*) > 1
            ORDER BY cnt DESC
        """)
        rows = cur.fetchall()
    if not rows:
        _ok("No duplicate normalized_names found")
    else:
        for r in rows:
            msg = (f"normalized_name='{r['normalized_name']}' has {r['cnt']} athletes: "
                   f"{list(r['names'])} | UUIDs: {list(r['uuids'])}")
            _issue(msg)
            issues.append({"check": "duplicate_normalized_name",
                           "normalized_name": r["normalized_name"],
                           "count": r["cnt"],
                           "uuids": list(r["uuids"]),
                           "detail": msg})
    return issues


def check_name_based_source_ids(conn) -> List[Dict]:
    """
    source_athlete_map entries where source_athlete_id looks like a full name
    (contains a space) rather than a short ID code. These are at higher risk
    of name-based mismatches during ingestion.
    """
    issues = []
    _hdr("CHECK 6: Full-name source_athlete_ids (higher mismatch risk)")
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("""
            SELECT m.source_system, m.source_athlete_id, m.athlete_uuid, a.name
            FROM analytics.source_athlete_map m
            JOIN analytics.d_athletes a ON a.athlete_uuid = m.athlete_uuid
            WHERE m.source_athlete_id LIKE '% %'
            ORDER BY m.source_system, a.name
        """)
        rows = cur.fetchall()
    if not rows:
        _ok("All source_athlete_ids are short ID codes (no spaces)")
    else:
        _warn(f"Found {len(rows)} full-name source_athlete_ids (name-based matching, higher risk):")
        for r in rows:
            msg = (f"  source_system={r['source_system']}, "
                   f"source_id='{r['source_athlete_id']}' → {r['name']} ({r['athlete_uuid']})")
            print(msg)
            issues.append({"check": "name_based_source_id",
                           "source_system": r["source_system"],
                           "source_athlete_id": r["source_athlete_id"],
                           "athlete_uuid": r["athlete_uuid"],
                           "name": r["name"],
                           "detail": msg})
    return issues


def check_multi_system_no_email(conn) -> List[Dict]:
    """
    Athletes with data in 2+ assessment systems but no email.
    These may be un-merged duplicates that couldn't be caught by email merge.
    """
    issues = []
    _hdr("CHECK 7: Multi-system athletes with no email (possible un-merged duplicates)")
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("""
            SELECT athlete_uuid, name,
                   (CASE WHEN has_pitching_data THEN 1 ELSE 0 END +
                    CASE WHEN has_hitting_data THEN 1 ELSE 0 END +
                    CASE WHEN has_athletic_screen_data THEN 1 ELSE 0 END +
                    CASE WHEN has_readiness_screen_data THEN 1 ELSE 0 END +
                    CASE WHEN has_pro_sup_data THEN 1 ELSE 0 END +
                    CASE WHEN has_arm_action_data THEN 1 ELSE 0 END +
                    CASE WHEN has_curveball_test_data THEN 1 ELSE 0 END +
                    CASE WHEN has_mobility_data THEN 1 ELSE 0 END +
                    CASE WHEN has_proteus_data THEN 1 ELSE 0 END) AS system_count
            FROM analytics.d_athletes
            WHERE email IS NULL
              AND (CASE WHEN has_pitching_data THEN 1 ELSE 0 END +
                   CASE WHEN has_hitting_data THEN 1 ELSE 0 END +
                   CASE WHEN has_athletic_screen_data THEN 1 ELSE 0 END +
                   CASE WHEN has_readiness_screen_data THEN 1 ELSE 0 END +
                   CASE WHEN has_pro_sup_data THEN 1 ELSE 0 END +
                   CASE WHEN has_arm_action_data THEN 1 ELSE 0 END +
                   CASE WHEN has_curveball_test_data THEN 1 ELSE 0 END +
                   CASE WHEN has_mobility_data THEN 1 ELSE 0 END +
                   CASE WHEN has_proteus_data THEN 1 ELSE 0 END) >= 2
            ORDER BY system_count DESC, name
        """)
        rows = cur.fetchall()
    if not rows:
        _ok("All multi-system athletes have emails")
    else:
        _warn(f"{len(rows)} athlete(s) have multi-system data but no email:")
        for r in rows:
            msg = f"  {r['name']} ({r['athlete_uuid']}) — {r['system_count']} systems, no email"
            print(msg)
            issues.append({"check": "multi_system_no_email",
                           "athlete_uuid": r["athlete_uuid"],
                           "name": r["name"],
                           "system_count": r["system_count"],
                           "detail": msg})
    return issues


def check_partial_athletic_screen_sessions(conn) -> List[Dict]:
    """
    Athletic screen sessions where only some movement types have data.
    A complete session should have CMJ, PPU, and at least one other type.
    Partial sessions may indicate a bad batch run or wrong athlete assignment.
    """
    issues = []
    _hdr("CHECK 8: Partial athletic screen sessions (subset of expected movement types)")
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("""
            WITH sessions AS (
                SELECT athlete_uuid, session_date, 'CMJ' AS movement FROM public.f_athletic_screen_cmj
                UNION ALL
                SELECT athlete_uuid, session_date, 'DJ'  FROM public.f_athletic_screen_dj
                UNION ALL
                SELECT athlete_uuid, session_date, 'PPU' FROM public.f_athletic_screen_ppu
                UNION ALL
                SELECT athlete_uuid, session_date, 'SLV' FROM public.f_athletic_screen_slv
                UNION ALL
                SELECT athlete_uuid, session_date, 'NMT' FROM public.f_athletic_screen_nmt
            ),
            session_summary AS (
                SELECT athlete_uuid, session_date,
                       array_agg(DISTINCT movement ORDER BY movement) AS movements,
                       COUNT(DISTINCT movement) AS type_count
                FROM sessions
                GROUP BY athlete_uuid, session_date
            )
            SELECT ss.athlete_uuid, a.name, ss.session_date, ss.movements, ss.type_count
            FROM session_summary ss
            JOIN analytics.d_athletes a ON a.athlete_uuid = ss.athlete_uuid
            WHERE ss.type_count < 3
            ORDER BY a.name, ss.session_date
        """)
        rows = cur.fetchall()
    if not rows:
        _ok("All athletic screen sessions have 3+ movement types")
    else:
        _warn(f"{len(rows)} athletic screen session(s) have fewer than 3 movement types:")
        for r in rows:
            msg = (f"  {r['name']} ({r['athlete_uuid']}) on {r['session_date']}: "
                   f"only {list(r['movements'])} ({r['type_count']} types)")
            print(msg)
            issues.append({"check": "partial_athletic_screen",
                           "athlete_uuid": r["athlete_uuid"],
                           "name": r["name"],
                           "session_date": str(r["session_date"]),
                           "movements": list(r["movements"]),
                           "type_count": r["type_count"],
                           "detail": msg})
    return issues


def check_age_dob_session_consistency(conn) -> List[Dict]:
    """
    Cross-check: if athlete has DOB and a fact row has age_at_collection,
    verify that DOB + age_at_collection ≈ session_date (within 1 year).
    A large discrepancy suggests the wrong athlete's DOB or wrong session date.
    """
    issues = []
    tables = [
        "f_athletic_screen_cmj", "f_readiness_screen",
        "f_pro_sup", "f_arm_action", "f_mobility", "f_proteus",
    ]
    _hdr("CHECK 9: DOB + age_at_collection vs session_date consistency")
    found_any = False
    for table in tables:
        with conn.cursor() as cur:
            try:
                cur.execute(f"""
                    SELECT f.athlete_uuid, a.name, f.session_date,
                           a.date_of_birth, f.age_at_collection,
                           ABS(
                               EXTRACT(YEAR FROM AGE(f.session_date, a.date_of_birth)) +
                               EXTRACT(MONTH FROM AGE(f.session_date, a.date_of_birth)) / 12.0
                               - f.age_at_collection
                           ) AS discrepancy_years
                    FROM public.{table} f
                    JOIN analytics.d_athletes a ON a.athlete_uuid = f.athlete_uuid
                    WHERE f.age_at_collection IS NOT NULL
                      AND a.date_of_birth IS NOT NULL
                    HAVING ABS(
                               EXTRACT(YEAR FROM AGE(f.session_date, a.date_of_birth)) +
                               EXTRACT(MONTH FROM AGE(f.session_date, a.date_of_birth)) / 12.0
                               - f.age_at_collection
                           ) > 1.0
                    ORDER BY discrepancy_years DESC
                    LIMIT 20
                """)
                rows = cur.fetchall()
                if rows:
                    found_any = True
                    for r in rows:
                        msg = (f"{table}: {r[1]} ({r[0]}) on {r[2]} — "
                               f"DOB={r[3]}, age_at_collection={r[4]:.1f}, "
                               f"discrepancy={r[5]:.1f} years")
                        _issue(msg)
                        issues.append({"check": "dob_age_inconsistency", "table": table,
                                       "athlete_uuid": r[0], "name": r[1],
                                       "session_date": str(r[2]), "dob": str(r[3]),
                                       "age_at_collection": float(r[4]),
                                       "discrepancy_years": float(r[5]), "detail": msg})
            except Exception as e:
                _warn(f"Could not check {table}: {e}")
                conn.rollback()
    if not found_any:
        _ok("DOB + age_at_collection are consistent with session dates")
    return issues


def check_has_data_flags_vs_fact_tables(conn) -> List[Dict]:
    """
    Verify that d_athletes boolean flags match actual fact table content.
    Flags set True but no rows in fact table (or vice versa) indicate stale flags.
    """
    issues = []
    _hdr("CHECK 10: has_*_data flags vs actual fact table rows")

    checks = [
        ("has_athletic_screen_data", ["f_athletic_screen_cmj", "f_athletic_screen_dj",
                                       "f_athletic_screen_ppu", "f_athletic_screen_slv"]),
        ("has_readiness_screen_data", ["f_readiness_screen"]),
        ("has_pro_sup_data", ["f_pro_sup"]),
        ("has_arm_action_data", ["f_arm_action"]),
        ("has_mobility_data", ["f_mobility"]),
        ("has_proteus_data", ["f_proteus"]),
    ]

    found_any = False
    for flag_col, tables in checks:
        union_parts = " UNION ALL ".join(
            [f"SELECT DISTINCT athlete_uuid FROM public.{t}" for t in tables]
        )
        with conn.cursor() as cur:
            try:
                # Flag=True but no rows in fact tables
                cur.execute(f"""
                    SELECT a.athlete_uuid, a.name
                    FROM analytics.d_athletes a
                    WHERE a.{flag_col} = TRUE
                      AND a.athlete_uuid NOT IN ({union_parts})
                """)
                stale_true = cur.fetchall()
                if stale_true:
                    found_any = True
                    for r in stale_true:
                        msg = f"{flag_col}=TRUE but no fact rows: {r[1]} ({r[0]})"
                        _warn(msg)
                        issues.append({"check": "stale_flag_true", "flag": flag_col,
                                       "athlete_uuid": r[0], "name": r[1], "detail": msg})

                # Has fact rows but flag=False or NULL
                cur.execute(f"""
                    SELECT a.athlete_uuid, a.name
                    FROM analytics.d_athletes a
                    WHERE (a.{flag_col} IS FALSE OR a.{flag_col} IS NULL)
                      AND a.athlete_uuid IN ({union_parts})
                """)
                stale_false = cur.fetchall()
                if stale_false:
                    found_any = True
                    for r in stale_false:
                        msg = f"{flag_col}=FALSE/NULL but has fact rows: {r[1]} ({r[0]})"
                        _warn(msg)
                        issues.append({"check": "stale_flag_false", "flag": flag_col,
                                       "athlete_uuid": r[0], "name": r[1], "detail": msg})
            except Exception as e:
                _warn(f"Could not check {flag_col}: {e}")
                conn.rollback()
    if not found_any:
        _ok("All has_*_data flags match actual fact table content")
    return issues


def check_app_db_uuid_null(conn) -> List[Dict]:
    """Athletes with multi-system data but no app_db_uuid — not linked to Octane."""
    issues = []
    _hdr("CHECK 11: Athletes with data but no Octane link (app_db_uuid IS NULL)")
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("""
            SELECT athlete_uuid, name, email,
                   (CASE WHEN has_pitching_data THEN 1 ELSE 0 END +
                    CASE WHEN has_hitting_data THEN 1 ELSE 0 END +
                    CASE WHEN has_athletic_screen_data THEN 1 ELSE 0 END +
                    CASE WHEN has_readiness_screen_data THEN 1 ELSE 0 END +
                    CASE WHEN has_pro_sup_data THEN 1 ELSE 0 END +
                    CASE WHEN has_arm_action_data THEN 1 ELSE 0 END +
                    CASE WHEN has_curveball_test_data THEN 1 ELSE 0 END +
                    CASE WHEN has_mobility_data THEN 1 ELSE 0 END +
                    CASE WHEN has_proteus_data THEN 1 ELSE 0 END) AS system_count
            FROM analytics.d_athletes
            WHERE app_db_uuid IS NULL
              AND (has_pitching_data OR has_hitting_data OR has_athletic_screen_data
                   OR has_readiness_screen_data OR has_pro_sup_data OR has_arm_action_data
                   OR has_curveball_test_data OR has_mobility_data OR has_proteus_data)
            ORDER BY system_count DESC, name
        """)
        rows = cur.fetchall()
    if not rows:
        _ok("All athletes with data are linked to Octane")
    else:
        _warn(f"{len(rows)} athlete(s) have assessment data but no Octane link:")
        for r in rows:
            email_str = r["email"] or "(no email)"
            msg = (f"  {r['name']} ({r['athlete_uuid']}) — {r['system_count']} systems, "
                   f"email: {email_str}")
            print(msg)
            issues.append({"check": "no_octane_link",
                           "athlete_uuid": r["athlete_uuid"],
                           "name": r["name"],
                           "email": r["email"],
                           "system_count": r["system_count"],
                           "detail": msg})
    return issues


# ── main ─────────────────────────────────────────────────────────────────────

def run_audit(csv_path: str = None, fix_flags: bool = False) -> List[Dict]:
    conn = get_warehouse_connection()
    all_issues = []

    print(f"\n{'#'*72}")
    print("  UAIS WAREHOUSE DATA INTEGRITY AUDIT")
    print(f"  Run date: {date.today()}")
    print(f"{'#'*72}")

    try:
        all_issues += check_orphaned_fact_rows(conn)
        all_issues += check_null_age_with_dob(conn)
        all_issues += check_unrealistic_age(conn)
        all_issues += check_stale_session_dates(conn)
        all_issues += check_duplicate_normalized_names(conn)
        all_issues += check_name_based_source_ids(conn)
        all_issues += check_multi_system_no_email(conn)
        all_issues += check_partial_athletic_screen_sessions(conn)
        all_issues += check_age_dob_session_consistency(conn)
        all_issues += check_has_data_flags_vs_fact_tables(conn)
        all_issues += check_app_db_uuid_null(conn)
    finally:
        conn.close()

    # Summary
    _hdr("AUDIT SUMMARY")
    critical = [i for i in all_issues if i["check"] in (
        "orphaned_rows", "unrealistic_age", "dob_age_inconsistency",
        "duplicate_normalized_name", "stale_flag_false",
    )]
    warnings = [i for i in all_issues if i not in critical]
    print(f"  Total issues found : {len(all_issues)}")
    print(f"  Critical           : {len(critical)}")
    print(f"  Warnings           : {len(warnings)}")
    if not all_issues:
        print("\n  ✓ No issues found — database looks clean!")
    else:
        print(f"\n  Review issues above and re-run pipelines or use correction scripts as needed.")

    # Optional CSV output
    if csv_path and all_issues:
        fieldnames = sorted({k for row in all_issues for k in row.keys()})
        with open(csv_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(all_issues)
        print(f"\n  CSV report written to: {csv_path}")

    # Optional flag repair
    if fix_flags:
        print("\n  Re-running update_athlete_flags to repair stale flags...")
        conn2 = get_warehouse_connection()
        try:
            from python.common.athlete_manager import update_athlete_flags
            update_athlete_flags(conn=conn2, verbose=True)
            print("  Done.")
        except Exception as e:
            print(f"  Failed to update flags: {e}")
        finally:
            conn2.close()

    return all_issues


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="UAIS Warehouse Data Integrity Audit")
    parser.add_argument("--csv", metavar="FILE", help="Write flagged rows to CSV file")
    parser.add_argument("--fix-flags", action="store_true",
                        help="After audit, re-run update_athlete_flags to repair stale has_*_data flags")
    args = parser.parse_args()
    issues = run_audit(csv_path=args.csv, fix_flags=args.fix_flags)
    sys.exit(1 if any(i["check"] in ("orphaned_rows", "unrealistic_age", "dob_age_inconsistency",
                                      "duplicate_normalized_name") for i in issues) else 0)
