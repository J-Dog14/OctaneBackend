#!/usr/bin/env python3
"""
Reusable duplicate athlete detection and merging module.

This module provides functions to check for and merge similar-named athletes
after data insertion. Can be integrated into ETL pipelines.
"""

import sys
import logging
from pathlib import Path
from typing import List, Dict, Any, Tuple, Optional
from difflib import SequenceMatcher

# Add project root to path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from python.common.athlete_manager import get_warehouse_connection, NAME_SIMILARITY_THRESHOLD
from python.common.source_athlete_map import merge_source_mappings, get_all_source_mappings
from python.common.athlete_cleanup import update_fact_tables_only, clean_athlete_name_for_processing
from psycopg2.extras import RealDictCursor

logging.basicConfig(level=logging.INFO, format='%(levelname)s:%(name)s:%(message)s')
logger = logging.getLogger(__name__)


def similarity_score(name1: str, name2: str) -> float:
    """
    Calculate similarity score between two names (0.0 to 1.0).
    
    Uses SequenceMatcher for fuzzy matching.
    
    Args:
        name1: First name
        name2: Second name
        
    Returns:
        Similarity score (0.0 = completely different, 1.0 = identical)
    """
    return SequenceMatcher(None, name1.lower(), name2.lower()).ratio()


def get_athlete_summary(athlete: Dict[str, Any], conn) -> str:
    """
    Get a summary string for an athlete showing their data.
    
    Args:
        athlete: Athlete dictionary
        conn: Database connection
        
    Returns:
        Formatted summary string
    """
    data_systems = []
    if athlete.get('has_pitching_data'):
        data_systems.append(f"Pitching ({athlete.get('pitching_session_count', 0)} sessions)")
    if athlete.get('has_athletic_screen_data'):
        data_systems.append(f"Athletic Screen ({athlete.get('athletic_screen_session_count', 0)} sessions)")
    if athlete.get('has_pro_sup_data'):
        data_systems.append(f"Pro-Sup ({athlete.get('pro_sup_session_count', 0)} sessions)")
    if athlete.get('has_readiness_screen_data'):
        data_systems.append(f"Readiness Screen ({athlete.get('readiness_screen_session_count', 0)} sessions)")
    if athlete.get('has_mobility_data'):
        data_systems.append(f"Mobility ({athlete.get('mobility_session_count', 0)} sessions)")
    if athlete.get('has_proteus_data'):
        data_systems.append(f"Proteus ({athlete.get('proteus_session_count', 0)} sessions)")
    if athlete.get('has_hitting_data'):
        data_systems.append(f"Hitting ({athlete.get('hitting_session_count', 0)} sessions)")
    if athlete.get('has_arm_action_data'):
        data_systems.append(f"Arm Action ({athlete.get('arm_action_session_count', 0)} sessions)")
    if athlete.get('has_curveball_test_data'):
        data_systems.append(f"Curveball Test ({athlete.get('curveball_test_session_count', 0)} sessions)")
    
    data_summary = ", ".join(data_systems) if data_systems else "No data"
    
    # Get source mappings
    source_mappings = get_all_source_mappings(conn, athlete['athlete_uuid'])
    source_summary = ", ".join([f"{m['source_system']}:{m['source_athlete_id']}" 
                                for m in source_mappings[:3]])  # Show first 3
    if len(source_mappings) > 3:
        source_summary += f" (+{len(source_mappings) - 3} more)"
    
    summary = f"""
    Name: {athlete['name']}
    UUID: {athlete['athlete_uuid']}
    App DB UUID: {athlete.get('app_db_uuid', 'None')}
    Source System: {athlete.get('source_system', 'None')}
    Source ID: {athlete.get('source_athlete_id', 'None')}
    Source Mappings: {source_summary if source_mappings else 'None'}
    Data: {data_summary}
    Created: {athlete.get('created_at', 'Unknown')}
    """
    
    return summary


