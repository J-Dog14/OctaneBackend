#!/usr/bin/env python3
"""
Backfill age_at_collection and age_group Columns

This script:
1. Calculates age_at_collection from session_date and athlete's date_of_birth
2. Calculates age_group based on age_at_collection:
   - YOUTH: < 14
   - HIGH SCHOOL: 14-18 (inclusive)
   - COLLEGE: 18-22 (inclusive)
   - PRO: 22+
3. Updates all rows in all fact tables

NOTE: This script is deprecated in favor of backfill_age_and_age_groups.py
which implements the top-down approach and only stores age_group in d_athletes.

Usage:
    python python/scripts/backfill_age_group_columns.py [--dry-run] [--table TABLE_NAME]
    
Options:
    --dry-run: Show what would be updated without making changes
    --table: Only update a specific table (e.g., f_athletic_screen_cmj)
"""

import sys
import argparse
import logging
from pathlib import Path
from typing import Optional, List, Tuple
from datetime import datetime, date
from decimal import Decimal

# Add project root to path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from python.common.athlete_manager import get_warehouse_connection
import psycopg2
from psycopg2.extras import RealDictCursor

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)


def calculate_age_at_collection(session_date: date, date_of_birth: Optional[date]) -> Optional[float]:
    """
    Calculate age at collection from session date and date of birth.
    
    Args:
        session_date: Date when data was collected
        date_of_birth: Athlete's date of birth
        
    Returns:
        Age in years as float, or None if DOB is missing
    """
    if not date_of_birth or not session_date:
        return None
    
    try:
        # Calculate age in years
        age_days = (session_date - date_of_birth).days
        age_years = age_days / 365.25
        return age_years
    except Exception as e:
        logger.warning(f"Error calculating age: {e}")
        return None


def calculate_age_group(age_at_collection: Optional[float]) -> Optional[str]:
    """
    Calculate age group based on age at collection.
    
    Age Group Definitions:
    - YOUTH: < 13 years
    - HIGH SCHOOL: 14-18 years (inclusive)
    - COLLEGE: 18-22 years (inclusive)
    - PRO: 22+ years
    
    Args:
        age_at_collection: Age in years at time of collection
        
    Returns:
        "YOUTH", "HIGH SCHOOL", "COLLEGE", "PRO", or None
    """
    if age_at_collection is None:
        return None
    
    if age_at_collection < 13:
        return "YOUTH"
    elif 14 <= age_at_collection <= 18:
        return "HIGH SCHOOL"
    elif 18 < age_at_collection <= 22:
        return "COLLEGE"
    else:  # age_at_collection > 22
        return "PRO"


def get_fact_tables(conn) -> List[str]:
    """Get list of all fact tables that need age_group columns."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT table_schema, table_name
            FROM information_schema.tables
            WHERE table_schema IN ('public', 'analytics')
              AND table_name LIKE 'f_%'
              AND table_name NOT LIKE '_prisma_%'
            ORDER BY table_schema, table_name
        """)
        tables = [f"{row[0]}.{row[1]}" for row in cur.fetchall()]
    return tables


def get_athlete_dob_map(conn) -> dict:
    """Get mapping of athlete_uuid to date_of_birth."""
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("""
            SELECT athlete_uuid, date_of_birth
            FROM analytics.d_athletes
            WHERE date_of_birth IS NOT NULL
        """)
        return {row['athlete_uuid']: row['date_of_birth'] for row in cur.fetchall()}


def table_has_age_columns(conn, schema: str, table: str) -> bool:
    """Check if table has age_at_collection and age_group columns."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = %s 
              AND table_name = %s
              AND column_name IN ('age_at_collection', 'age_group')
        """, (schema, table))
        columns = cur.fetchall()
        return len(columns) == 2


