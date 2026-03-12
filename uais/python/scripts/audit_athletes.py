#!/usr/bin/env python3
"""
Full Database Athlete Audit Script

This script performs a comprehensive audit of all athletes in the warehouse database:
1. Finds athletes with similar names (fuzzy matching)
2. Checks for missing app_db_uuid values
3. Identifies athletes with mismatched data (same name, different UUIDs)
4. Checks for data inconsistencies
5. Allows interactive merging of duplicate athletes

Usage:
    python python/scripts/audit_athletes.py
    python python/scripts/audit_athletes.py --min-similarity 0.85
    python python/scripts/audit_athletes.py --dry-run
    python python/scripts/audit_athletes.py --check-app-uuids-only
"""

import sys
import argparse
from pathlib import Path
from typing import List, Dict, Any, Tuple, Optional
from collections import defaultdict

project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from python.common.athlete_manager import get_warehouse_connection, get_app_engine
from python.common.duplicate_detector import (
    interactive_merge_prompt,
    get_athlete_summary
)
from python.common.source_athlete_map import get_all_source_mappings
from python.scripts.find_and_merge_similar_athletes import (
    find_similar_athletes,
    similarity_score,
    merge_similar_athletes,
    choose_canonical
)
from psycopg2.extras import RealDictCursor
import logging

logging.basicConfig(level=logging.INFO, format='%(levelname)s:%(name)s:%(message)s')
logger = logging.getLogger(__name__)


def get_all_athletes(conn) -> List[Dict[str, Any]]:
    """Get all athletes from the warehouse database."""
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute('''
            SELECT 
                athlete_uuid,
                name,
                normalized_name,
                app_db_uuid,
                source_system,
                source_athlete_id,
                date_of_birth,
                age,
                gender,
                height,
                weight,
                has_pitching_data,
                has_athletic_screen_data,
                has_pro_sup_data,
                has_readiness_screen_data,
                has_mobility_data,
                has_proteus_data,
                has_hitting_data,
                has_arm_action_data,
                has_curveball_test_data,
                pitching_session_count,
                athletic_screen_session_count,
                pro_sup_session_count,
                readiness_screen_session_count,
                mobility_session_count,
                proteus_session_count,
                hitting_session_count,
                arm_action_session_count,
                curveball_test_session_count,
                created_at,
                updated_at
            FROM analytics.d_athletes
            ORDER BY name
        ''')
        return [dict(row) for row in cur.fetchall()]


def check_missing_app_uuids(conn) -> List[Dict[str, Any]]:
    """
    Find athletes missing app_db_uuid values.
    
    Returns:
        List of athletes without app_db_uuid
    """
    athletes = get_all_athletes(conn)
    missing_uuids = [a for a in athletes if not a.get('app_db_uuid')]
    return missing_uuids


def check_exact_duplicate_names(conn) -> Dict[str, List[Dict[str, Any]]]:
    """
    Find athletes with exact same normalized_name (true duplicates).
    
    Returns:
        Dictionary mapping normalized_name to list of athlete records
    """
    athletes = get_all_athletes(conn)
    by_normalized = defaultdict(list)
    
    for athlete in athletes:
        normalized = athlete.get('normalized_name', '')
        if normalized:
            by_normalized[normalized].append(athlete)
    
    # Filter to only duplicates (more than 1 athlete per name)
    duplicates = {name: athletes_list for name, athletes_list in by_normalized.items() 
                  if len(athletes_list) > 1}
    
    return duplicates