def choose_canonical(athlete1: Dict[str, Any], athlete2: Dict[str, Any]) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """
    Choose which athlete should be the canonical (kept) record.
    
    Priority:
    1. Has app_db_uuid
    2. More data (more systems with data)
    3. Older created_at
    
    Args:
        athlete1: First athlete
        athlete2: Second athlete
        
    Returns:
        Tuple of (canonical_athlete, duplicate_athlete)
    """
    # Priority 1: Has app_db_uuid
    if athlete1.get('app_db_uuid') and not athlete2.get('app_db_uuid'):
        return athlete1, athlete2
    if athlete2.get('app_db_uuid') and not athlete1.get('app_db_uuid'):
        return athlete2, athlete1
    
    # Priority 2: More data systems
    def count_data_systems(a):
        count = 0
        if a.get('has_pitching_data'): count += 1
        if a.get('has_athletic_screen_data'): count += 1
        if a.get('has_pro_sup_data'): count += 1
        if a.get('has_readiness_screen_data'): count += 1
        if a.get('has_mobility_data'): count += 1
        if a.get('has_proteus_data'): count += 1
        if a.get('has_hitting_data'): count += 1
        if a.get('has_arm_action_data'): count += 1
        if a.get('has_curveball_test_data'): count += 1
        return count
    
    count1 = count_data_systems(athlete1)
    count2 = count_data_systems(athlete2)
    
    if count1 > count2:
        return athlete1, athlete2
    if count2 > count1:
        return athlete2, athlete1
    
    # Priority 3: Older created_at
    created1 = athlete1.get('created_at', '')
    created2 = athlete2.get('created_at', '')
    
    if created1 and created2:
        if created1 < created2:
            return athlete1, athlete2
        else:
            return athlete2, athlete1
    
    # Default: use first one
    return athlete1, athlete2


