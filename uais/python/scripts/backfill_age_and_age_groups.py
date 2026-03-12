#!/usr/bin/env python3
"""
Comprehensive Age and Age Group Backfill Script

This script implements a top-down approach to age management:

1. Backfill DOB from fact tables to d_athletes:
   - If DOB is NULL in d_athletes, search all fact tables for DOB
   - Update d_athletes with found DOB

2. Calculate age_at_collection for all fact tables:
   - Use DOB from d_athletes and session_date from fact tables
   - Update age_at_collection column

3. Update age_group in d_athletes only:
   - Calculate current age from DOB
   - Update age_group based on current age
   - Standardize existing age_group values

4. Standardize age_group values across all tables:
   - Convert variations (youth, Youth, YOUTH) to standard format
   - Remove age_group from fact tables (only keep in d_athletes)

Age Group Definitions (canonical; see python/common/age_utils.py):
- YOUTH: age < 14
- HIGH SCHOOL: 14 <= age <= 18
- COLLEGE: 18 < age <= 22
- PRO: age > 22

d_athletes.age_group = age_group of most recently inserted data (latest session_date across fact tables).
Fact tables = age at assessment (session_date + DOB).

Usage:
    python python/scripts/backfill_age_and_age_groups.py [--dry-run] [--skip-dob-backfill] [--skip-age-calculation]
    
Options:
    --dry-run: Show what would be updated without making changes
    --skip-dob-backfill: Skip backfilling DOB from fact tables
    --skip-age-calculation: Skip calculating age_at_collection
"""

import sys
import argparse
import logging
from pathlib import Path
from typing import Optional, Dict, List, Tuple
from datetime import datetime, date
from decimal import Decimal

# Add project root to path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from python.common.athlete_manager import get_warehouse_connection
from python.common.age_utils import (
    calculate_age,
    calculate_age_at_collection,
    calculate_age_group,
    standardize_age_group,
    parse_date,
    normalize_session_date,
)
import psycopg2
from psycopg2.extras import RealDictCursor

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)


# Exclude kinematics tables from backfill (optional; remove to include them again)
FACT_TABLES_EXCLUDE = frozenset({"f_kinematics_pitching", "f_kinematics_hitting"})


def get_fact_tables(conn) -> List[Tuple[str, str]]:
    """Get list of all fact tables (schema, table_name), excluding FACT_TABLES_EXCLUDE."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT table_schema, table_name
            FROM information_schema.tables
            WHERE table_schema IN ('public', 'analytics')
              AND table_name LIKE 'f_%'
              AND table_name NOT LIKE '_prisma_%'
            ORDER BY table_schema, table_name
        """)
        return [(row[0], row[1]) for row in cur.fetchall() if row[1] not in FACT_TABLES_EXCLUDE]


def table_has_column(conn, schema: str, table: str, column: str) -> bool:
    """Check if table has a specific column."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = %s 
              AND table_name = %s
              AND column_name = %s
        """, (schema, table, column))
        return cur.fetchone() is not None