def check_mismatched_data(conn) -> List[Dict[str, Any]]:
    """
    Find athletes with potential data mismatches.
    
    Checks for:
    - Same normalized_name but different DOB, age, gender, etc.
    - Same name but different app_db_uuid
    - Inconsistent demographic data
    
    Returns:
        List of issues found
    """
    issues = []
    athletes = get_all_athletes(conn)
    
    # Group by normalized_name
    by_normalized = defaultdict(list)
    for athlete in athletes:
        normalized = athlete.get('normalized_name', '')
        if normalized:
            by_normalized[normalized].append(athlete)
    
    # Check each group for mismatches
    for normalized_name, athlete_group in by_normalized.items():
        if len(athlete_group) <= 1:
            continue
        
        # Check for mismatched DOB
        dobs = [a.get('date_of_birth') for a in athlete_group if a.get('date_of_birth')]
        if len(set(dobs)) > 1:
            issues.append({
                'type': 'mismatched_dob',
                'normalized_name': normalized_name,
                'athletes': athlete_group,
                'message': f"Same name but different dates of birth: {set(dobs)}"
            })
        
        # Check for mismatched gender
        genders = [a.get('gender') for a in athlete_group if a.get('gender')]
        if len(set(genders)) > 1:
            issues.append({
                'type': 'mismatched_gender',
                'normalized_name': normalized_name,
                'athletes': athlete_group,
                'message': f"Same name but different genders: {set(genders)}"
            })
        
        # Check for mismatched app_db_uuid
        app_uuids = [a.get('app_db_uuid') for a in athlete_group if a.get('app_db_uuid')]
        if len(set(app_uuids)) > 1:
            issues.append({
                'type': 'mismatched_app_uuid',
                'normalized_name': normalized_name,
                'athletes': athlete_group,
                'message': f"Same name but different app_db_uuid values: {set(app_uuids)}"
            })
    
    return issues


def check_orphaned_records(conn) -> Dict[str, int]:
    """
    Check for orphaned records in fact tables (athlete_uuid not in d_athletes).
    
    Returns:
        Dictionary mapping table name to count of orphaned records
    """
    orphaned = {}
    fact_tables = [
        'f_kinematics_pitching',
        'f_kinematics_hitting',
        'f_athletic_screen_cmj',
        'f_athletic_screen_dj',
        'f_pro_sup',
        'f_readiness_screen',
        'f_mobility',
        'f_proteus',
        'f_arm_action',
        'f_curveball_test'
    ]
    
    with conn.cursor() as cur:
        # Get all valid athlete UUIDs
        cur.execute('SELECT athlete_uuid FROM analytics.d_athletes')
        valid_uuids = {row[0] for row in cur.fetchall()}
        
        for table in fact_tables:
            try:
                # Check if table exists
                cur.execute("""
                    SELECT EXISTS (
                        SELECT FROM information_schema.tables 
                        WHERE table_schema = 'public' 
                        AND table_name = %s
                    )
                """, (table,))
                
                if not cur.fetchone()[0]:
                    continue  # Table doesn't exist, skip
                
                # Count orphaned records
                if valid_uuids:
                    placeholders = ','.join(['%s'] * len(valid_uuids))
                    cur.execute(f"""
                        SELECT COUNT(*) 
                        FROM public.{table}
                        WHERE athlete_uuid NOT IN ({placeholders})
                    """, list(valid_uuids))
                else:
                    # No valid UUIDs, all records are orphaned
                    cur.execute(f"""
                        SELECT COUNT(*) 
                        FROM public.{table}
                    """)
                
                count = cur.fetchone()[0]
                if count > 0:
                    orphaned[table] = count
            except Exception as e:
                logger.warning(f"Could not check {table}: {e}")
                continue
    
    return orphaned


