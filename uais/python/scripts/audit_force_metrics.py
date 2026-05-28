#!/usr/bin/env python3
"""
audit_force_metrics.py

Comprehensive audit of f_pitching_force_metrics.  Checks:

  1. Coverage       — rows vs trials with force data; date range
  2. Missing data   — NULL rates on every key column
  3. QA flags       — flag frequency distribution
  4. Plate IDs      — ambiguous / unresolved plate assignments
  5. Physio ranges  — outlier detection on every numeric metric
  6. Event ordering — FC < MER < BR; events within plausible frame count
  7. Consistency    — BW derivation, flag/count coherence, pct values [0,1]
  8. Swap suspects  — drive_peak_vertical_bw << lead (likely plate swap)
  9. Outlier rows   — ranked worst-offenders across all checks

Usage:
    cd uais
    python python/scripts/audit_force_metrics.py
    python python/scripts/audit_force_metrics.py --athlete-uuid <uuid>
    python python/scripts/audit_force_metrics.py --since 2025-01-01
    python python/scripts/audit_force_metrics.py --csv report.csv
"""

import argparse
import csv
import json
import sys
from pathlib import Path
from datetime import date

_uais_root = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_uais_root))
from python.common.athlete_manager import get_warehouse_connection  # noqa: E402

# ── physiological bounds ──────────────────────────────────────────────────────
# (warn_lo, warn_hi, flag_lo, flag_hi)  — None = no bound on that side
BOUNDS = {
    # Lead leg BW peaks
    "lead_peak_vertical_bw":          (0.8,  3.5,  0.3,  5.0),
    "lead_peak_braking_bw":           (0.1,  2.0,  0.0,  3.5),
    "lead_peak_resultant_bw":         (0.8,  3.8,  0.3,  5.5),
    # Lead leg raw peaks (N) — sanity only
    "lead_peak_vertical_n":           (400,  3500, 100,  6000),
    # Lead RFD
    "lead_rfd_vertical_n_per_s":      (100,  None, 0,    None),
    "lead_rfd_braking_n_per_s":       (0,    None, None, None),
    # Lead impulses (N*s) — vertical over FC->BR
    "lead_impulse_v_fc_to_br_ns":     (50,   600,  10,   900),
    "lead_impulse_b_fc_to_br_ns":     (10,   400,  0,    700),
    # Timing
    "fc_to_br_duration_s":            (0.10, 0.55, 0.04, 0.80),
    "lead_time_to_peak_fz_ms":        (10,   300,  0,    500),
    "peak_v_to_peak_b_lag_ms":        (-100, 100,  -200, 200),
    # Drive leg
    "drive_peak_vertical_bw":         (0.4,  2.5,  0.1,  4.0),
    "drive_peak_braking_bw":          (0.0,  1.5,  None, 3.0),
    # Body weight
    "body_weight_kg":                 (40,   150,  25,   200),
    # Pct values — should be 0-1
    "lead_peak_vertical_pct_fc_br":   (0.0,  1.0,  None, None),
    "lead_peak_braking_pct_fc_br":    (0.0,  1.0,  None, None),
    "lead_peak_resultant_pct_fc_br":  (0.0,  1.0,  None, None),
}

SEP  = "=" * 72
SEP2 = "-" * 72


# ── formatting helpers ────────────────────────────────────────────────────────

def pct(n, total):
    if total == 0:
        return "  n/a"
    return f"{100 * n / total:5.1f}%"


def _q(conn, sql, params=None):
    with conn.cursor() as cur:
        cur.execute(sql, params)
        cols = [d.name for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]


def _scalar(conn, sql, params=None):
    with conn.cursor() as cur:
        cur.execute(sql, params)
        row = cur.fetchone()
        return row[0] if row else None


# ── sections ──────────────────────────────────────────────────────────────────