def backfill_dob_from_fact_tables(conn, dry_run: bool = False) -> Dict[str, date]:
    """
    Backfill DOB from fact tables to d_athletes.
    
    Searches all fact tables for DOB values and updates d_athletes.
    Returns mapping of athlete_uuid -> date_of_birth for newly found DOBs.
    """
    logger.info("=" * 80)
    logger.info("STEP 1: Backfilling DOB from fact tables to d_athletes")
    logger.info("=" * 80)
    
    # Get athletes without DOB
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("""
            SELECT athlete_uuid, name, normalized_name
            FROM analytics.d_athletes
            WHERE date_of_birth IS NULL
        """)
        athletes_without_dob = cur.fetchall()
    
    logger.info(f"Found {len(athletes_without_dob)} athletes without DOB")
    
    if not athletes_without_dob:
        logger.info("All athletes already have DOB - skipping backfill")
        return {}
    
    # Get all fact tables
    fact_tables = get_fact_tables(conn)
    logger.info(f"Searching {len(fact_tables)} fact tables for DOB values...")
    
    dob_found = {}
    dob_sources = {}  # Track where DOB was found
    source_ref = {}   # athlete_uuid -> (session_date, age_group) from table where DOB was found (for d_athletes.age_group)
    
    # Search each fact table for DOB
    for schema, table in fact_tables:
        full_table = f"{schema}.{table}"
        
        # Check if table has date_of_birth or DOB column
        has_dob_col = table_has_column(conn, schema, table, "date_of_birth")
        has_dob_alt = table_has_column(conn, schema, table, "dob")
        
        if not (has_dob_col or has_dob_alt):
            continue
        
        dob_col = "date_of_birth" if has_dob_col else "dob"
        
        # Get unique DOB and one (session_date, age_group) per athlete for d_athletes.age_group
        athlete_uuids = tuple(a['athlete_uuid'] for a in athletes_without_dob)
        if not athlete_uuids:
            continue  # No athletes to search for
        
        has_session = table_has_column(conn, schema, table, "session_date")
        has_age_group = table_has_column(conn, schema, table, "age_group")
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            try:
                if has_session:
                    cols = f"athlete_uuid, {dob_col} as dob_value, session_date"
                    if has_age_group:
                        cols += ", age_group"
                    cur.execute(f"""
                        SELECT DISTINCT ON (athlete_uuid) {cols}
                        FROM {full_table}
                        WHERE {dob_col} IS NOT NULL
                          AND athlete_uuid IN %s
                        ORDER BY athlete_uuid, session_date DESC NULLS LAST
                    """, (athlete_uuids,))
                else:
                    cur.execute(f"""
                        SELECT DISTINCT athlete_uuid, {dob_col} as dob_value
                        FROM {full_table}
                        WHERE {dob_col} IS NOT NULL
                          AND athlete_uuid IN %s
                    """, (athlete_uuids,))
                
                for row in cur.fetchall():
                    athlete_uuid = row['athlete_uuid']
                    dob_str = row['dob_value']
                    
                    if athlete_uuid in dob_found:
                        continue  # Already found DOB for this athlete
                    
                    # Parse DOB
                    dob_date = parse_date(dob_str)
                    if dob_date:
                        dob_found[athlete_uuid] = dob_date
                        dob_sources[athlete_uuid] = full_table
                        if has_session and row.get('session_date'):
                            sd = row['session_date']
                            if hasattr(sd, 'date'):
                                sd = sd.date()
                            if has_age_group and row.get('age_group'):
                                ag = standardize_age_group(row['age_group']) or row['age_group']
                                source_ref[athlete_uuid] = (sd, ag)
                            elif sd and athlete_uuid not in source_ref:
                                ag = calculate_age_group(calculate_age_at_collection(sd, dob_date))
                                if ag:
                                    source_ref[athlete_uuid] = (sd, ag)
                        logger.info(f"  Found DOB for {athlete_uuid} in {full_table}: {dob_date}")
            except Exception as e:
                logger.warning(f"  Error searching {full_table} for DOB: {e}")
                continue
    
    logger.info(f"Found DOB for {len(dob_found)} athletes")
    
    # Update d_athletes with found DOBs and age_group from source (cross-fill: set dimension from source that had DOB)
    if dob_found and not dry_run:
        with conn.cursor() as cur:
            for athlete_uuid, dob_date in dob_found.items():
                try:
                    age_group_from_source = None
                    if athlete_uuid in source_ref:
                        _, ag = source_ref[athlete_uuid]
                        age_group_from_source = ag
                    if age_group_from_source:
                        cur.execute("""
                            UPDATE analytics.d_athletes
                            SET date_of_birth = %s, age_group = %s
                            WHERE athlete_uuid = %s
                              AND date_of_birth IS NULL
                        """, (dob_date, age_group_from_source, athlete_uuid))
                    else:
                        cur.execute("""
                            UPDATE analytics.d_athletes
                            SET date_of_birth = %s
                            WHERE athlete_uuid = %s
                              AND date_of_birth IS NULL
                        """, (dob_date, athlete_uuid))
                    logger.info(f"  Updated DOB for athlete {athlete_uuid} (found in {dob_sources[athlete_uuid]})")
                except Exception as e:
                    logger.error(f"  Error updating DOB for {athlete_uuid}: {e}")
        
        conn.commit()
        logger.info(f"Updated DOB for {len(dob_found)} athletes in d_athletes")
    elif dob_found and dry_run:
        logger.info(f"DRY RUN: Would update DOB for {len(dob_found)} athletes")
        for athlete_uuid, dob_date in list(dob_found.items())[:5]:
            logger.info(f"  Would update {athlete_uuid}: {dob_date}")
    
    return dob_found


