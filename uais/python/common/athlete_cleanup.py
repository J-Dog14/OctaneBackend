#!/usr/bin/env python3
"""
Athlete Cleanup and Deduplication Module

This module provides functions to:
- Clean and normalize athlete names (remove dates, handle comma format, remove numbers/initials)
- Find and consolidate duplicate athletes
- Match with verceldb UUIDs and update across all tables
- Can be called during ETL processing or run standalone

Usage:
    from python.common.athlete_cleanup import clean_and_normalize_name, deduplicate_athletes
    
    # Clean a name
    cleaned = clean_and_normalize_name("Weiss, Ryan 11-25")  # Returns "Ryan Weiss"
    
    # Deduplicate all athletes in database
    result = deduplicate_athletes(dry_run=True)
"""

import sys
import re
import logging
from pathlib import Path
from typing import Optional, Dict, Any, List, Tuple
from collections import defaultdict

# Add project root to path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from python.common.athlete_manager import (
    get_warehouse_connection,
    get_verceldb_connection,
    check_verceldb_for_uuid,
    normalize_name_for_matching,
    update_uuid_across_tables
)
from psycopg2.extras import RealDictCursor

logging.basicConfig(level=logging.INFO, format='%(levelname)s:%(name)s:%(message)s')
logger = logging.getLogger(__name__)


def clean_and_normalize_name(name: str) -> str:
    """
    Clean and normalize athlete name for deduplication.
    
    Rules:
    1. Remove all dates (MM-DD, MM/DD, etc.) - can be anywhere in the name
    2. Remove initials (1-3 uppercase letters) at the end or beginning
    3. Remove all numbers
    4. If comma present, assume format is "LAST, FIRST" and convert to "FIRST LAST"
    5. Default format is "FIRST LAST" (no comma)
    6. Normalize whitespace
    7. Convert to uppercase for matching
    
    Args:
        name: Original name (e.g., "Weiss, Ryan 11-25", "Bobby 06-24 Wahl", 
              "GAVIN 04-28 LARSEN", "GRAHAM LAMBERT GL", "Elijah Benton EB")
        
    Returns:
        Cleaned normalized name (e.g., "RYAN WEISS", "BOBBY WAHL", "GAVIN LARSEN", "GRAHAM LAMBERT")
    """
    if not name or name.strip() == "":
        return ""
    
    # Remove dates anywhere in the name (MM-DD, MM/DD format)
    # This handles dates between names like "GAVIN 04-28 LARSEN"
    name = re.sub(r'\s*\d{1,2}[/-]\d{1,2}(?![/-]\d)', '', name)  # MM-DD or MM/DD (not part of full date)
    name = re.sub(r'\s*\d{1,2}[/-]\d{1,2}[/-]\d{2,4}', '', name)  # Full dates MM-DD-YYYY
    name = re.sub(r'\s*\d{4}[/-]\d{1,2}[/-]\d{1,2}', '', name)  # YYYY-MM-DD
    
    # Remove all remaining numbers
    name = re.sub(r'\d+', '', name)
    
    # Remove trailing initials (1-3 uppercase letters at end) like " GL", " EB", " JK"
    # But NOT if it's part of a name like "CJ" or "JT" at the start
    # Pattern: space followed by 1-3 uppercase letters at the end
    name = re.sub(r'\s+[A-Z]{1,3}\s*$', '', name)
    
    # Remove standalone initials (1-3 uppercase letters surrounded by spaces)
    # This handles cases like "GRAHAM LAMBERT GL" where GL is separate
    # But NOT if it's at the start (like "CJ Guadet" or "JT Williams")
    # Pattern: space, 1-3 uppercase letters, space (not at start or end)
    name = re.sub(r'(?<!^)\s+[A-Z]{1,3}\s+(?!$)', ' ', name)  # Replace with single space, but not at start/end
    
    name = name.strip()
    
    # Handle comma format: "LAST, FIRST" or "LAST. FIRST" (typo) -> "FIRST LAST"
    if ',' in name:
        parts = name.split(',')
        if len(parts) == 2:
            last = parts[0].strip()
            first = parts[1].strip()
            name = f"{first} {last}"
    elif '.' in name:
        parts = name.split('.', 1)
        if len(parts) == 2 and parts[0].strip() and parts[1].strip():
            last = parts[0].strip()
            first = parts[1].strip()
            name = f"{first} {last}"
    
    # Normalize whitespace (remove extra spaces)
    name = ' '.join(name.split())
    
    # Convert to uppercase for matching
    name = name.upper()
    
    return name