def section_coverage(conn, where, params, issues):
    print(f"\n{SEP}")
    print("1. COVERAGE")
    print(SEP2)

    total_fm = _scalar(conn, f"SELECT COUNT(*) FROM public.f_pitching_force_metrics fm {where}", params)
    total_fd = _scalar(conn, """
        SELECT COUNT(*) FROM public.f_pitching_force_data fd
        LEFT JOIN public.f_pitching_force_metrics fm
            ON fd.athlete_uuid = fm.athlete_uuid
           AND fd.session_date = fm.session_date
           AND fd.trial_index  = fm.trial_index
        WHERE 1=1
    """ + ("AND " + where.replace("WHERE", "").strip() if where else ""), params)

    missing_fm = _scalar(conn, """
        SELECT COUNT(*) FROM public.f_pitching_force_data fd
        LEFT JOIN public.f_pitching_force_metrics fm
            ON fd.athlete_uuid = fm.athlete_uuid
           AND fd.session_date = fm.session_date
           AND fd.trial_index  = fm.trial_index
        WHERE fm.id IS NULL
    """)

    date_range = _q(conn, f"""
        SELECT MIN(session_date) AS min_date, MAX(session_date) AS max_date,
               COUNT(DISTINCT athlete_uuid) AS athletes,
               COUNT(DISTINCT session_date) AS sessions
        FROM public.f_pitching_force_metrics fm {where}
    """, params)[0]

    print(f"  Rows in f_pitching_force_metrics : {total_fm:>6,}")
    print(f"  Rows in f_pitching_force_data    : {total_fd:>6,}")
    print(f"  Missing metrics (backfill needed): {missing_fm:>6,}")
    print(f"  Date range : {date_range['min_date']} to {date_range['max_date']}")
    print(f"  Athletes   : {date_range['athletes']}")
    print(f"  Sessions   : {date_range['sessions']}")

    if missing_fm and missing_fm > 0:
        issues.append(f"COVERAGE: {missing_fm} trials in force_data have no metrics row")

    return total_fm


def section_nulls(conn, where, params, total, issues):
    print(f"\n{SEP}")
    print("2. NULL RATES ON KEY COLUMNS")
    print(SEP2)

    key_cols = [
        "lead_plate_id", "drive_plate_id",
        "fc_frame", "br_frame", "mer_frame",
        "fc_to_br_duration_s",
        "lead_peak_vertical_n", "lead_peak_vertical_bw",
        "lead_peak_braking_n", "lead_peak_braking_bw",
        "lead_peak_resultant_n", "lead_peak_resultant_bw",
        "lead_rfd_vertical_n_per_s", "lead_rfd_braking_n_per_s",
        "lead_impulse_v_fc_to_br_ns", "lead_impulse_b_fc_to_br_ns",
        "drive_peak_vertical_n", "drive_peak_vertical_bw",
        "body_weight_kg", "body_weight_n",
    ]

    for col in key_cols:
        n_null = _scalar(conn,
            f"SELECT COUNT(*) FROM public.f_pitching_force_metrics fm {where} AND fm.{col} IS NULL",
            params)
        p = pct(n_null, total)
        flag = "  *** HIGH ***" if n_null and n_null / max(total, 1) > 0.10 else ""
        print(f"  {col:<42} {n_null:>5,} null  ({p}){flag}")
        if n_null and n_null / max(total, 1) > 0.10:
            issues.append(f"NULLS: {col} is NULL in {n_null} rows ({p})")


def section_qa_flags(conn, where, params, total, issues):
    print(f"\n{SEP}")
    print("3. QA FLAGS DISTRIBUTION")
    print(SEP2)

    rows = _q(conn, f"""
        SELECT flag, COUNT(*) AS n
        FROM public.f_pitching_force_metrics fm,
        UNNEST(COALESCE(fm.qa_flags, ARRAY[]::text[])) AS flag
        {where}
        GROUP BY flag
        ORDER BY n DESC
    """, params)

    if not rows:
        print("  (no QA flags set)")
    for r in rows:
        p = pct(r["n"], total)
        print(f"  {r['flag']:<45} {r['n']:>5,}  ({p})")
        if r["n"] / max(total, 1) > 0.50 and r["flag"] not in ("ambiguous_lead_plate", "no_seg_rot_data", "no_marker_data"):
            issues.append(f"QA FLAGS: '{r['flag']}' appears in {pct(r['n'], total)} of rows")

    no_flags = _scalar(conn,
        f"SELECT COUNT(*) FROM public.f_pitching_force_metrics fm {where} AND (qa_flags IS NULL OR array_length(qa_flags,1) IS NULL)",
        params)
    print(f"\n  Rows with no flags: {no_flags:,}  ({pct(no_flags, total)})")