def calculate_age_at_collection_for_tables(conn, dry_run: bool = False) -> Tuple[int, int]:
    """
    Calculate and update age_at_collection for all fact tables.
    
    Returns:
        Tuple of (rows_updated, rows_skipped)
    """
    logger.info("=" * 80)
    logger.info("STEP 2: Calculating age_at_collection for all fact tables")
    logger.info("=" * 80)
    
    # Get all fact tables
    fact_tables = get_fact_tables(conn)
    logger.info(f"Processing {len(fact_tables)} fact tables...")
    
    total_updated = 0
    total_skipped = 0
    
    for schema, table in fact_tables:
        full_table = f"\"{schema}\".\"{table}\""
        
        # Check if table has required columns
        if not table_has_column(conn, schema, table, "age_at_collection"):
            logger.debug(f"  Skipping {full_table}: no age_at_collection column")
            continue
        
        if not table_has_column(conn, schema, table, "session_date"):
            logger.debug(f"  Skipping {full_table}: no session_date column")
            continue

        if not table_has_column(conn, schema, table, "athlete_uuid"):
            logger.debug(f"  Skipping {full_table}: no athlete_uuid column")
            continue
        
        # Prefer set-based updates (fast) instead of row-by-row Python loops.
        has_id = table_has_column(conn, schema, table, "id")

        logger.info(f"  {full_table}: Backfilling age_at_collection (set-based{' batched' if has_id else ''})")

        updated = 0
        skipped = 0

        try:
            # Diagnostics so "Updated 0" is actionable
            with conn.cursor() as cur:
                cur.execute(f"""
                    SELECT COUNT(*)
                    FROM {full_table} t
                    WHERE t.session_date IS NOT NULL
                      AND t.age_at_collection IS NULL
                """)
                null_age_cnt = cur.fetchone()[0]

                cur.execute(f"""
                    SELECT COUNT(*)
                    FROM {full_table} t
                    LEFT JOIN analytics.d_athletes a ON a.athlete_uuid = t.athlete_uuid
                    WHERE t.session_date IS NOT NULL
                      AND t.age_at_collection IS NULL
                      AND a.date_of_birth IS NULL
                """)
                null_age_missing_dob_cnt = cur.fetchone()[0]

                eligible_cnt = max(0, int(null_age_cnt) - int(null_age_missing_dob_cnt))

            logger.info(
                f"  {full_table}: rows needing age_at_collection={null_age_cnt:,} "
                f"(missing DOB for {null_age_missing_dob_cnt:,} of those; eligible {eligible_cnt:,})"
            )

            if dry_run:
                with conn.cursor() as cur:
                    cur.execute(f"""
                        SELECT COUNT(*)
                        FROM {full_table} t
                        JOIN analytics.d_athletes a ON a.athlete_uuid = t.athlete_uuid
                        WHERE t.age_at_collection IS NULL
                          AND t.session_date IS NOT NULL
                          AND a.date_of_birth IS NOT NULL
                    """)
                    count = cur.fetchone()[0]
                logger.info(f"  {full_table}: DRY RUN would update {count} rows")
                total_updated += int(count)
                continue

            if has_id:
                # Batched updates to avoid long transactions/timeouts on Neon.
                batch_size = getattr(calculate_age_at_collection_for_tables, "_batch_size", 50000)
                while True:
                    try:
                        with conn.cursor() as cur:
                            cur.execute(f"""
                                WITH batch AS (
                                    SELECT t.id, t.session_date, a.date_of_birth
                                    FROM {full_table} t
                                    JOIN analytics.d_athletes a ON a.athlete_uuid = t.athlete_uuid
                                    WHERE t.age_at_collection IS NULL
                                      AND t.session_date IS NOT NULL
                                      AND a.date_of_birth IS NOT NULL
                                    ORDER BY t.id
                                    LIMIT %s
                                )
                                UPDATE {full_table} t
                                SET age_at_collection = ((batch.session_date - batch.date_of_birth)::numeric / 365.25)
                                FROM batch
                                WHERE t.id = batch.id
                            """, (batch_size,))
                            batch_updated = cur.rowcount
                        conn.commit()
                    except (psycopg2.InterfaceError, psycopg2.OperationalError):
                        # Connection dropped (common on long runs). Reconnect and continue.
                        try:
                            conn.close()
                        except Exception:
                            pass
                        conn = get_warehouse_connection()
                        continue

                    if batch_updated == 0:
                        break
                    updated += batch_updated
                    # Light progress so you can see it's alive on big tables (pitching).
                    if updated % (batch_size * 5) == 0:
                        logger.info(f"  {full_table}: updated {updated} rows so far...")
            else:
                # Single-shot update for tables without id
                with conn.cursor() as cur:
                    cur.execute(f"""
                        UPDATE {full_table} t
                        SET age_at_collection = ((t.session_date - a.date_of_birth)::numeric / 365.25)
                        FROM analytics.d_athletes a
                        WHERE a.athlete_uuid = t.athlete_uuid
                          AND t.age_at_collection IS NULL
                          AND t.session_date IS NOT NULL
                          AND a.date_of_birth IS NOT NULL
                    """)
                    updated = cur.rowcount
                conn.commit()
        except Exception as e:
            logger.error(f"  {full_table}: Error during set-based age_at_collection backfill: {e}")
            try:
                conn.rollback()
            except Exception:
                pass

        logger.info(f"  {full_table}: Updated {updated}, Skipped {skipped}")
        total_updated += updated
        total_skipped += skipped
    
    return total_updated, total_skipped