def print_audit_summary(
    total_athletes: int,
    missing_app_uuids: List[Dict[str, Any]],
    exact_duplicates: Dict[str, List[Dict[str, Any]]],
    similar_pairs: List[Tuple[Dict[str, Any], Dict[str, Any], float]],
    data_mismatches: List[Dict[str, Any]],
    orphaned_records: Dict[str, int]
):
    """Print a summary of all audit findings."""
    print("\n" + "=" * 80)
    print("ATHLETE AUDIT SUMMARY")
    print("=" * 80)
    print(f"Total athletes in database: {total_athletes}")
    print()
    
    # Missing app UUIDs
    print(f"Missing app_db_uuid: {len(missing_app_uuids)} athletes")
    if missing_app_uuids:
        print("  These athletes don't have an app_db_uuid value")
        print("  They may need to be matched with the app database")
    
    print()
    
    # Exact duplicates
    print(f"Exact duplicate names: {len(exact_duplicates)} groups")
    if exact_duplicates:
        total_duplicates = sum(len(athletes) - 1 for athletes in exact_duplicates.values())
        print(f"  Total duplicate records: {total_duplicates}")
        print("  These have identical normalized_name and should be merged")
    
    print()
    
    # Similar names
    print(f"Similar-named athletes: {len(similar_pairs)} potential matches")
    if similar_pairs:
        print("  These have similar names (fuzzy match) and may be duplicates")
    
    print()
    
    # Data mismatches
    print(f"Data mismatches: {len(data_mismatches)} issues")
    if data_mismatches:
        mismatch_types = defaultdict(int)
        for issue in data_mismatches:
            mismatch_types[issue['type']] += 1
        for issue_type, count in mismatch_types.items():
            print(f"  {issue_type}: {count}")
    
    print()
    
    # Orphaned records
    print(f"Orphaned records: {len(orphaned_records)} tables with issues")
    if orphaned_records:
        total_orphaned = sum(orphaned_records.values())
        print(f"  Total orphaned records: {total_orphaned}")
        for table, count in orphaned_records.items():
            print(f"    {table}: {count} records")
    
    print("=" * 80)