def section_plates(conn, where, params, total, issues):
    print(f"\n{SEP}")
    print("4. PLATE IDENTIFICATION")
    print(SEP2)

    no_lead  = _scalar(conn, f"SELECT COUNT(*) FROM public.f_pitching_force_metrics fm {where} AND lead_plate_id IS NULL", params)
    no_drive = _scalar(conn, f"SELECT COUNT(*) FROM public.f_pitching_force_metrics fm {where} AND drive_plate_id IS NULL", params)
    same_pid = _scalar(conn, f"SELECT COUNT(*) FROM public.f_pitching_force_metrics fm {where} AND lead_plate_id = drive_plate_id", params)

    print(f"  lead_plate_id  IS NULL : {no_lead:>5,}  ({pct(no_lead, total)})")
    print(f"  drive_plate_id IS NULL : {no_drive:>5,}  ({pct(no_drive, total)})")
    print(f"  lead = drive (same ID) : {same_pid:>5,}  ({pct(same_pid, total)})  *** ERROR ***" if same_pid else f"  lead = drive (same ID) :     0  (  0.0%)")

    if same_pid:
        issues.append(f"PLATES: {same_pid} rows have lead_plate_id = drive_plate_id (impossible)")

    # Plate IDs in use
    plate_dist = _q(conn, f"""
        SELECT lead_plate_id, drive_plate_id, COUNT(*) AS n
        FROM public.f_pitching_force_metrics fm {where}
        GROUP BY lead_plate_id, drive_plate_id
        ORDER BY n DESC
        LIMIT 10
    """, params)
    print(f"\n  Lead/drive plate ID combinations (top 10):")
    for r in plate_dist:
        print(f"    lead={r['lead_plate_id']}  drive={r['drive_plate_id']}  -> {r['n']:,} rows")


def section_physio(conn, where, params, total, issues):
    print(f"\n{SEP}")
    print("5. PHYSIOLOGICAL RANGE CHECKS")
    print(SEP2)

    for col, (warn_lo, warn_hi, flag_lo, flag_hi) in BOUNDS.items():
        conditions = []
        labels = []
        if flag_lo is not None:
            conditions.append(f"fm.{col} < {flag_lo}")
            labels.append(f"< {flag_lo} [FLAG]")
        if flag_hi is not None:
            conditions.append(f"fm.{col} > {flag_hi}")
            labels.append(f"> {flag_hi} [FLAG]")
        if warn_lo is not None:
            conditions.append(f"fm.{col} < {warn_lo} AND fm.{col} >= {flag_lo if flag_lo is not None else -1e9}")
            labels.append(f"< {warn_lo} [warn]")
        if warn_hi is not None:
            conditions.append(f"fm.{col} > {warn_hi} AND fm.{col} <= {flag_hi if flag_hi is not None else 1e9}")
            labels.append(f"> {warn_hi} [warn]")

        out_flag = 0
        out_warn = 0

        # flag-level outliers
        flag_conds = []
        if flag_lo is not None:
            flag_conds.append(f"fm.{col} < {flag_lo}")
        if flag_hi is not None:
            flag_conds.append(f"fm.{col} > {flag_hi}")
        if flag_conds:
            out_flag = _scalar(conn,
                f"SELECT COUNT(*) FROM public.f_pitching_force_metrics fm {where} AND fm.{col} IS NOT NULL AND ({' OR '.join(flag_conds)})",
                params) or 0

        # warn-level outliers (between warn and flag bounds)
        warn_conds = []
        if warn_lo is not None:
            lo_bound = f"fm.{col} < {warn_lo}"
            if flag_lo is not None:
                lo_bound += f" AND fm.{col} >= {flag_lo}"
            warn_conds.append(f"({lo_bound})")
        if warn_hi is not None:
            hi_bound = f"fm.{col} > {warn_hi}"
            if flag_hi is not None:
                hi_bound += f" AND fm.{col} <= {flag_hi}"
            warn_conds.append(f"({hi_bound})")
        if warn_conds:
            out_warn = _scalar(conn,
                f"SELECT COUNT(*) FROM public.f_pitching_force_metrics fm {where} AND fm.{col} IS NOT NULL AND ({' OR '.join(warn_conds)})",
                params) or 0

        stats = _q(conn, f"""
            SELECT ROUND(MIN(fm.{col})::numeric, 3) AS mn,
                   ROUND(AVG(fm.{col})::numeric, 3) AS avg,
                   ROUND(MAX(fm.{col})::numeric, 3) AS mx
            FROM public.f_pitching_force_metrics fm {where}
            AND fm.{col} IS NOT NULL
        """, params)
        s = stats[0] if stats else {}

        flag_str = f"  FLAG:{out_flag}" if out_flag else ""
        warn_str = f"  warn:{out_warn}" if out_warn else ""
        print(f"  {col:<44}  min={s.get('mn','?')}  avg={s.get('avg','?')}  max={s.get('mx','?')}{flag_str}{warn_str}")

        if out_flag:
            issues.append(f"PHYSIO: {col} has {out_flag} FLAG-level outliers (outside [{flag_lo}, {flag_hi}])")