def fix_invalid_age_at_collection(conn, dry_run: bool = False) -> int:
    """
    Set age_at_collection and age_group to NULL where age_at_collection < 0 or > 120.
    Returns number of rows updated across all fact tables.
    """
    logger.info("=" * 80)
    logger.info("STEP: Fix invalid age_at_collection (set NULL where < 0 or > 120)")
    logger.info("=" * 80)
    fact_tables = get_fact_tables(conn)
    total = 0
    for schema, table in fact_tables:
        full_table = f"{schema}.{table}"
        if not table_has_column(conn, schema, table, "age_at_collection"):
            continue
        has_age_group = table_has_column(conn, schema, table, "age_group")
        if dry_run:
            with conn.cursor() as cur:
                cur.execute(f"""
                    SELECT COUNT(*) FROM {full_table}
                    WHERE age_at_collection IS NOT NULL
                      AND (age_at_collection < 0 OR age_at_collection > 120)
                """)
                n = cur.fetchone()[0]
            if n:
                logger.info(f"  {full_table}: DRY RUN would fix {n} rows")
                total += n
            continue
        with conn.cursor() as cur:
            if has_age_group:
                cur.execute(f"""
                    UPDATE {full_table}
                    SET age_at_collection = NULL, age_group = NULL
                    WHERE age_at_collection IS NOT NULL
                      AND (age_at_collection < 0 OR age_at_collection > 120)
                """)
            else:
                cur.execute(f"""
                    UPDATE {full_table}
                    SET age_at_collection = NULL
                    WHERE age_at_collection IS NOT NULL
                      AND (age_at_collection < 0 OR age_at_collection > 120)
                """)
            n = cur.rowcount
        conn.commit()
        if n:
            logger.info(f"  {full_table}: fixed {n} rows")
            total += n
    return total


