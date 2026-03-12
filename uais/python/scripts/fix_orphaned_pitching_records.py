#!/usr/bin/env python3
"""
Fix orphaned records in pitching and hitting tables.

This script:
1. Finds records in fact tables with UUIDs that don't exist in d_athletes
2. Matches them by source_athlete_id to existing athletes
3. Updates the orphaned records to use the correct UUID
4. Optionally adds athlete_name column to fact tables for better traceability

Usage:
    python python/scripts/fix_orphaned_pitching_records.py --dry-run
    python python/scripts/fix_orphaned_pitching_records.py
"""

import sys
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from python.common.athlete_manager import get_warehouse_connection
from psycopg2.extras import RealDictCursor
import logging
from collections import defaultdict

logging.basicConfig(level=logging.INFO, format='%(levelname)s:%(name)s:%(message)s')
logger = logging.getLogger(__name__)


def find_orphaned_records(conn, table_name: str) -> list:
    """
    Find records in fact table with UUIDs that don't exist in d_athletes.
    
    Args:
        conn: Database connection
        table_name: Name of fact table (e.g., 'f_kinematics_pitching')
        
    Returns:
        List of orphaned records with athlete_uuid and source_athlete_id
    """
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(f'''
            SELECT DISTINCT 
                f.athlete_uuid,
                f.source_athlete_id,
                f.source_system,
                COUNT(*) as record_count
            FROM public.{table_name} f
            LEFT JOIN analytics.d_athletes d ON f.athlete_uuid = d.athlete_uuid
            WHERE d.athlete_uuid IS NULL
              AND f.source_athlete_id IS NOT NULL
            GROUP BY f.athlete_uuid, f.source_athlete_id, f.source_system
            ORDER BY record_count DESC
        ''')
        
        return cur.fetchall()


def find_athlete_by_source_id(conn, source_athlete_id: str, source_system: str) -> dict:
    """
    Find athlete in d_athletes by source_athlete_id and source_system.
    
    Tries multiple matching strategies:
    1. Exact match on source_athlete_id and source_system
    2. Exact match on source_athlete_id (any source_system)
    3. Fuzzy match by normalizing source_athlete_id and matching against normalized_name
    
    Args:
        conn: Database connection
        source_athlete_id: Source athlete ID (e.g., 'BW', 'Wahl, Bobby')
        source_system: Source system (e.g., 'pitching')
        
    Returns:
        Athlete record if found, None otherwise
    """
    from python.common.athlete_cleanup import clean_and_normalize_name
    
    # First, try the source_athlete_map table (if it exists)
    try:
        from python.common.source_athlete_map import get_athlete_by_source_id as get_by_map
        result = get_by_map(conn, source_system, source_athlete_id)
        if result:
            return result
    except Exception:
        # Table might not exist yet, continue with fallback logic
        pass
    
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        # Strategy 1: Exact match on source_athlete_id and source_system
        cur.execute('''
            SELECT athlete_uuid, name, normalized_name, source_system, source_athlete_id
            FROM analytics.d_athletes
            WHERE source_athlete_id = %s
              AND source_system = %s
            ORDER BY created_at ASC
            LIMIT 1
        ''', (source_athlete_id, source_system))
        
        result = cur.fetchone()
        if result:
            return dict(result)
        
        # Strategy 2: Exact match on source_athlete_id (any source_system)
        cur.execute('''
            SELECT athlete_uuid, name, normalized_name, source_system, source_athlete_id
            FROM analytics.d_athletes
            WHERE source_athlete_id = %s
            ORDER BY created_at ASC
            LIMIT 1
        ''', (source_athlete_id,))
        
        result = cur.fetchone()
        if result:
            return dict(result)
        
        # Strategy 3: Fuzzy match - normalize source_athlete_id and match against normalized_name
        # This handles cases like "BW" -> "BOBBY WAHL" or "Wahl, Bobby" -> "BOBBY WAHL"
        normalized_source_id = clean_and_normalize_name(source_athlete_id)
        if normalized_source_id:
            cur.execute('''
                SELECT athlete_uuid, name, normalized_name, source_system, source_athlete_id
                FROM analytics.d_athletes
                WHERE normalized_name = %s
                ORDER BY created_at ASC
                LIMIT 1
            ''', (normalized_source_id,))
            
            result = cur.fetchone()
            if result:
                return dict(result)
        
        return None