def merge_similar_athletes(
    canonical: Dict[str, Any],
    duplicate: Dict[str, Any],
    correct_name: str,
    conn,
    dry_run: bool = False
) -> Dict[str, Any]:
    """
    Merge two similar athletes into one.
    
    Args:
        canonical: The canonical athlete record (to keep)
        duplicate: The duplicate athlete record (to merge into canonical)
        correct_name: The correct name to use (user-selected)
        conn: Database connection
        dry_run: If True, only report what would be done
        
    Returns:
        Dictionary with merge results
    """
    canonical_uuid = canonical['athlete_uuid']
    duplicate_uuid = duplicate['athlete_uuid']
    
    logger.info(f"\n{'[DRY RUN] ' if dry_run else ''}Merging athletes:")
    logger.info(f"  Canonical: {canonical['name']} ({canonical_uuid})")
    logger.info(f"  Duplicate: {duplicate['name']} ({duplicate_uuid})")
    logger.info(f"  Correct name: {correct_name}")
    
    if dry_run:
        return {
            'canonical_uuid': canonical_uuid,
            'duplicate_uuid': duplicate_uuid,
            'correct_name': correct_name,
            'merged': False
        }
    
    # Use a transaction to ensure all steps complete or none do
    try:
        # Step 1: Merge source_athlete_id mappings
        logger.info("  Step 1: Merging source_athlete_id mappings...")
        mappings_merged = merge_source_mappings(conn, canonical_uuid, [duplicate_uuid], dry_run=False)
        logger.info(f"    Merged {mappings_merged} source_athlete_id mapping(s)")
        
        # Step 2: Update fact tables to use canonical UUID
        logger.info("  Step 2: Updating fact tables...")
        update_fact_tables_only([duplicate_uuid], canonical_uuid, conn)
        
        # Step 3: Delete duplicate record FIRST (to avoid unique constraint violation on normalized_name)
        logger.info("  Step 3: Deleting duplicate record...")
        with conn.cursor() as cur:
            cur.execute('''
                DELETE FROM analytics.d_athletes
                WHERE athlete_uuid = %s
            ''', (duplicate_uuid,))
        
        # Step 4: Update canonical record with correct name (safe now that duplicate is deleted)
        logger.info("  Step 4: Updating canonical record with correct name...")
        cleaned_display, cleaned_normalized = clean_athlete_name_for_processing(correct_name)
        
        with conn.cursor() as cur:
            cur.execute('''
                UPDATE analytics.d_athletes
                SET name = %s,
                    normalized_name = %s,
                    updated_at = NOW()
                WHERE athlete_uuid = %s
            ''', (cleaned_display, cleaned_normalized, canonical_uuid))
        
        # Commit all changes together
        conn.commit()
        logger.info("  [OK] All merge steps committed to database")
        
        # Step 5: Update flags (after commit to ensure data is consistent)
        logger.info("  Step 5: Updating athlete flags...")
        from python.common.athlete_manager import update_athlete_flags
        update_athlete_flags(conn=conn, verbose=False)
        
        # Verify merge was successful
        with conn.cursor() as cur:
            cur.execute('''
                SELECT athlete_uuid FROM analytics.d_athletes WHERE athlete_uuid = %s
            ''', (duplicate_uuid,))
            if cur.fetchone():
                raise Exception(f"Merge verification failed: duplicate UUID {duplicate_uuid} still exists!")
            
            cur.execute('''
                SELECT name, normalized_name FROM analytics.d_athletes WHERE athlete_uuid = %s
            ''', (canonical_uuid,))
            result = cur.fetchone()
            if not result:
                raise Exception(f"Merge verification failed: canonical UUID {canonical_uuid} not found!")
            if result[1] != cleaned_normalized:
                logger.warning(f"Merge verification: normalized_name mismatch. Expected {cleaned_normalized}, got {result[1]}")
        
        logger.info("  [OK] Merge complete and verified!")
    except Exception as e:
        conn.rollback()
        logger.error(f"  [X] Merge failed, rolled back: {e}")
        raise
    
    return {
        'canonical_uuid': canonical_uuid,
        'duplicate_uuid': duplicate_uuid,
        'correct_name': correct_name,
        'merged': True,
        'mappings_merged': mappings_merged
    }


def interactive_merge_prompt(
    athlete1: Dict[str, Any],
    athlete2: Dict[str, Any],
    similarity: float,
    conn
) -> Optional[Dict[str, Any]]:
    """
    Interactive prompt to merge two similar athletes.
    
    Args:
        athlete1: First athlete
        athlete2: Second athlete
        similarity: Similarity score
        conn: Database connection
        
    Returns:
        Merge result dictionary if merged, None if skipped, or {'skip_all': True} to skip all remaining
    """
    print("\n" + "=" * 80)
    print(f"POTENTIAL MATCH FOUND (Similarity: {similarity:.1%})")
    print("=" * 80)
    
    print("\nATHLETE 1:")
    print(get_athlete_summary(athlete1, conn))
    
    print("\nATHLETE 2:")
    print(get_athlete_summary(athlete2, conn))
    
    print("\n" + "=" * 80)
    print("Are these the same person?")
    print("  1. Yes - merge them (you'll choose the correct name)")
    print("  2. No - skip this match")
    print("  3. Skip all remaining matches")
    print("=" * 80)
    
    while True:
        try:
            choice = input("\nEnter choice (1/2/3): ").strip()
            
            if choice == '1':
                # User wants to merge - ask for correct name
                print("\nWhich name is correct?")
                print(f"  1. {athlete1['name']}")
                print(f"  2. {athlete2['name']}")
                print("  3. Enter custom name")
                
                name_choice = input("\nEnter choice (1/2/3): ").strip()
                
                if name_choice == '1':
                    correct_name = athlete1['name']
                elif name_choice == '2':
                    correct_name = athlete2['name']
                elif name_choice == '3':
                    correct_name = input("Enter correct name: ").strip()
                    if not correct_name:
                        print("Invalid name, skipping...")
                        return None
                else:
                    print("Invalid choice, skipping...")
                    return None
                
                # Choose canonical
                canonical, duplicate = choose_canonical(athlete1, athlete2)
                
                # Merge
                return merge_similar_athletes(canonical, duplicate, correct_name, conn, dry_run=False)
            
            elif choice == '2':
                return None  # Skip this match
            
            elif choice == '3':
                return {'skip_all': True}  # Signal to skip all remaining
            
            else:
                print("Invalid choice. Please enter 1, 2, or 3.")
        except KeyboardInterrupt:
            print("\n\nInterrupted by user. Skipping remaining matches...")
            return {'skip_all': True}
        except EOFError:
            # Handle case where input is not available (non-interactive)
            logger.warning("Input not available. Skipping interactive merge.")
            return None