def update_d_athletes_age_group_from_latest_fact(conn, dry_run: bool = False) -> Tuple[int, int]:
    """
    Set d_athletes.age_group from the fact-table row with the latest session_date for that athlete
    (most recently inserted data). Does not use "current" age.
    Returns (updated, skipped).
    """
    logger.info("=" * 80)
    logger.info("STEP: Set d_athletes.age_group from most recent fact row (latest session_date)")
    logger.info("=" * 80)
    # Build union of (athlete_uuid, session_date, age_group) from all fact tables that have these columns
    fact_tables = get_fact_tables(conn)
    rows_by_athlete = {}  # athlete_uuid -> (session_date, age_group) for latest
    for schema, table in fact_tables:
        full_table = f"{schema}.{table}"
        if not table_has_column(conn, schema, table, "session_date") or not table_has_column(conn, schema, table, "athlete_uuid"):
            continue
        has_age_group = table_has_column(conn, schema, table, "age_group")
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            try:
                if has_age_group:
                    cur.execute(f"""
                        SELECT athlete_uuid, session_date, age_group
                        FROM {full_table}
                        WHERE session_date IS NOT NULL
                    """)
                else:
                    cur.execute(f"""
                        SELECT athlete_uuid, session_date, NULL::text as age_group
                        FROM {full_table}
                        WHERE session_date IS NOT NULL
                    """)
                for row in cur.fetchall():
                    uid = row['athlete_uuid']
                    sd = row['session_date']
                    if hasattr(sd, 'date'):
                        sd = sd.date() if hasattr(sd, 'date') else sd
                    ag = standardize_age_group(row['age_group']) if row.get('age_group') else None
                    if uid not in rows_by_athlete or (sd and rows_by_athlete[uid][0] and sd > rows_by_athlete[uid][0]):
                        rows_by_athlete[uid] = (sd, ag)
            except Exception as e:
                logger.warning(f"  {full_table}: {e}")
                continue
    # For athletes where we only have session_date (no age_group in fact), compute age_group from d_athletes DOB + session_date
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("""
            SELECT athlete_uuid, date_of_birth FROM analytics.d_athletes
        """)
        dob_by_athlete = {r['athlete_uuid']: r['date_of_birth'] for r in cur.fetchall()}
    updated = 0
    skipped = 0
    with conn.cursor() as cur:
        for athlete_uuid, (session_date, age_group) in rows_by_athlete.items():
            if not age_group and session_date and athlete_uuid in dob_by_athlete:
                dob = dob_by_athlete[athlete_uuid]
                if dob:
                    dob_d = dob.date() if hasattr(dob, 'date') else parse_date(str(dob))
                    if dob_d:
                        age_at_c = calculate_age_at_collection(session_date, dob_d)
                        age_group = calculate_age_group(age_at_c) if age_at_c is not None else None
            if not age_group:
                skipped += 1
                continue
            if not dry_run:
                try:
                    cur.execute("""
                        UPDATE analytics.d_athletes
                        SET age_group = %s
                        WHERE athlete_uuid = %s
                    """, (age_group, athlete_uuid))
                    updated += 1
                except Exception as e:
                    logger.error(f"  {athlete_uuid}: {e}")
                    skipped += 1
            else:
                updated += 1
    if not dry_run:
        conn.commit()
    logger.info(f"Updated: {updated}, Skipped: {skipped}")
    return updated, skipped