def get_athlete_canonical_uuid(athletes: List[Dict[str, Any]], conn) -> Tuple[str, Dict[str, Any]]:
    """
    Determine the canonical UUID for a group of duplicate athletes.
    
    Priority:
    1. UUID that exists in verceldb (master source of truth)
    2. UUID that already has app_db_uuid set
    3. Oldest created_at record
    
    Args:
        athletes: List of athlete dictionaries (duplicates)
        conn: Database connection
        
    Returns:
        Tuple of (canonical_uuid, canonical_athlete_dict)
    """
    # First, check verceldb for the normalized name
    # All athletes in this group should normalize to the same name
    if not athletes:
        raise ValueError("Cannot determine canonical UUID for empty athlete list")
    
    normalized = clean_and_normalize_name(athletes[0]['name'])
    verceldb_uuid = check_verceldb_for_uuid(normalized)
    
    # Priority 1: Use UUID from verceldb if found
    if verceldb_uuid:
        # Check if any athlete in the group already has this UUID
        for athlete in athletes:
            if athlete['athlete_uuid'] == verceldb_uuid:
                return verceldb_uuid, athlete
        # If verceldb UUID doesn't exist in our duplicates, use the first one
        # (we'll update it to verceldb UUID later)
        return verceldb_uuid, athletes[0]
    
    # Priority 2: Use UUID that has app_db_uuid set
    for athlete in athletes:
        if athlete.get('app_db_uuid'):
            return athlete['athlete_uuid'], athlete
    
    # Priority 3: Prefer athlete with cleaner name (no dates, no trailing initials)
    # Check if any athlete has a name that matches the cleaned normalized name exactly
    for athlete in athletes:
        athlete_cleaned = clean_and_normalize_name(athlete['name'])
        if athlete_cleaned == normalized and athlete_cleaned == athlete.get('normalized_name', '').upper():
            # This athlete's name is already clean
            return athlete['athlete_uuid'], athlete
    
    # Priority 4: Use oldest record (earliest created_at)
    athletes_sorted = sorted(athletes, key=lambda x: x.get('created_at', ''))
    return athletes_sorted[0]['athlete_uuid'], athletes_sorted[0]