def section_events(conn, where, params, total, issues):
    print(f"\n{SEP}")
    print("6. EVENT ORDERING & PLAUSIBILITY")
    print(SEP2)

    checks = [
        ("FC = NULL",       f"fc_frame IS NULL"),
        ("BR = NULL",       f"br_frame IS NULL"),
        ("BR <= FC",        f"br_frame IS NOT NULL AND fc_frame IS NOT NULL AND br_frame <= fc_frame"),
        ("MER < FC",        f"mer_frame IS NOT NULL AND fc_frame IS NOT NULL AND mer_frame < fc_frame"),
        ("MER > BR",        f"mer_frame IS NOT NULL AND br_frame IS NOT NULL AND mer_frame > br_frame"),
        ("FC <= 0",         f"fc_frame IS NOT NULL AND fc_frame <= 0"),
        ("BR - FC < 20",    f"br_frame IS NOT NULL AND fc_frame IS NOT NULL AND br_frame - fc_frame < 20"),
        ("BR - FC > 300",   f"br_frame IS NOT NULL AND fc_frame IS NOT NULL AND br_frame - fc_frame > 300"),
    ]

    any_issue = False
    for label, cond in checks:
        n = _scalar(conn,
            f"SELECT COUNT(*) FROM public.f_pitching_force_metrics fm {where} AND {cond}",
            params) or 0
        flag = "  ***" if n > 0 and "NULL" not in label else ""
        print(f"  {label:<30} {n:>5,}{flag}")
        if n > 0 and label not in ("FC = NULL", "BR = NULL"):
            issues.append(f"EVENTS: '{label}' in {n} rows")
            any_issue = True

    if not any_issue:
        print("  All event ordering checks passed.")