def update_d_athletes_age_and_age_group(conn, dry_run: bool = False) -> Tuple[int, int]:
    """
    Update age in d_athletes from DOB (fill if NULL). Set age_group from most recent fact row
    via update_d_athletes_age_group_from_latest_fact (not from current age).
    """
    logger.info("=" * 80)
    logger.info("STEP: Update d_athletes age (from DOB) and age_group (from latest fact)")
    logger.info("=" * 80)
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("""
            SELECT athlete_uuid, name, date_of_birth, age
            FROM analytics.d_athletes
            WHERE date_of_birth IS NOT NULL
        """)
        athletes = cur.fetchall()
    updated_age = 0
    with conn.cursor() as cur:
        for athlete in athletes:
            dob = athlete['date_of_birth']
            current_age = calculate_age(dob)
            if current_age is None:
                continue
            cur.execute("""
                UPDATE analytics.d_athletes
                SET age = COALESCE(age, %s)
                WHERE athlete_uuid = %s AND age IS NULL
            """, (Decimal(str(current_age)), athlete['athlete_uuid']))
            if cur.rowcount:
                updated_age += 1
    if not dry_run:
        conn.commit()
    logger.info(f"  Filled age for {updated_age} athletes where NULL")
    return update_d_athletes_age_group_from_latest_fact(conn, dry_run=dry_run)


def fill_fact_age_group_from_age_at_collection(conn, dry_run: bool = False) -> int:
    """
    Set age_group from age_at_collection where age_group IS NULL and age_at_collection IS NOT NULL.
    Uses canonical bounds: YOUTH <14, HIGH SCHOOL 14-18, COLLEGE 18-22, PRO >22.
    """
    logger.info("=" * 80)
    logger.info("STEP: Fill null age_group in fact tables from age_at_collection")
    logger.info("=" * 80)
    case_sql = """
        CASE
            WHEN age_at_collection < 14 THEN 'YOUTH'
            WHEN age_at_collection >= 14 AND age_at_collection <= 18 THEN 'HIGH SCHOOL'
            WHEN age_at_collection > 18 AND age_at_collection <= 22 THEN 'COLLEGE'
            WHEN age_at_collection > 22 THEN 'PRO'
            ELSE NULL
        END
    """
    fact_tables = get_fact_tables(conn)
    total = 0
    for schema, table in fact_tables:
        full_table = f"{schema}.{table}"
        if not table_has_column(conn, schema, table, "age_group") or not table_has_column(conn, schema, table, "age_at_collection"):
            continue
        with conn.cursor() as cur:
            cur.execute(f"""
                UPDATE {full_table}
                SET age_group = {case_sql}
                WHERE age_group IS NULL AND age_at_collection IS NOT NULL
                  AND age_at_collection >= 0 AND age_at_collection <= 120
            """)
            n = cur.rowcount
        if not dry_run:
            conn.commit()
        if n:
            logger.info(f"  {full_table}: {n} rows")
            total += n
    return total