def find_similar_athletes_for_uuids(
    conn,
    athlete_uuids: List[str],
    min_similarity: float = None,
) -> List[Tuple[Dict[str, Any], Dict[str, Any], float]]:
    """
    Find pairs of athletes with similar names, focusing on the provided UUIDs.
    
    This checks ONLY the provided athletes against all athletes in the database
    to find potential duplicates. It does NOT scan all athletes.
    
    Args:
        conn: Database connection
        athlete_uuids: List of athlete UUIDs to check (newly processed athletes)
        min_similarity: Minimum similarity score (0.0 to 1.0) to consider a match
        
    Returns:
        List of tuples: (target_athlete, other_athlete, similarity_score)
        where target_athlete is one of the provided UUIDs
    """
    if min_similarity is None:
        min_similarity = NAME_SIMILARITY_THRESHOLD
    if not athlete_uuids:
        return []
    
    # Get the specific athletes we're checking (the current ones being processed)
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        placeholders = ','.join(['%s'] * len(athlete_uuids))
        cur.execute(f'''
            SELECT 
                athlete_uuid,
                name,
                normalized_name,
                app_db_uuid,
                source_system,
                source_athlete_id,
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
                created_at
            FROM analytics.d_athletes
            WHERE athlete_uuid IN ({placeholders})
            ORDER BY name
        ''', athlete_uuids)
        
        target_athletes = cur.fetchall()
    
    if not target_athletes:
        return []
    
    # Get all OTHER athletes for comparison (exclude the ones we're checking)
    target_uuids_set = {a['athlete_uuid'] for a in target_athletes}
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute('''
            SELECT 
                athlete_uuid,
                name,
                normalized_name,
                app_db_uuid,
                source_system,
                source_athlete_id,
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
                created_at
            FROM analytics.d_athletes
            ORDER BY name
        ''')
        
        all_athletes = cur.fetchall()
    
    similar_pairs = []
    seen_pairs = set()  # Track pairs we've already added to avoid duplicates
    
    # Compare ONLY target athletes (current ones) with all other athletes
    for target_athlete in target_athletes:
        for other_athlete in all_athletes:
            # Skip if same athlete
            if target_athlete['athlete_uuid'] == other_athlete['athlete_uuid']:
                continue
            
            # Skip if already have same normalized_name (would be caught by deduplication)
            if target_athlete['normalized_name'] == other_athlete['normalized_name']:
                continue
            
            # Calculate similarity
            score = similarity_score(target_athlete['name'], other_athlete['name'])
            
            if score >= min_similarity:
                # Create a unique pair key (sorted UUIDs) to avoid duplicates
                pair_key = tuple(sorted([target_athlete['athlete_uuid'], other_athlete['athlete_uuid']]))
                if pair_key not in seen_pairs:
                    seen_pairs.add(pair_key)
                    # Always put target_athlete first (the one we're currently processing)
                    similar_pairs.append((dict(target_athlete), dict(other_athlete), score))
    
    # Sort by similarity score (highest first)
    similar_pairs.sort(key=lambda x: x[2], reverse=True)
    
    return similar_pairs