def interactive_audit_menu(conn, min_similarity: float = 0.80, dry_run: bool = False):
    """Interactive menu for handling audit findings."""
    athletes = get_all_athletes(conn)
    total_athletes = len(athletes)
    
    # Run all checks
    print("\nRunning full database audit...")
    print("=" * 80)
    
    missing_app_uuids = check_missing_app_uuids(conn)
    exact_duplicates = check_exact_duplicate_names(conn)
    data_mismatches = check_mismatched_data(conn)
    orphaned_records = check_orphaned_records(conn)
    
    # Find similar athletes (full DB scan)
    print("Finding similar-named athletes (this may take a moment)...")
    similar_pairs = find_similar_athletes(conn, min_similarity=min_similarity)
    
    # Print summary
    print_audit_summary(
        total_athletes,
        missing_app_uuids,
        exact_duplicates,
        similar_pairs,
        data_mismatches,
        orphaned_records
    )
    
    if dry_run:
        print("\n[DRY RUN MODE] - No changes will be made")
        return
    
    # Interactive menu
    while True:
        print("\n" + "=" * 80)
        print("AUDIT MENU")
        print("=" * 80)
        print("1. Review and merge similar-named athletes")
        print("2. Review and merge exact duplicate names")
        print("3. Review data mismatches")
        print("4. Review missing app_db_uuid values")
        print("5. Review orphaned records")
        print("6. Show full summary again")
        print("7. Exit")
        print("=" * 80)
        
        try:
            choice = input("\nEnter choice (1-7): ").strip()
            
            if choice == '1':
                # Handle similar-named athletes
                if not similar_pairs:
                    print("\nNo similar-named athletes found!")
                    continue
                
                print(f"\nFound {len(similar_pairs)} potential matches")
                merged_count = 0
                skipped_count = 0
                
                for athlete1, athlete2, similarity in similar_pairs:
                    result = interactive_merge_prompt(athlete1, athlete2, similarity, conn)
                    
                    if result and result.get('skip_all'):
                        print("\nSkipping all remaining matches...")
                        skipped_count += len(similar_pairs) - merged_count - skipped_count
                        break
                    elif result and result.get('merged'):
                        merged_count += 1
                    else:
                        skipped_count += 1
                
                print(f"\nMerged: {merged_count}, Skipped: {skipped_count}")
                # Re-run checks after merging
                similar_pairs = find_similar_athletes(conn, min_similarity=min_similarity)
            
            elif choice == '2':
                # Handle exact duplicates
                if not exact_duplicates:
                    print("\nNo exact duplicate names found!")
                    continue
                
                print(f"\nFound {len(exact_duplicates)} groups of exact duplicates")
                total_duplicate_records = sum(len(athletes) - 1 for athletes in exact_duplicates.values())
                print(f"Total duplicate records to merge: {total_duplicate_records}")
                
                print("\nFirst 10 groups:")
                for normalized_name, athlete_group in list(exact_duplicates.items())[:10]:
                    print(f"\n{normalized_name}: {len(athlete_group)} duplicates")
                    for athlete in athlete_group:
                        data_systems = []
                        if athlete.get('has_pitching_data'):
                            data_systems.append("Pitching")
                        if athlete.get('has_athletic_screen_data'):
                            data_systems.append("Athletic Screen")
                        if athlete.get('has_pro_sup_data'):
                            data_systems.append("Pro-Sup")
                        if athlete.get('has_readiness_screen_data'):
                            data_systems.append("Readiness Screen")
                        if athlete.get('has_mobility_data'):
                            data_systems.append("Mobility")
                        if athlete.get('has_proteus_data'):
                            data_systems.append("Proteus")
                        if athlete.get('has_hitting_data'):
                            data_systems.append("Hitting")
                        if athlete.get('has_arm_action_data'):
                            data_systems.append("Arm Action")
                        if athlete.get('has_curveball_test_data'):
                            data_systems.append("Curveball Test")
                        
                        data_summary = ", ".join(data_systems) if data_systems else "No data"
                        app_uuid = athlete.get('app_db_uuid', 'None')
                        print(f"  - {athlete['name']} ({athlete['athlete_uuid']})")
                        print(f"    App UUID: {app_uuid}, Data: {data_summary}")
                
                if len(exact_duplicates) > 10:
                    print(f"\n... and {len(exact_duplicates) - 10} more groups")
                
                print("\n" + "=" * 80)
                print("Note: Exact duplicates should be handled by deduplicate_athletes()")
                print("=" * 80)
                print("To merge these duplicates, run:")
                print("  from python.common.athlete_cleanup import deduplicate_athletes")
                print("  deduplicate_athletes(dry_run=False)")
                print("\nOr use the interactive merge option (option 1) for similar names")
            
            elif choice == '3':
                # Handle data mismatches
                if not data_mismatches:
                    print("\nNo data mismatches found!")
                    continue
                
                print(f"\nFound {len(data_mismatches)} data mismatch issues")
                for i, issue in enumerate(data_mismatches[:10], 1):  # Show first 10
                    print(f"\n{i}. {issue['type']}: {issue['normalized_name']}")
                    print(f"   {issue['message']}")
                    print("   Athletes:")
                    for athlete in issue['athletes']:
                        print(f"     - {athlete['name']} ({athlete['athlete_uuid']})")
                        if athlete.get('app_db_uuid'):
                            print(f"       app_db_uuid: {athlete['app_db_uuid']}")
                
                if len(data_mismatches) > 10:
                    print(f"\n... and {len(data_mismatches) - 10} more issues")
            
            elif choice == '4':
                # Handle missing app UUIDs
                if not missing_app_uuids:
                    print("\nAll athletes have app_db_uuid values!")
                    continue
                
                print(f"\nFound {len(missing_app_uuids)} athletes without app_db_uuid")
                print("\nFirst 20 athletes:")
                for athlete in missing_app_uuids[:20]:
                    data_systems = []
                    if athlete.get('has_pitching_data'):
                        data_systems.append("Pitching")
                    if athlete.get('has_athletic_screen_data'):
                        data_systems.append("Athletic Screen")
                    if athlete.get('has_pro_sup_data'):
                        data_systems.append("Pro-Sup")
                    if athlete.get('has_readiness_screen_data'):
                        data_systems.append("Readiness Screen")
                    if athlete.get('has_mobility_data'):
                        data_systems.append("Mobility")
                    if athlete.get('has_proteus_data'):
                        data_systems.append("Proteus")
                    if athlete.get('has_hitting_data'):
                        data_systems.append("Hitting")
                    
                    data_summary = ", ".join(data_systems) if data_systems else "No data"
                    print(f"  - {athlete['name']} ({athlete['athlete_uuid']}) - {data_summary}")
                
                if len(missing_app_uuids) > 20:
                    print(f"\n... and {len(missing_app_uuids) - 20} more athletes")
                
                print("\nNote: Use backfill_uuids_from_verceldb() to attempt to match these")
            
            elif choice == '5':
                # Handle orphaned records
                if not orphaned_records:
                    print("\nNo orphaned records found!")
                    continue
                
                print(f"\nFound orphaned records in {len(orphaned_records)} tables:")
                total_orphaned = sum(orphaned_records.values())
                print(f"Total orphaned records: {total_orphaned}")
                for table, count in orphaned_records.items():
                    print(f"  - {table}: {count} records")
                
                print("\nNote: Orphaned records should be cleaned up manually")
                print("These are records in fact tables that reference non-existent athletes")
            
            elif choice == '6':
                # Show summary again
                print_audit_summary(
                    total_athletes,
                    missing_app_uuids,
                    exact_duplicates,
                    similar_pairs,
                    data_mismatches,
                    orphaned_records
                )
            
            elif choice == '7':
                print("\nExiting audit...")
                break
            
            else:
                print("Invalid choice. Please enter 1-7.")
        
        except KeyboardInterrupt:
            print("\n\nInterrupted by user. Exiting...")
            break
        except Exception as e:
            logger.error(f"Error in menu: {e}")
            import traceback
            traceback.print_exc()