def standardize_age_groups_in_fact_tables(conn, dry_run: bool = False) -> int:
    """
    Standardize age_group values in fact tables using set-based UPDATEs (one per table).
    Maps U13/U15/U17/U19/U23/23+, High School/College/Pro, etc. to YOUTH, HIGH SCHOOL, COLLEGE, PRO.
    """
    logger.info("=" * 80)
    logger.info("STEP 4: Standardizing age_group values (if present in fact tables)")
    logger.info("=" * 80)
    # Single UPDATE per table: CASE expression mirrors age_utils.standardize_age_group
    case_sql = """
        CASE
            WHEN UPPER(TRIM(COALESCE(age_group,''))) IN ('YOUTH','Y') THEN 'YOUTH'
            WHEN UPPER(TRIM(COALESCE(age_group,''))) IN ('HIGH SCHOOL','HIGH_SCHOOL','HS','HIGHSCHOOL') THEN 'HIGH SCHOOL'
            WHEN UPPER(TRIM(COALESCE(age_group,''))) IN ('COLLEGE','C') THEN 'COLLEGE'
            WHEN UPPER(TRIM(COALESCE(age_group,''))) IN ('PRO','PROFESSIONAL','P') THEN 'PRO'
            WHEN UPPER(TRIM(REPLACE(COALESCE(age_group,''),' ',''))) IN ('U13','U15') THEN 'YOUTH'
            WHEN UPPER(TRIM(REPLACE(COALESCE(age_group,''),' ',''))) IN ('U17','U19') THEN 'HIGH SCHOOL'
            WHEN UPPER(TRIM(REPLACE(COALESCE(age_group,''),' ',''))) = 'U23' THEN 'COLLEGE'
            WHEN UPPER(TRIM(REPLACE(COALESCE(age_group,''),' ',''))) = '23+' THEN 'PRO'
            WHEN UPPER(TRIM(age_group)) = 'HIGH SCHOOL' OR TRIM(age_group) IN ('High School','High school') THEN 'HIGH SCHOOL'
            WHEN UPPER(TRIM(age_group)) = 'COLLEGE' OR TRIM(age_group) IN ('College','college') THEN 'COLLEGE'
            WHEN UPPER(TRIM(age_group)) = 'PRO' OR TRIM(age_group) IN ('Pro','pro') THEN 'PRO'
            ELSE age_group
        END
    """
    fact_tables = get_fact_tables(conn)
    total_updated = 0
    for schema, table in fact_tables:
        full_table = f'"{schema}"."{table}"'
        if not table_has_column(conn, schema, table, "age_group"):
            continue
        # Only update rows that are not already canonical
        where_sql = """
            age_group IS NOT NULL
            AND age_group IS DISTINCT FROM 'YOUTH'
            AND age_group IS DISTINCT FROM 'HIGH SCHOOL'
            AND age_group IS DISTINCT FROM 'COLLEGE'
            AND age_group IS DISTINCT FROM 'PRO'
        """
        if dry_run:
            with conn.cursor() as cur:
                cur.execute(f"SELECT COUNT(*) FROM {full_table} WHERE {where_sql}")
                n = cur.fetchone()[0]
            if n:
                logger.info(f"  {full_table}: DRY RUN would standardize {n} rows")
                total_updated += n
            continue
        with conn.cursor() as cur:
            cur.execute(f"""
                UPDATE {full_table}
                SET age_group = {case_sql}
                WHERE {where_sql}
            """)
            updated = cur.rowcount
        conn.commit()
        if updated > 0:
            logger.info(f"  {full_table}: Standardized {updated} rows")
            total_updated += updated
    return total_updated