def update_orphaned_records(conn, table_name: str, old_uuid: str, new_uuid: str, dry_run: bool = False) -> dict:
    """
    Update orphaned records in fact table to use correct UUID.
    
    Handles duplicate key violations by deleting orphaned records that would conflict
    with existing records for the correct UUID.
    
    Args:
        conn: Database connection
        table_name: Name of fact table
        old_uuid: Old (orphaned) UUID
        new_uuid: New (correct) UUID
        dry_run: If True, only report what would be done
        
    Returns:
        Dictionary with 'updated', 'deleted', and 'total' counts
    """
    with conn.cursor() as cur:
        # Get total count of orphaned records
        cur.execute(f'''
            SELECT COUNT(*) 
            FROM public.{table_name}
            WHERE athlete_uuid = %s
        ''', (old_uuid,))
        
        total_count = cur.fetchone()[0]
        
        if total_count == 0:
            return {'updated': 0, 'deleted': 0, 'total': 0}
        
        # Check which records would create duplicates
        # For tables with unique constraints, we need to identify conflicts
        # Check if table has unique constraint on (athlete_uuid, session_date, metric_name, frame)
        # or similar patterns
        
        # For kinematics tables, check for duplicates based on unique constraint
        if 'kinematics' in table_name:
            # Find records that would create duplicates
            cur.execute(f'''
                SELECT DISTINCT f1.session_date, f1.metric_name, f1.frame
                FROM public.{table_name} f1
                INNER JOIN public.{table_name} f2
                    ON f1.session_date = f2.session_date
                    AND f1.metric_name = f2.metric_name
                    AND f1.frame = f2.frame
                WHERE f1.athlete_uuid = %s
                  AND f2.athlete_uuid = %s
            ''', (old_uuid, new_uuid))
            
            duplicates = cur.fetchall()
            duplicate_count = len(duplicates)
            
            if duplicate_count > 0:
                logger.info(f"  Found {duplicate_count} duplicate session/metric/frame combinations")
                logger.info(f"  Will delete orphaned duplicates (correct UUID already has this data)")
                
                # Delete orphaned records that would create duplicates
                if not dry_run:
                    # Build DELETE query for duplicates
                    placeholders = ','.join(['%s'] * duplicate_count)
                    if duplicate_count > 0:
                        # Delete records that match duplicate combinations
                        cur.execute(f'''
                            DELETE FROM public.{table_name}
                            WHERE athlete_uuid = %s
                              AND (session_date, metric_name, frame) IN (
                                SELECT session_date, metric_name, frame
                                FROM public.{table_name}
                                WHERE athlete_uuid = %s
                              )
                        ''', (old_uuid, new_uuid))
                        
                        deleted_count = cur.rowcount
                        
                        # Now update remaining records
                        cur.execute(f'''
                            UPDATE public.{table_name}
                            SET athlete_uuid = %s
                            WHERE athlete_uuid = %s
                        ''', (new_uuid, old_uuid))
                        
                        updated_count = cur.rowcount
                        
                        conn.commit()
                        logger.info(f"  Deleted {deleted_count} duplicate(s), updated {updated_count} row(s) in {table_name}")
                        return {'updated': updated_count, 'deleted': deleted_count, 'total': total_count}
                    else:
                        # No duplicates, just update
                        cur.execute(f'''
                            UPDATE public.{table_name}
                            SET athlete_uuid = %s
                            WHERE athlete_uuid = %s
                        ''', (new_uuid, old_uuid))
                        
                        conn.commit()
                        logger.info(f"  Updated {cur.rowcount} rows in {table_name}")
                        return {'updated': cur.rowcount, 'deleted': 0, 'total': total_count}
                else:
                    logger.info(f"  [DRY RUN] Would delete {duplicate_count} duplicate(s), update {total_count - duplicate_count} row(s) in {table_name}")
                    return {'updated': total_count - duplicate_count, 'deleted': duplicate_count, 'total': total_count}
            else:
                # No duplicates, just update
                if not dry_run:
                    cur.execute(f'''
                        UPDATE public.{table_name}
                        SET athlete_uuid = %s
                        WHERE athlete_uuid = %s
                    ''', (new_uuid, old_uuid))
                    
                    conn.commit()
                    logger.info(f"  Updated {cur.rowcount} rows in {table_name}")
                    return {'updated': cur.rowcount, 'deleted': 0, 'total': total_count}
                else:
                    logger.info(f"  [DRY RUN] Would update {total_count} rows in {table_name}")
                    return {'updated': total_count, 'deleted': 0, 'total': total_count}
        else:
            # For other tables, just update (no unique constraint on these fields)
            if not dry_run:
                cur.execute(f'''
                    UPDATE public.{table_name}
                    SET athlete_uuid = %s
                    WHERE athlete_uuid = %s
                ''', (new_uuid, old_uuid))
                
                conn.commit()
                logger.info(f"  Updated {cur.rowcount} rows in {table_name}")
                return {'updated': cur.rowcount, 'deleted': 0, 'total': total_count}
            else:
                logger.info(f"  [DRY RUN] Would update {total_count} rows in {table_name}")
                return {'updated': total_count, 'deleted': 0, 'total': total_count}