def section_consistency(conn, where, params, total, issues):
    print(f"\n{SEP}")
    print("7. INTERNAL CONSISTENCY")
    print(SEP2)

    checks = [
        ("BW mismatch (kg×9.81 vs stored N, >1% diff)",
         """ABS(body_weight_kg * 9.80665 - body_weight_n) / NULLIF(body_weight_n, 0) > 0.01
            AND body_weight_kg IS NOT NULL AND body_weight_n IS NOT NULL"""),
        ("single_impulse_flag=TRUE but peak_count != 1",
         "single_impulse_flag = TRUE AND impulse_peak_count != 1"),
        ("single_impulse_flag=FALSE but peak_count = 1",
         "single_impulse_flag = FALSE AND impulse_peak_count = 1"),
        ("lead_peak_vertical_pct_fc_br outside [0,1]",
         "lead_peak_vertical_pct_fc_br IS NOT NULL AND (lead_peak_vertical_pct_fc_br < 0 OR lead_peak_vertical_pct_fc_br > 1)"),
        ("lead_peak_braking_pct_fc_br outside [0,1]",
         "lead_peak_braking_pct_fc_br IS NOT NULL AND (lead_peak_braking_pct_fc_br < 0 OR lead_peak_braking_pct_fc_br > 1)"),
        ("RFD vertical negative",
         "lead_rfd_vertical_n_per_s IS NOT NULL AND lead_rfd_vertical_n_per_s < 0"),
        ("Vertical impulse FC->BR negative",
         "lead_impulse_v_fc_to_br_ns IS NOT NULL AND lead_impulse_v_fc_to_br_ns < 0"),
    ]

    any_issue = False
    for label, cond in checks:
        n = _scalar(conn,
            f"SELECT COUNT(*) FROM public.f_pitching_force_metrics fm {where} AND ({cond})",
            params) or 0
        flag = "  ***" if n > 0 else ""
        print(f"  {label:<55} {n:>5,}{flag}")
        if n > 0:
            issues.append(f"CONSISTENCY: '{label}' in {n} rows")
            any_issue = True

    # Cross-table check: fc_time_s vs start_time + (fc_frame-1)/frame_rate
    n_fc_mismatch = _scalar(conn, f"""
        SELECT COUNT(*)
        FROM public.f_pitching_force_metrics fm
        LEFT JOIN public.f_pitching_time_data td
            ON  td.athlete_uuid = fm.athlete_uuid
            AND td.session_date = fm.session_date
            AND td.trial_index  = fm.trial_index
        {where}
        AND fm.fc_frame IS NOT NULL AND fm.fc_time_s IS NOT NULL
        AND td.frame_rate IS NOT NULL AND td.start_time IS NOT NULL
        AND ABS(fm.fc_time_s - (td.start_time + (fm.fc_frame - 1)::float / td.frame_rate)) > 0.05
    """, params) or 0
    label_fc = "fc_time_s vs start_time+(fc_frame-1)/fps (>50ms off)"
    flag = "  ***" if n_fc_mismatch > 0 else ""
    print(f"  {label_fc:<55} {n_fc_mismatch:>5,}{flag}")
    if n_fc_mismatch > 0:
        issues.append(f"CONSISTENCY: '{label_fc}' in {n_fc_mismatch} rows")
        any_issue = True

    if not any_issue:
        print("  All consistency checks passed.")


def section_swap_suspects(conn, where, params, total, issues):
    print(f"\n{SEP}")
    print("8. POTENTIAL PLATE-SWAP SUSPECTS")
    print(f"   (drive_peak_vertical_bw < 0.5 BW while lead_peak_vertical_bw > 1.0 BW)")
    print(SEP2)

    rows = _q(conn, f"""
        SELECT fm.athlete_uuid, fm.session_date, fm.trial_index,
               fm.owner_filename,
               ROUND(fm.lead_peak_vertical_bw::numeric, 2)  AS lead_bw,
               ROUND(fm.drive_peak_vertical_bw::numeric, 2) AS drive_bw,
               fm.lead_plate_id, fm.drive_plate_id,
               fm.qa_flags
        FROM public.f_pitching_force_metrics fm {where}
        AND fm.drive_peak_vertical_bw IS NOT NULL
        AND fm.lead_peak_vertical_bw  IS NOT NULL
        AND fm.drive_peak_vertical_bw < 0.5
        AND fm.lead_peak_vertical_bw  > 1.0
        ORDER BY fm.drive_peak_vertical_bw ASC
        LIMIT 30
    """, params)

    if not rows:
        print("  None found.")
    else:
        print(f"  Found {len(rows)} suspect row(s) (showing up to 30):")
        print(f"  {'owner_filename':<35} {'date':<12} {'trial':>5}  lead_bw  drive_bw  plates")
        print(f"  {'-'*35} {'-'*12} {'-----':>5}  -------  --------  ------")
        for r in rows:
            flags = ",".join(r["qa_flags"] or [])
            print(f"  {str(r['owner_filename']):<35} {str(r['session_date']):<12} {r['trial_index']:>5}  "
                  f"{r['lead_bw']:>6}   {r['drive_bw']:>7}   L={r['lead_plate_id']} D={r['drive_plate_id']}  [{flags}]")
        if len(rows) >= 30:
            issues.append(f"SWAP: >=30 rows may have swapped lead/drive plates (drive_bw < 0.5)")
        else:
            issues.append(f"SWAP: {len(rows)} rows may have swapped lead/drive plates (drive_bw < 0.5)")