def check_and_merge_duplicates(
    conn=None,
    athlete_uuids: Optional[List[str]] = None,
    min_similarity: float = None,
    auto_skip: bool = False
) -> Dict[str, Any]:
    """
    Check for similar athletes and prompt to merge them interactively.
    
    This function can be called after data insertion to check for duplicates.
    
    Args:
        conn: Optional database connection (will create if not provided)
        athlete_uuids: Optional list of athlete UUIDs to check (if None, checks all)
        min_similarity: Minimum similarity score (0.0 to 1.0) to consider a match
        auto_skip: If True, skip all matches automatically (useful for non-interactive mode)
        
    Returns:
        Dictionary with summary statistics
    """
    if min_similarity is None:
        min_similarity = NAME_SIMILARITY_THRESHOLD
    close_conn = False
    if conn is None:
        conn = get_warehouse_connection()
        close_conn = True
    
    try:
        logger.info("\n" + "=" * 80)
        logger.info("CHECKING FOR SIMILAR ATHLETE NAMES")
        logger.info("=" * 80)
        
        # Find similar athletes - REQUIRE athlete_uuids (no full DB audit)
        if not athlete_uuids:
            logger.warning("No athlete UUIDs provided. Skipping duplicate check.")
            logger.info("To check for duplicates, provide the UUIDs of athletes that were just processed.")
            return {
                'matches_found': 0,
                'merged': 0,
                'skipped': 0,
                'merge_map': {}
            }
        
        logger.info(f"Checking {len(athlete_uuids)} newly processed athlete(s) for similar names...")
        similar_pairs = find_similar_athletes_for_uuids(conn, athlete_uuids, min_similarity)
        
        logger.info(f"Found {len(similar_pairs)} potential matches")
        
        if not similar_pairs:
            logger.info("No similar athletes found!")
            return {
                'matches_found': 0,
                'merged': 0,
                'skipped': 0,
                'merge_map': {}
            }
        
        if auto_skip:
            logger.info("Auto-skip enabled - skipping all matches")
            return {
                'matches_found': len(similar_pairs),
                'merged': 0,
                'skipped': len(similar_pairs),
                'merge_map': {}
            }
        
        # Interactive merging
        merged_count = 0
        skipped_count = 0
        # Map duplicate_uuid -> canonical_uuid so callers can use canonical UUID for reports etc.
        merge_map = {}
        
        for athlete1, athlete2, similarity in similar_pairs:
            result = interactive_merge_prompt(athlete1, athlete2, similarity, conn)
            
            if result and result.get('skip_all'):
                logger.info("\nSkipping all remaining matches...")
                skipped_count += len(similar_pairs) - merged_count - skipped_count
                break
            elif result and result.get('merged'):
                merged_count += 1
                merge_map[result['duplicate_uuid']] = result['canonical_uuid']
            else:
                skipped_count += 1
        
        # Summary
        logger.info("\n" + "=" * 80)
        logger.info("DUPLICATE CHECK SUMMARY")
        logger.info("=" * 80)
        logger.info(f"Potential matches found: {len(similar_pairs)}")
        logger.info(f"Merged: {merged_count}")
        logger.info(f"Skipped: {skipped_count}")
        logger.info("=" * 80)
        
        return {
            'matches_found': len(similar_pairs),
            'merged': merged_count,
            'skipped': skipped_count,
            'merge_map': merge_map
        }
        
    except KeyboardInterrupt:
        logger.info("\n\nInterrupted by user. Exiting duplicate check...")
        return {
            'matches_found': 0,
            'merged': 0,
            'skipped': 0,
            'interrupted': True,
            'merge_map': {}
        }
    except Exception as e:
        logger.exception(f"Error checking for duplicates: {e}")
        return {
            'matches_found': 0,
            'merged': 0,
            'skipped': 0,
            'error': str(e),
            'merge_map': {}
        }
    finally:
        if close_conn:
            conn.close()