def fix_orphaned_records_for_table(conn, table_name: str, dry_run: bool = False) -> dict:
    """
    Fix orphaned records for a specific fact table.
    
    Args:
        conn: Database connection
        table_name: Name of fact table
        dry_run: If True, only report what would be done
        
    Returns:
        Dictionary with statistics
    """
    logger.info(f"\nProcessing {table_name}...")
    
    # Find orphaned records
    orphaned = find_orphaned_records(conn, table_name)
    
    if not orphaned:
        logger.info(f"  No orphaned records found in {table_name}")
        return {
            'table': table_name,
            'orphaned_found': 0,
            'matched': 0,
            'updated': 0,
            'deleted': 0,
            'total_processed': 0,
            'unmatched': 0
        }
    
    logger.info(f"  Found {len(orphaned)} orphaned UUID groups")
    
    matched_count = 0
    updated_count = 0
    deleted_count = 0
    unmatched_count = 0
    total_rows_processed = 0
    
    for orphan in orphaned:
        old_uuid = orphan['athlete_uuid']
        source_id = orphan['source_athlete_id']
        source_system = orphan['source_system']
        record_count = orphan['record_count']
        
        logger.info(f"\n  Orphaned UUID: {old_uuid}")
        logger.info(f"    Source ID: {source_id}, System: {source_system}")
        logger.info(f"    Records: {record_count}")
        
        # Try to find matching athlete
        athlete = find_athlete_by_source_id(conn, source_id, source_system)
        
        if athlete:
            new_uuid = athlete['athlete_uuid']
            logger.info(f"    ✓ Found match: {athlete['name']} ({new_uuid})")
            
            result = update_orphaned_records(conn, table_name, old_uuid, new_uuid, dry_run)
            matched_count += 1
            updated_count += result['updated']
            deleted_count += result['deleted']
            total_rows_processed += result['total']
        else:
            # Try fuzzy matching for initials or partial matches
            # Check if source_athlete_id could match any athlete's normalized name
            from python.common.athlete_cleanup import clean_and_normalize_name
            
            # Try to find by checking if source_athlete_id is contained in any normalized name
            # or if initials match (e.g., "BW" could match "BOBBY WAHL")
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                # Get all athletes (don't filter by source_system for fuzzy matching
                # since athletes can have data in multiple systems)
                cur.execute('''
                    SELECT athlete_uuid, name, normalized_name, source_system, source_athlete_id
                    FROM analytics.d_athletes
                ''')
                
                all_athletes = cur.fetchall()
                
                # Try to match by checking if source_id appears in normalized_name
                # or if it's initials that match the start of words
                best_match = None
                source_id_upper = source_id.upper()
                
                for athlete in all_athletes:
                    athlete_norm = athlete['normalized_name']
                    
                    # Strategy 1: Check if source_id is contained in normalized name
                    if source_id_upper in athlete_norm:
                        # Prefer exact match on source_athlete_id field
                        if athlete.get('source_athlete_id') and source_id_upper in athlete['source_athlete_id'].upper():
                            best_match = athlete
                            break
                        elif not best_match:
                            best_match = athlete
                    
                    # Strategy 2: Check if source_id matches initials pattern
                    # e.g., "BW" matches "BOBBY WAHL" (first letter of each word)
                    if len(source_id) <= 3 and source_id.isalpha():
                        # Extract initials from normalized name
                        words = athlete_norm.split()
                        initials = ''.join([w[0] for w in words if w])
                        if initials == source_id_upper:
                            best_match = athlete
                            break
                
                if best_match:
                    new_uuid = best_match['athlete_uuid']
                    logger.info(f"    ✓ Found fuzzy match: {best_match['name']} ({new_uuid})")
                    logger.info(f"      (Matched '{source_id}' to '{best_match['normalized_name']}')")
                    
                    result = update_orphaned_records(conn, table_name, old_uuid, new_uuid, dry_run)
                    matched_count += 1
                    updated_count += result['updated']
                    deleted_count += result['deleted']
                    total_rows_processed += result['total']
                else:
                    logger.warning(f"    ✗ No match found for source_id '{source_id}' in system '{source_system}'")
                    unmatched_count += 1
    
    return {
        'table': table_name,
        'orphaned_found': len(orphaned),
        'matched': matched_count,
        'updated': updated_count,
        'deleted': deleted_count,
        'total_processed': total_rows_processed,
        'unmatched': unmatched_count
    }