def main():
    parser = argparse.ArgumentParser(
        description='Comprehensive age and age group backfill'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Show what would be updated without making changes'
    )
    parser.add_argument(
        '--skip-dob-backfill',
        action='store_true',
        help='Skip backfilling DOB from fact tables'
    )
    parser.add_argument(
        '--skip-age-calculation',
        action='store_true',
        help='Skip calculating age_at_collection'
    )
    parser.add_argument(
        '--only-table',
        action='append',
        default=None,
        help='Only process a specific table (repeatable). Examples: public.f_kinematics_pitching or f_kinematics_pitching'
    )
    parser.add_argument(
        '--batch-size',
        type=int,
        default=50000,
        help='Batch size for large tables (default: 50000). Larger is faster but heavier on Neon.'
    )
    parser.add_argument(
        '--skip-fact-age-group-standardize',
        action='store_true',
        help='Skip standardizing age_group in fact tables (recommended on Neon; can be very slow)'
    )
    
    args = parser.parse_args()
    
    conn = None
    
    try:
        logger.info("=" * 80)
        logger.info("Comprehensive Age and Age Group Backfill")
        logger.info("=" * 80)
        
        if args.dry_run:
            logger.info("DRY RUN MODE - No changes will be made")
        
        # Connect to database
        logger.info("\nConnecting to warehouse database...")
        conn = get_warehouse_connection()
        
        # Log connection info to show which database we're using
        with conn.cursor() as cur:
            cur.execute("SELECT current_database(), inet_server_addr(), inet_server_port()")
            db_info = cur.fetchone()
            db_name = db_info[0] if db_info[0] else "unknown"
            db_host = db_info[1] if db_info[1] else "unknown"
            db_port = db_info[2] if db_info[2] else "unknown"
        
        logger.info(f"Connected successfully!")
        logger.info(f"Database: {db_name}")
        logger.info(f"Host: {db_host}:{db_port}")
        
        # Check if it's Neon (neon.tech) or local
        if 'neon' in db_host.lower() or 'neon.tech' in str(db_host).lower():
            logger.info("✓ Connected to NEON (cloud database)")
        elif 'localhost' in str(db_host).lower() or '127.0.0.1' in str(db_host):
            logger.info("⚠ Connected to LOCAL database")
        else:
            logger.info(f"Connected to: {db_host}")
        
        # Step 1: Backfill DOB from fact tables to d_athletes
        if not args.skip_dob_backfill:
            dob_found = backfill_dob_from_fact_tables(conn, dry_run=args.dry_run)
            logger.info(f"\nFound DOB for {len(dob_found)} athletes")
        else:
            logger.info("\nSkipping DOB backfill (--skip-dob-backfill)")
        
        # Fix invalid age_at_collection (set NULL where < 0 or > 120)
        fix_invalid_age_at_collection(conn, dry_run=args.dry_run)
        
        # Step 2: Calculate age_at_collection for all fact tables
        if not args.skip_age_calculation:
            # stash batch size on the function so the inner loop can access it without changing signature everywhere
            calculate_age_at_collection_for_tables._batch_size = args.batch_size

            if args.only_table:
                # Filter fact_tables globally by monkey-patching get_fact_tables output within this call
                original_get_fact_tables = get_fact_tables
                def _filtered_get_fact_tables(c):
                    tables = original_get_fact_tables(c)
                    patterns = set(args.only_table)
                    out = []
                    for s, t in tables:
                        full = f"{s}.{t}"
                        if t in patterns or full in patterns or any(p in full for p in patterns):
                            out.append((s, t))
                    return out
                globals()['get_fact_tables'] = _filtered_get_fact_tables
                try:
                    updated, skipped = calculate_age_at_collection_for_tables(conn, dry_run=args.dry_run)
                finally:
                    globals()['get_fact_tables'] = original_get_fact_tables
            else:
                updated, skipped = calculate_age_at_collection_for_tables(conn, dry_run=args.dry_run)
            logger.info(f"\nAge at collection: Updated {updated}, Skipped {skipped}")
        else:
            logger.info("\nSkipping age_at_collection calculation (--skip-age-calculation)")
        
        # Fill null age_group in fact tables from age_at_collection
        fill_fact_age_group_from_age_at_collection(conn, dry_run=args.dry_run)
        
        # Step 3: Update d_athletes age (fill NULL from DOB) and age_group from latest fact row
        updated, skipped = update_d_athletes_age_and_age_group(conn, dry_run=args.dry_run)
        logger.info(f"\nAge/age_group in d_athletes: Updated {updated}, Skipped {skipped}")
        
        # Step 4: Standardize age_group values (if present in fact tables)
        if args.skip_fact_age_group_standardize:
            logger.info("\nSkipping fact-table age_group standardization (--skip-fact-age-group-standardize)")
        else:
            standardized = standardize_age_groups_in_fact_tables(conn, dry_run=args.dry_run)
            logger.info(f"\nStandardized age_group values: {standardized} rows")
        
        # Summary
        logger.info("\n" + "=" * 80)
        logger.info("SUMMARY")
        logger.info("=" * 80)
        logger.info("Backfill complete!")
        
        return 0
        
    except psycopg2.OperationalError as e:
        logger.error(f"Database connection error: {e}")
        return 1
    except psycopg2.Error as e:
        logger.error(f"Database error: {e}")
        if conn:
            conn.rollback()
        return 2
    except Exception as e:
        logger.exception(f"Unexpected error: {e}")
        return 3
    finally:
        if conn:
            conn.close()
            logger.debug("Closed database connection")


if __name__ == '__main__':
    sys.exit(main())