def main():
    """Main execution function."""
    parser = argparse.ArgumentParser(
        description='Full database athlete audit - checks for duplicates, mismatches, and issues'
    )
    parser.add_argument(
        '--min-similarity',
        type=float,
        default=0.80,
        help='Minimum similarity score (0.0 to 1.0) for similar names (default: 0.80)'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Show audit results without interactive menu'
    )
    parser.add_argument(
        '--check-app-uuids-only',
        action='store_true',
        help='Only check for missing app_db_uuid values'
    )
    
    args = parser.parse_args()
    
    logger.info("=" * 80)
    logger.info("FULL DATABASE ATHLETE AUDIT")
    logger.info("=" * 80)
    if args.dry_run:
        logger.info("DRY RUN MODE - No changes will be made")
    logger.info(f"Minimum similarity: {args.min_similarity:.1%}")
    logger.info("")
    
    conn = get_warehouse_connection()
    
    try:
        if args.check_app_uuids_only:
            # Quick check for missing app UUIDs only
            missing_uuids = check_missing_app_uuids(conn)
            print(f"\nAthletes without app_db_uuid: {len(missing_uuids)}")
            if missing_uuids:
                print("\nFirst 20:")
                for athlete in missing_uuids[:20]:
                    print(f"  - {athlete['name']} ({athlete['athlete_uuid']})")
                if len(missing_uuids) > 20:
                    print(f"\n... and {len(missing_uuids) - 20} more")
        else:
            # Full audit
            interactive_audit_menu(conn, min_similarity=args.min_similarity, dry_run=args.dry_run)
        
        return 0
        
    except KeyboardInterrupt:
        logger.info("\n\nInterrupted by user. Exiting...")
        return 1
    except Exception as e:
        logger.exception(f"Error: {e}")
        return 1
    finally:
        conn.close()


if __name__ == '__main__':
    sys.exit(main())