def main():
    """Main execution function."""
    import argparse
    
    parser = argparse.ArgumentParser(
        description='Fix orphaned records in pitching and hitting tables'
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
        help='Specific table to fix (default: all kinematics tables)'
    )
    
    args = parser.parse_args()
    
    logger.info("=" * 80)
    logger.info("FIXING ORPHANED RECORDS IN KINEMATICS TABLES")
    logger.info("=" * 80)
    if args.dry_run:
        logger.info("DRY RUN MODE - No changes will be made")
    logger.info("")
    
    conn = get_warehouse_connection()
    
    try:
        # Tables to check
        tables = ['f_kinematics_pitching', 'f_kinematics_hitting']
        
        if args.table:
            if args.table not in tables:
                logger.error(f"Invalid table: {args.table}. Must be one of: {', '.join(tables)}")
                return 1
            tables = [args.table]
        
        results = []
        for table in tables:
            result = fix_orphaned_records_for_table(conn, table, dry_run=args.dry_run)
            results.append(result)
        
        # Summary
        logger.info("\n" + "=" * 80)
        logger.info("SUMMARY")
        logger.info("=" * 80)
        
        total_orphaned = sum(r['orphaned_found'] for r in results)
        total_matched = sum(r['matched'] for r in results)
        total_updated = sum(r['updated'] for r in results)
        total_deleted = sum(r['deleted'] for r in results)
        total_processed = sum(r['total_processed'] for r in results)
        total_unmatched = sum(r['unmatched'] for r in results)
        
        for result in results:
            logger.info(f"\n{result['table']}:")
            logger.info(f"  Orphaned UUID groups found: {result['orphaned_found']}")
            logger.info(f"  Matched: {result['matched']}")
            logger.info(f"  Rows updated: {result['updated']}")
            logger.info(f"  Duplicates deleted: {result['deleted']}")
            logger.info(f"  Total rows processed: {result['total_processed']}")
            logger.info(f"  Unmatched: {result['unmatched']}")
        
        logger.info(f"\nTOTALS:")
        logger.info(f"  Orphaned UUID groups: {total_orphaned}")
        logger.info(f"  Matched: {total_matched}")
        logger.info(f"  Rows updated: {total_updated}")
        logger.info(f"  Duplicates deleted: {total_deleted}")
        logger.info(f"  Total rows processed: {total_processed}")
        logger.info(f"  Unmatched: {total_unmatched}")
        
        if total_unmatched > 0:
            logger.warning(f"\n{total_unmatched} orphaned UUID groups could not be matched.")
            logger.warning("These may need manual investigation.")
        
        logger.info("=" * 80)
        
        if args.dry_run:
            logger.info("\nRun without --dry-run to apply changes")
        
        return 0
        
    except Exception as e:
        logger.exception(f"Error: {e}")
        return 1
    finally:
        conn.close()


if __name__ == '__main__':
    sys.exit(main())