def merge_athlete_data(canonical: Dict[str, Any], duplicates: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Merge data from duplicate athletes into canonical record.
    
    Uses COALESCE logic: prefer canonical value, fall back to duplicate if canonical is NULL.
    
    Args:
        canonical: The canonical athlete record
        duplicates: List of duplicate athlete records to merge from
        
    Returns:
        Dictionary with merged data
    """
    merged = canonical.copy()
    
    for dup in duplicates:
        # Skip if it's the canonical record itself
        if dup['athlete_uuid'] == canonical['athlete_uuid']:
            continue
        
        # Merge fields (prefer canonical, use duplicate if canonical is NULL)
        for field in ['name', 'date_of_birth', 'age', 'age_at_collection', 'gender', 
                     'height', 'weight', 'notes', 'app_db_uuid', 'source_system', 
                     'source_athlete_id']:
            if field in dup and (merged.get(field) is None or merged.get(field) == ''):
                if dup.get(field) is not None and dup.get(field) != '':
                    merged[field] = dup[field]
    
    # Clean the name
    if merged.get('name'):
        # Use normalize_name_for_display to get clean "First Last" format
        from python.common.athlete_manager import normalize_name_for_display
        merged['name'] = normalize_name_for_display(merged['name'])
    
    return merged


def find_duplicate_athletes(conn) -> Dict[str, List[Dict[str, Any]]]:
    """
    Find all duplicate athletes based on cleaned normalized names.
    
    Args:
        conn: Database connection
        
    Returns:
        Dictionary mapping normalized_name -> list of athlete records
    """
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute('''
            SELECT 
                athlete_uuid,
                name,
                normalized_name,
                date_of_birth,
                age,
                age_at_collection,
                gender,
                height,
                weight,
                notes,
                app_db_uuid,
                source_system,
                source_athlete_id,
                created_at
            FROM analytics.d_athletes
            ORDER BY created_at
        ''')
        
        all_athletes = cur.fetchall()
    
    # Group by cleaned normalized name
    by_cleaned_name = defaultdict(list)
    for athlete in all_athletes:
        cleaned_name = clean_and_normalize_name(athlete['name'])
        if cleaned_name:  # Skip empty names
            by_cleaned_name[cleaned_name].append(dict(athlete))
    
    # Filter to only duplicates (groups with more than 1 athlete)
    duplicates = {name: athletes for name, athletes in by_cleaned_name.items() 
                  if len(athletes) > 1}
    
    return duplicates


def consolidate_duplicate_group(
    normalized_name: str,
    athletes: List[Dict[str, Any]],
    conn,
    dry_run: bool = False
) -> Dict[str, Any]:
    """
    Consolidate a group of duplicate athletes into one canonical record.
    
    Args:
        normalized_name: The cleaned normalized name for this group
        athletes: List of duplicate athlete records
        conn: Database connection
        dry_run: If True, only report what would be done
        
    Returns:
        Dictionary with consolidation results
    """
    logger.info(f"\nProcessing duplicates for: {normalized_name}")
    logger.info(f"  Found {len(athletes)} duplicate records")
    
    # Determine canonical UUID
    canonical_uuid, canonical_athlete = get_athlete_canonical_uuid(athletes, conn)
    
    logger.info(f"  Canonical UUID: {canonical_uuid}")
    logger.info(f"  Canonical name: {canonical_athlete['name']}")
    
    # Check if canonical UUID needs to be updated from verceldb
    cleaned_name = clean_and_normalize_name(canonical_athlete['name'])
    verceldb_uuid = check_verceldb_for_uuid(cleaned_name)
    
    final_canonical_uuid = canonical_uuid
    if verceldb_uuid and verceldb_uuid != canonical_uuid:
        logger.info(f"  Found verceldb UUID: {verceldb_uuid} (different from canonical)")
        final_canonical_uuid = verceldb_uuid
    
    # Merge data from all duplicates
    merged_data = merge_athlete_data(canonical_athlete, athletes)
    
    # Update canonical record with merged data
    if not dry_run:
        # If canonical UUID needs to change, update across all tables FIRST
        if final_canonical_uuid != canonical_uuid:
            logger.info(f"  Updating UUID from {canonical_uuid} to {final_canonical_uuid} across all tables...")
            update_uuid_across_tables(canonical_uuid, final_canonical_uuid, conn)
            canonical_uuid = final_canonical_uuid
        
        # Update all duplicate records to use canonical UUID, then delete them
        # IMPORTANT: Delete duplicates BEFORE updating canonical normalized_name to avoid unique constraint violation
        duplicate_uuids = [a['athlete_uuid'] for a in athletes if a['athlete_uuid'] != canonical_uuid]
        
        # CRITICAL: Merge source_athlete_id mappings BEFORE deleting duplicates
        # This preserves ALL source_athlete_id values across all source systems
        if duplicate_uuids:
            logger.info(f"  Preserving source_athlete_id mappings from {len(duplicate_uuids)} duplicate(s)...")
            from python.common.source_athlete_map import merge_source_mappings
            mappings_merged = merge_source_mappings(conn, canonical_uuid, duplicate_uuids, dry_run)
            logger.info(f"  Merged {mappings_merged} source_athlete_id mapping(s)")
        
        # Update fact tables for all duplicates at once (more efficient)
        if duplicate_uuids:
            logger.info(f"  Updating fact tables for {len(duplicate_uuids)} duplicate(s)...")
            update_fact_tables_only(duplicate_uuids, canonical_uuid, conn)
        
        # Delete duplicate records from d_athletes
        for dup_uuid in duplicate_uuids:
            with conn.cursor() as cur:
                cur.execute('''
                    DELETE FROM analytics.d_athletes
                    WHERE athlete_uuid = %s
                ''', (dup_uuid,))
                logger.info(f"  Deleted duplicate record: {dup_uuid}")
        
        # NOW update canonical record with merged data (after duplicates are deleted)
        with conn.cursor() as cur:
            # Build UPDATE query
            updates = []
            params = []
            
            # Update name (cleaned)
            if merged_data.get('name'):
                updates.append("name = %s")
                params.append(merged_data['name'])
            
            # Update normalized_name (use cleaned version) - safe now that duplicates are deleted
            updates.append("normalized_name = %s")
            params.append(cleaned_name)
            
            # Update other fields (only if not NULL in merged data)
            for field in ['date_of_birth', 'age', 'age_at_collection', 'gender', 
                         'height', 'weight', 'notes', 'source_system', 'source_athlete_id']:
                if field in merged_data and merged_data[field] is not None:
                    updates.append(f"{field} = %s")
                    params.append(merged_data[field])
            
            # Always update app_db_uuid if we have verceldb UUID
            if verceldb_uuid:
                updates.append("app_db_uuid = %s, app_db_synced_at = NOW()")
                params.append(verceldb_uuid)
            
            if updates:
                params.append(canonical_uuid)
                query = f'''
                    UPDATE analytics.d_athletes
                    SET {', '.join(updates)}
                    WHERE athlete_uuid = %s
                '''
                cur.execute(query, params)
        
        conn.commit()
    else:
        logger.info(f"  [DRY RUN] Would consolidate {len(athletes)} records to UUID: {canonical_uuid}")
        for athlete in athletes:
            if athlete['athlete_uuid'] != canonical_uuid:
                logger.info(f"    - Would merge {athlete['name']} ({athlete['athlete_uuid']}) into canonical")
    
    return {
        'normalized_name': normalized_name,
        'canonical_uuid': canonical_uuid,
        'duplicates_merged': len(athletes) - 1,
        'verceldb_matched': verceldb_uuid is not None
    }


def deduplicate_athletes(conn=None, dry_run: bool = False, clean_names_first: bool = True) -> Dict[str, Any]:
    """
    Main function to deduplicate all athletes in the database.
    
    This function:
    1. Optionally cleans all athlete names first (removes dates, initials)
    2. Finds all duplicate athletes based on cleaned normalized names
    3. For each duplicate group:
       - Determines canonical UUID (prefer verceldb match)
       - Merges data from duplicates
       - Updates all fact tables to use canonical UUID
       - Deletes duplicate records
       - Updates canonical record with cleaned name
    
    Args:
        conn: Optional database connection
        dry_run: If True, only report what would be done
        clean_names_first: If True, clean all names before deduplicating (default: True)
        
    Returns:
        Dictionary with summary statistics
    """
    close_conn = False
    if conn is None:
        conn = get_warehouse_connection()
        close_conn = True
    
    try:
        logger.info("=" * 80)
        logger.info("ATHLETE DEDUPLICATION AND CLEANUP")
        logger.info("=" * 80)
        if dry_run:
            logger.info("DRY RUN MODE - No changes will be made")
        logger.info("")
        
        # Step 0: Clean names first (if requested)
        # Note: This will skip names that would create duplicates - those will be handled by deduplication
        if clean_names_first:
            logger.info("Step 0: Cleaning athlete names (removing dates, initials)...")
            logger.info("  (Skipping names that would create duplicates - will be handled in deduplication)")
            name_cleanup_result = clean_existing_athlete_names(conn=conn, dry_run=dry_run)
            logger.info(f"  Names updated: {name_cleanup_result['updated']}")
            logger.info("")
        
        # Find duplicates (based on cleaned normalized names)
        logger.info("Step 1: Finding duplicate athletes...")
        duplicates = find_duplicate_athletes(conn)
        logger.info(f"Found {len(duplicates)} groups of duplicate athletes")
        
        if not duplicates:
            logger.info("No duplicates found!")
            return {
                'duplicate_groups': 0,
                'athletes_consolidated': 0,
                'verceldb_matches': 0
            }
        
        # Process each duplicate group
        logger.info("\nStep 2: Consolidating duplicates...")
        results = []
        total_consolidated = 0
        verceldb_matches = 0
        
        for normalized_name, athletes in sorted(duplicates.items()):
            result = consolidate_duplicate_group(normalized_name, athletes, conn, dry_run)
            results.append(result)
            total_consolidated += result['duplicates_merged']
            if result['verceldb_matched']:
                verceldb_matches += 1
        
        # Summary
        logger.info("\n" + "=" * 80)
        logger.info("DEDUPLICATION SUMMARY")
        logger.info("=" * 80)
        logger.info(f"Duplicate groups processed: {len(duplicates)}")
        logger.info(f"Total athletes consolidated: {total_consolidated}")
        logger.info(f"Verceldb UUID matches: {verceldb_matches}")
        logger.info("=" * 80)
        
        return {
            'duplicate_groups': len(duplicates),
            'athletes_consolidated': total_consolidated,
            'verceldb_matches': verceldb_matches,
            'results': results
        }
        
    finally:
        if close_conn:
            conn.close()


def update_fact_tables_only(old_uuids: List[str], new_uuid: str, conn) -> None:
    """
    Update fact tables only (not d_athletes) to use new UUID.
    Used when merging duplicates - we don't want to update d_athletes.
    
    Args:
        old_uuids: List of old UUIDs to replace
        new_uuid: New UUID to use
        conn: Database connection
    """
    fact_tables = [
        'f_athletic_screen',
        'f_athletic_screen_cmj',
        'f_athletic_screen_dj',
        'f_athletic_screen_slv',
        'f_athletic_screen_nmt',
        'f_athletic_screen_ppu',
        'f_pro_sup',
        'f_readiness_screen',
        'f_readiness_screen_i',
        'f_readiness_screen_y',
        'f_readiness_screen_t',
        'f_readiness_screen_ir90',
        'f_readiness_screen_cmj',
        'f_readiness_screen_ppu',
        'f_mobility',
        'f_proteus',
        'f_kinematics_pitching',
        'f_kinematics_hitting',
        'f_arm_action',
        'f_curveball_test'
    ]
    
    with conn.cursor() as cur:
        for table in fact_tables:
            try:
                # Check if table exists and has athlete_uuid column
                cur.execute('''
                    SELECT COUNT(*) 
                    FROM information_schema.columns 
                    WHERE table_schema = 'public' 
                    AND table_name = %s 
                    AND column_name = 'athlete_uuid'
                ''', (table,))
                
                if cur.fetchone()[0] == 0:
                    continue
                
                # Update athlete_uuid in this table for all old UUIDs
                placeholders = ','.join(['%s'] * len(old_uuids))
                cur.execute(f'''
                    UPDATE public.{table}
                    SET athlete_uuid = %s
                    WHERE athlete_uuid IN ({placeholders})
                ''', [new_uuid] + old_uuids)
                
                rows_updated = cur.rowcount
                if rows_updated > 0:
                    logger.info(f"    Updated {table}: {rows_updated} row(s)")
                    
            except Exception as e:
                logger.warning(f"    Error updating {table}: {e}")
                continue


def clean_athlete_name_for_processing(name: str) -> Tuple[str, str]:
    """
    Clean athlete name for use during ETL processing.
    
    This function should be called every time an athlete is processed.
    It returns both the cleaned display name and normalized name for matching.
    
    Args:
        name: Original name (e.g., "Weiss, Ryan 11-25", "Bobby 06-24 Wahl", "Elijah Benton EB")
        
    Returns:
        Tuple of (cleaned_display_name, normalized_name)
        - cleaned_display_name: "First Last" format for storage
        - normalized_name: Uppercase normalized for matching
    """
    # Clean the name (removes dates, numbers, handles comma format)
    cleaned = clean_and_normalize_name(name)
    
    # Convert back to "First Last" format for display (title case)
    display_name = ' '.join(word.capitalize() for word in cleaned.split())
    
    return display_name, cleaned


def clean_existing_athlete_names(conn=None, dry_run: bool = False) -> Dict[str, Any]:
    """
    Clean existing athlete names in the database.
    
    This function updates the name and normalized_name columns for all athletes
    to remove dates, initials, and normalize the format.
    
    Args:
        conn: Optional database connection
        dry_run: If True, only report what would be updated
        
    Returns:
        Dictionary with summary statistics
    """
    close_conn = False
    if conn is None:
        conn = get_warehouse_connection()
        close_conn = True
    
    try:
        logger.info("=" * 80)
        logger.info("CLEANING EXISTING ATHLETE NAMES")
        logger.info("=" * 80)
        if dry_run:
            logger.info("DRY RUN MODE - No changes will be made")
        logger.info("")
        
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # Get all athletes
            cur.execute('''
                SELECT athlete_uuid, name, normalized_name
                FROM analytics.d_athletes
                ORDER BY created_at
            ''')
            
            all_athletes = cur.fetchall()
        
        updated_count = 0
        unchanged_count = 0
        
        for athlete in all_athletes:
            original_name = athlete['name']
            original_normalized = athlete['normalized_name']
            
            # Clean the name
            cleaned_display, cleaned_normalized = clean_athlete_name_for_processing(original_name)
            
            # Check if name needs updating
            if cleaned_display != original_name or cleaned_normalized != original_normalized:
                # Check if cleaning would create a duplicate normalized_name
                # Query database to see if another athlete already has this normalized_name
                would_create_duplicate = False
                if not dry_run:
                    with conn.cursor() as cur:
                        cur.execute('''
                            SELECT COUNT(*) 
                            FROM analytics.d_athletes
                            WHERE normalized_name = %s
                              AND athlete_uuid != %s
                        ''', (cleaned_normalized, athlete['athlete_uuid']))
                        count = cur.fetchone()[0]
                        if count > 0:
                            would_create_duplicate = True
                            logger.debug(f"Skipping '{original_name}' - cleaning would create duplicate with existing '{cleaned_normalized}'")
                else:
                    # In dry run, check in-memory list
                    other_athletes_with_same_cleaned = [
                        a for a in all_athletes
                        if clean_athlete_name_for_processing(a['name'])[1] == cleaned_normalized
                        and a['athlete_uuid'] != athlete['athlete_uuid']
                    ]
                    if other_athletes_with_same_cleaned:
                        would_create_duplicate = True
                        logger.debug(f"Skipping '{original_name}' - cleaning would create duplicate with existing '{cleaned_normalized}'")
                
                if would_create_duplicate:
                    # Skip this one - deduplication will handle it
                    unchanged_count += 1
                    logger.debug(f"  Will be handled by deduplication")
                else:
                    updated_count += 1
                    logger.info(f"Updating: '{original_name}' -> '{cleaned_display}'")
                    logger.info(f"  Normalized: '{original_normalized}' -> '{cleaned_normalized}'")
                    
                    if not dry_run:
                        with conn.cursor() as cur:
                            cur.execute('''
                                UPDATE analytics.d_athletes
                                SET name = %s, normalized_name = %s
                                WHERE athlete_uuid = %s
                            ''', (cleaned_display, cleaned_normalized, athlete['athlete_uuid']))
                        conn.commit()
            else:
                unchanged_count += 1
        
        logger.info("\n" + "=" * 80)
        logger.info("NAME CLEANUP SUMMARY")
        logger.info("=" * 80)
        logger.info(f"Total athletes checked: {len(all_athletes)}")
        logger.info(f"Names updated: {updated_count}")
        logger.info(f"Names unchanged: {unchanged_count}")
        logger.info("=" * 80)
        
        return {
            'total_checked': len(all_athletes),
            'updated': updated_count,
            'unchanged': unchanged_count
        }
        
    finally:
        if close_conn:
            conn.close()


if __name__ == '__main__':
    import argparse
    
    parser = argparse.ArgumentParser(
        description='Athlete Cleanup and Deduplication'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Show what would be done without making changes'
    )
    parser.add_argument(
        '--clean-names',
        action='store_true',
        help='Clean existing athlete names in database (remove dates, initials)'
    )
    parser.add_argument(
        '--deduplicate',
        action='store_true',
        help='Deduplicate athletes (default action if no other action specified)'
    )
    
    args = parser.parse_args()
    
    # Default to deduplicate if no specific action
    if not args.clean_names and not args.deduplicate:
        args.deduplicate = True
    
    if args.clean_names:
        result = clean_existing_athlete_names(dry_run=args.dry_run)
        if args.dry_run:
            print("\nRun without --dry-run to apply changes")
    
    if args.deduplicate:
        # If --clean-names was also specified, don't clean names twice
        clean_names_first = not args.clean_names
        result = deduplicate_athletes(dry_run=args.dry_run, clean_names_first=clean_names_first)
        if args.dry_run:
            print("\nRun without --dry-run to apply changes")