def update_table_age_columns(conn, schema: str, table: str, dob_map: dict, dry_run: bool = False) -> Tuple[int, int]:
    """
    Update age_at_collection and age_group for a table.
    
    Returns:
        Tuple of (rows_updated, rows_skipped)
    """
    full_table = f"{schema}.{table}"
    logger.info(f"Processing {full_table}...")
    
    # Check if table has the columns
    if not table_has_age_columns(conn, schema, table):
        logger.warning(f"  Table {full_table} does not have age_at_collection/age_group columns - skipping")
        return 0, 0
    
    # Get all rows that need updating
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(f"""
            SELECT 
                id,
                athlete_uuid,
                session_date
            FROM {full_table}
            WHERE age_at_collection IS NULL 
               OR age_group IS NULL
        """)
        rows = cur.fetchall()
    
    if not rows:
        logger.info(f"  No rows need updating in {full_table}")
        return 0, 0
    
    logger.info(f"  Found {len(rows)} rows to update")
    
    updated = 0
    skipped = 0
    
    with conn.cursor() as cur:
        for row in rows:
            athlete_uuid = row['athlete_uuid']
            session_date = row['session_date']
            
            # Get date of birth
            date_of_birth = dob_map.get(athlete_uuid)
            
            if not date_of_birth:
                skipped += 1
                logger.debug(f"  Skipping row {row['id']}: No DOB for athlete {athlete_uuid}")
                continue
            
            # Calculate age at collection
            age_at_collection = calculate_age_at_collection(session_date, date_of_birth)
            
            if age_at_collection is None:
                skipped += 1
                logger.debug(f"  Skipping row {row['id']}: Could not calculate age")
                continue
            
            # Calculate age group
            age_group = calculate_age_group(age_at_collection)
            
            if not dry_run:
                try:
                    cur.execute(f"""
                        UPDATE {full_table}
                        SET 
                            age_at_collection = %s,
                            age_group = %s
                        WHERE id = %s
                    """, (Decimal(str(age_at_collection)), age_group, row['id']))
                    updated += 1
                except Exception as e:
                    logger.error(f"  Error updating row {row['id']}: {e}")
                    skipped += 1
            else:
                updated += 1
                if updated <= 5:  # Show first 5 examples
                    logger.info(f"  Would update row {row['id']}: age={age_at_collection:.2f}, group={age_group}")
    
    if not dry_run:
        conn.commit()
    
    logger.info(f"  Updated: {updated}, Skipped: {skipped}")
    return updated, skipped


def main():
    parser = argparse.ArgumentParser(
        description='Backfill age_at_collection and age_group columns'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Show what would be updated without making changes'
    )
    parser.add_argument(
        '--table',
        type=str,
        default=None,
        help='Only update a specific table (e.g., f_athletic_screen_cmj)'
    )
    
    args = parser.parse_args()
    
    conn = None
    
    try:
        logger.info("=" * 80)
        logger.info("Backfilling age_at_collection and age_group Columns")
        logger.info("=" * 80)
        
        if args.dry_run:
            logger.info("DRY RUN MODE - No changes will be made")
        
        # Connect to database
        logger.info("Connecting to warehouse database...")
        conn = get_warehouse_connection()
        logger.info("Connected successfully")
        
        # Get athlete DOB mapping
        logger.info("\nLoading athlete date of birth mapping...")
        dob_map = get_athlete_dob_map(conn)
        logger.info(f"Loaded DOB for {len(dob_map)} athletes")
        
        if not dob_map:
            logger.warning("No athletes with date_of_birth found! Cannot calculate age_at_collection.")
            return 1
        
        # Get tables to update
        logger.info("\nFinding fact tables...")
        all_tables = get_fact_tables(conn)
        
        if args.table:
            # Filter to specific table
            matching = [t for t in all_tables if args.table in t]
            if not matching:
                logger.error(f"Table '{args.table}' not found!")
                logger.info(f"Available tables: {', '.join(all_tables)}")
                return 1
            tables_to_update = matching
        else:
            tables_to_update = all_tables
        
        logger.info(f"Found {len(tables_to_update)} tables to process")
        
        # Process each table
        total_updated = 0
        total_skipped = 0
        
        for full_table in tables_to_update:
            schema, table = full_table.split('.')
            updated, skipped = update_table_age_columns(conn, schema, table, dob_map, dry_run=args.dry_run)
            total_updated += updated
            total_skipped += skipped
        
        # Summary
        logger.info("\n" + "=" * 80)
        logger.info("SUMMARY")
        logger.info("=" * 80)
        logger.info(f"Tables processed: {len(tables_to_update)}")
        logger.info(f"Rows {'would be updated' if args.dry_run else 'updated'}: {total_updated}")
        logger.info(f"Rows skipped (no DOB): {total_skipped}")
        
        if total_skipped > 0:
            logger.warning(f"\n{total_skipped} rows were skipped because athletes don't have date_of_birth")
            logger.info("Consider updating athlete records with date_of_birth first")
        
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