def section_outlier_rows(conn, where, params, issues):
    print(f"\n{SEP}")
    print("9. WORST-OFFENDER ROWS (multiple range violations)")
    print(SEP2)

    # Score each row: number of out-of-range columns
    score_cases = []
    for col, (warn_lo, warn_hi, flag_lo, flag_hi) in BOUNDS.items():
        parts = []
        if flag_lo is not None:
            parts.append(f"CASE WHEN fm.{col} IS NOT NULL AND fm.{col} < {flag_lo} THEN 2 ELSE 0 END")
        if flag_hi is not None:
            parts.append(f"CASE WHEN fm.{col} IS NOT NULL AND fm.{col} > {flag_hi} THEN 2 ELSE 0 END")
        if warn_lo is not None:
            lo = flag_lo if flag_lo is not None else -1e9
            parts.append(f"CASE WHEN fm.{col} IS NOT NULL AND fm.{col} < {warn_lo} AND fm.{col} >= {lo} THEN 1 ELSE 0 END")
        if warn_hi is not None:
            hi = flag_hi if flag_hi is not None else 1e9
            parts.append(f"CASE WHEN fm.{col} IS NOT NULL AND fm.{col} > {warn_hi} AND fm.{col} <= {hi} THEN 1 ELSE 0 END")
        score_cases.extend(parts)

    score_expr = " + ".join(score_cases) if score_cases else "0"
    rows = _q(conn, f"""
        SELECT fm.athlete_uuid, fm.session_date, fm.trial_index,
               fm.owner_filename,
               ROUND(fm.lead_peak_vertical_bw::numeric,  2) AS lead_bw,
               ROUND(fm.drive_peak_vertical_bw::numeric, 2) AS drive_bw,
               ROUND(fm.fc_to_br_duration_s::numeric, 3)    AS dur_s,
               fm.qa_flags,
               ({score_expr}) AS violation_score
        FROM public.f_pitching_force_metrics fm {where}
        ORDER BY violation_score DESC, fm.session_date DESC
        LIMIT 20
    """, params)

    nonzero = [r for r in rows if (r["violation_score"] or 0) > 0]
    if not nonzero:
        print("  No rows with range violations found.")
    else:
        print(f"  {'owner_filename':<35} {'date':<12} {'trial':>5}  lead_bw  drive_bw  dur_s  score  flags")
        print(f"  {'-'*35} {'-'*12} {'-----':>5}  -------  --------  -----  -----  -----")
        for r in nonzero:
            flags = ",".join(r["qa_flags"] or [])[:40]
            print(f"  {str(r['owner_filename']):<35} {str(r['session_date']):<12} {r['trial_index']:>5}  "
                  f"{str(r['lead_bw'] or '?'):>6}   {str(r['drive_bw'] or '?'):>7}   "
                  f"{str(r['dur_s'] or '?'):>5}  {r['violation_score']:>5}  [{flags}]")


def section_by_athlete(conn, where, params):
    print(f"\n{SEP}")
    print("10. SUMMARY BY ATHLETE")
    print(SEP2)

    rows = _q(conn, f"""
        SELECT
            td.name,
            fm.athlete_uuid,
            COUNT(*)                                                  AS trials,
            ROUND(AVG(fm.lead_peak_vertical_bw)::numeric,  2)        AS avg_lead_bw,
            ROUND(AVG(fm.drive_peak_vertical_bw)::numeric, 2)        AS avg_drive_bw,
            ROUND(AVG(fm.fc_to_br_duration_s * 1000)::numeric, 0)    AS avg_fc_br_ms,
            SUM(CASE WHEN 'ambiguous_lead_plate' = ANY(fm.qa_flags) THEN 1 ELSE 0 END) AS ambiguous,
            SUM(CASE WHEN 'body_weight_missing'  = ANY(fm.qa_flags) THEN 1 ELSE 0 END) AS no_bw,
            COUNT(DISTINCT fm.session_date)                           AS sessions
        FROM public.f_pitching_force_metrics fm
        LEFT JOIN (
            SELECT DISTINCT ON (athlete_uuid) athlete_uuid, name
            FROM public.f_pitching_time_data
            ORDER BY athlete_uuid, session_date DESC
        ) td ON td.athlete_uuid = fm.athlete_uuid
        {where}
        GROUP BY fm.athlete_uuid, td.name
        ORDER BY trials DESC
    """, params)

    print(f"  {'name':<30} {'trials':>6}  avg_lead  avg_drive  fc-br_ms  ambig  no_bw  sessions")
    print(f"  {'-'*30} {'------':>6}  --------  ---------  --------  -----  -----  --------")
    for r in rows:
        name = str(r["name"] or r["athlete_uuid"])[:30]
        print(f"  {name:<30} {r['trials']:>6}  {str(r['avg_lead_bw'] or '?'):>8}  "
              f"{str(r['avg_drive_bw'] or '?'):>9}  {str(r['avg_fc_br_ms'] or '?'):>8}  "
              f"{r['ambiguous']:>5}  {r['no_bw']:>5}  {r['sessions']:>8}")


# ── main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Audit f_pitching_force_metrics for data quality and outliers"
    )
    parser.add_argument("--athlete-uuid", help="Limit audit to one athlete UUID")
    parser.add_argument("--since",        help="Only audit rows on or after this date (YYYY-MM-DD)")
    parser.add_argument("--csv",          help="Write issue summary to this CSV path")
    args = parser.parse_args()

    # Build WHERE clause
    filters = ["1=1"]
    params  = []
    if args.athlete_uuid:
        filters.append("fm.athlete_uuid = %s")
        params.append(args.athlete_uuid)
    if args.since:
        filters.append("fm.session_date >= %s")
        params.append(args.since)
    where = "WHERE " + " AND ".join(filters)

    conn = get_warehouse_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SET client_min_messages = WARNING")

        issues: list = []

        print(SEP)
        print("f_pitching_force_metrics — DATA QUALITY AUDIT")
        if args.athlete_uuid:
            print(f"  Filtered to athlete: {args.athlete_uuid}")
        if args.since:
            print(f"  Filtered since: {args.since}")
        print(SEP)

        total = section_coverage(conn, where, params or None, issues)
        if total == 0:
            print("\nNo rows found — nothing to audit.")
            return 0

        section_nulls(conn, where, params or None, total, issues)
        section_qa_flags(conn, where, params or None, total, issues)
        section_plates(conn, where, params or None, total, issues)
        section_physio(conn, where, params or None, total, issues)
        section_events(conn, where, params or None, total, issues)
        section_consistency(conn, where, params or None, total, issues)
        section_swap_suspects(conn, where, params or None, total, issues)
        section_outlier_rows(conn, where, params or None, issues)
        section_by_athlete(conn, where, params or None)

        # ── summary ────────────────────────────────────────────────────────
        print(f"\n{SEP}")
        print(f"ISSUE SUMMARY  ({len(issues)} issue(s) found)")
        print(SEP2)
        if issues:
            for iss in issues:
                print(f"  - {iss}")
        else:
            print("  No issues detected.")
        print()

        if args.csv:
            with open(args.csv, "w", newline="") as f:
                w = csv.writer(f)
                w.writerow(["issue"])
                for iss in issues:
                    w.writerow([iss])
            print(f"Issue summary written to: {args.csv}")

        return 0 if not issues else 1

    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
