#!/usr/bin/env python3
"""
Interactive script to find and match similar-named athletes between warehouse and app database.

This script:
1. Finds athletes in d_athletes with similar names to User table in app database
2. Uses fuzzy matching (default 90% similarity threshold)
3. Shows potential matches with their data
4. Prompts user to confirm if they're the same person
5. If confirmed, updates app_db_uuid in d_athletes with UUID from User table

Usage:
    python python/scripts/match_similar_athletes_with_app_db.py
    python python/scripts/match_similar_athletes_with_app_db.py --min-similarity 0.85
    python python/scripts/match_similar_athletes_with_app_db.py --dry-run
    python python/scripts/match_similar_athletes_with_app_db.py --app-db-name vercel
"""

import sys
import argparse
from pathlib import Path

project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from python.common.athlete_manager import (
    get_warehouse_connection,
    load_db_config,
    normalize_name_for_matching
)
from python.scripts.match_athletes_with_app_db import get_app_connection_from_warehouse_config
from psycopg2.extras import RealDictCursor
import logging
from difflib import SequenceMatcher
from typing import List, Dict, Any, Tuple, Optional

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


def get_warehouse_athletes(conn) -> List[Dict[str, Any]]:
    """
    Fetch all athletes from warehouse d_athletes table.
    
    Args:
        conn: Warehouse database connection
        
    Returns:
        List of athlete dictionaries
    """
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
        
        return cur.fetchall()


def get_app_users(conn) -> List[Dict[str, Any]]:
    """
    Fetch all users from app database User table.
    
    Args:
        conn: App database connection
        
    Returns:
        List of user dictionaries
    """
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute('''
            SELECT 
                uuid,
                name,
                email,
                "createdAt",
                "updatedAt"
            FROM public."User"
            ORDER BY name
        ''')
        
        return cur.fetchall()


def find_similar_matches(
    warehouse_athletes: List[Dict[str, Any]],
    app_users: List[Dict[str, Any]],
    min_similarity: float = 0.90
) -> List[Tuple[Dict[str, Any], Dict[str, Any], float]]:
    """
    Find similar name matches between warehouse athletes and app users.
    
    Args:
        warehouse_athletes: List of athletes from d_athletes
        app_users: List of users from User table
        min_similarity: Minimum similarity score (0.0 to 1.0) to consider a match
        
    Returns:
        List of tuples: (warehouse_athlete, app_user, similarity_score)
    """
    matches = []
    
    # Normalize app user names for comparison
    app_users_normalized = []
    for user in app_users:
        normalized = normalize_name_for_matching(user['name'])
        app_users_normalized.append({
            'user': user,
            'normalized_name': normalized
        })
    
    # Compare each warehouse athlete with each app user
    for athlete in warehouse_athletes:
        # Skip if already has app_db_uuid
        if athlete['app_db_uuid']:
            continue
            
        athlete_normalized = athlete['normalized_name']
        athlete_name = athlete['name']
        
        best_match = None
        best_score = 0.0
        
        for app_data in app_users_normalized:
            user = app_data['user']
            user_normalized = app_data['normalized_name']
            user_name = user['name']
            
            # Calculate similarity
            score = similarity_score(athlete_normalized, user_normalized)
            
            # Also try comparing display names (in case normalization loses info)
            display_score = similarity_score(athlete_name.lower(), user_name.lower())
            score = max(score, display_score)
            
            if score >= min_similarity and score > best_score:
                best_match = user
                best_score = score
        
        if best_match:
            matches.append((athlete, best_match, best_score))
    
    # Sort by similarity score (highest first)
    matches.sort(key=lambda x: x[2], reverse=True)
    
    return matches


def format_athlete_info(athlete: Dict[str, Any]) -> str:
    """Format athlete information for display."""
    data_flags = []
    if athlete.get('has_pitching_data'):
        data_flags.append(f"Pitching ({athlete.get('pitching_session_count', 0)} sessions)")
    if athlete.get('has_athletic_screen_data'):
        data_flags.append(f"Athletic Screen ({athlete.get('athletic_screen_session_count', 0)} sessions)")
    if athlete.get('has_pro_sup_data'):
        data_flags.append(f"Pro-Sup ({athlete.get('pro_sup_session_count', 0)} sessions)")
    if athlete.get('has_readiness_screen_data'):
        data_flags.append(f"Readiness Screen ({athlete.get('readiness_screen_session_count', 0)} sessions)")
    if athlete.get('has_mobility_data'):
        data_flags.append(f"Mobility ({athlete.get('mobility_session_count', 0)} sessions)")
    if athlete.get('has_proteus_data'):
        data_flags.append(f"Proteus ({athlete.get('proteus_session_count', 0)} sessions)")
    if athlete.get('has_hitting_data'):
        data_flags.append(f"Hitting ({athlete.get('hitting_session_count', 0)} sessions)")
    if athlete.get('has_arm_action_data'):
        data_flags.append(f"Arm Action ({athlete.get('arm_action_session_count', 0)} sessions)")
    if athlete.get('has_curveball_test_data'):
        data_flags.append(f"Curveball Test ({athlete.get('curveball_test_session_count', 0)} sessions)")
    
    data_str = ", ".join(data_flags) if data_flags else "No data"
    
    return f"""
    Name: {athlete['name']}
    UUID: {athlete['athlete_uuid']}
    Normalized: {athlete['normalized_name']}
    Source System: {athlete.get('source_system', 'N/A')}
    Source ID: {athlete.get('source_athlete_id', 'N/A')}
    Current app_db_uuid: {athlete.get('app_db_uuid', 'None')}
    Data: {data_str}
    Created: {athlete.get('created_at', 'N/A')}
    """


def format_user_info(user: Dict[str, Any]) -> str:
    """Format user information for display."""
    return f"""
    Name: {user['name']}
    UUID: {user['uuid']}
    Email: {user.get('email', 'N/A')}
    Created: {user.get('createdAt', 'N/A')}
    Updated: {user.get('updatedAt', 'N/A')}
    """


def update_app_db_uuid(
    warehouse_conn,
    athlete_uuid: str,
    app_uuid: str,
    dry_run: bool = False
) -> bool:
    """
    Update app_db_uuid in d_athletes table.
    
    Args:
        warehouse_conn: Warehouse database connection
        athlete_uuid: UUID of athlete in d_athletes
        app_uuid: UUID from User table to set as app_db_uuid
        dry_run: If True, only report what would be done
        
    Returns:
        True if successful, False otherwise
    """
    if dry_run:
        logger.info(f"[DRY RUN] Would update athlete {athlete_uuid} with app_db_uuid {app_uuid}")
        return True
    
    try:
        with warehouse_conn.cursor() as cur:
            cur.execute('''
                UPDATE analytics.d_athletes
                SET app_db_uuid = %s,
                    app_db_synced_at = NOW()
                WHERE athlete_uuid = %s
            ''', (app_uuid, athlete_uuid))
            
            warehouse_conn.commit()
            
            if cur.rowcount > 0:
                logger.info(f"✓ Updated athlete {athlete_uuid} with app_db_uuid {app_uuid}")
                return True
            else:
                logger.warning(f"No athlete found with UUID {athlete_uuid}")
                return False
                
    except Exception as e:
        logger.error(f"Error updating app_db_uuid: {e}")
        warehouse_conn.rollback()
        return False


def main():
    parser = argparse.ArgumentParser(
        description='Find and match similar-named athletes between warehouse and app database'
    )
    parser.add_argument(
        '--min-similarity',
        type=float,
        default=0.90,
        help='Minimum similarity score (0.0 to 1.0) to consider a match (default: 0.90)'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Show what would be updated without making changes'
    )
    parser.add_argument(
        '--app-db-name',
        type=str,
        default=None,
        help='Name of the app database (defaults to auto-detection)'
    )
    parser.add_argument(
        '--skip-existing',
        action='store_true',
        help='Skip athletes that already have app_db_uuid'
    )
    
    args = parser.parse_args()
    
    logger.info("=" * 80)
    logger.info("Finding similar name matches between warehouse and app database")
    logger.info("=" * 80)
    logger.info(f"Minimum similarity: {args.min_similarity}")
    logger.info(f"Dry run: {args.dry_run}")
    logger.info("")
    
    # Connect to databases
    logger.info("Connecting to databases...")
    warehouse_conn = get_warehouse_connection()
    app_conn = get_app_connection_from_warehouse_config(args.app_db_name)
    
    try:
        # Fetch data
        logger.info("Fetching warehouse athletes...")
        warehouse_athletes = get_warehouse_athletes(warehouse_conn)
        logger.info(f"Found {len(warehouse_athletes)} athletes in warehouse")
        
        logger.info("Fetching app users...")
        app_users = get_app_users(app_conn)
        logger.info(f"Found {len(app_users)} users in app database")
        
        # Filter out athletes that already have app_db_uuid if requested
        if args.skip_existing:
            warehouse_athletes = [a for a in warehouse_athletes if not a['app_db_uuid']]
            logger.info(f"Filtered to {len(warehouse_athletes)} athletes without app_db_uuid")
        
        # Find similar matches
        logger.info("\nFinding similar matches...")
        matches = find_similar_matches(warehouse_athletes, app_users, args.min_similarity)
        logger.info(f"Found {len(matches)} potential matches")
        
        if not matches:
            logger.info("No matches found. Exiting.")
            return
        
        # Process each match
        confirmed_count = 0
        skipped_count = 0
        
        for i, (athlete, user, similarity) in enumerate(matches, 1):
            logger.info("\n" + "=" * 80)
            logger.info(f"Match {i}/{len(matches)} (Similarity: {similarity:.2%})")
            logger.info("=" * 80)
            
            logger.info("\nWAREHOUSE ATHLETE:")
            logger.info(format_athlete_info(athlete))
            
            logger.info("\nAPP DATABASE USER:")
            logger.info(format_user_info(user))
            
            # Prompt user
            while True:
                response = input("\nAre these the same person? (y/n/s=skip all remaining/q=quit): ").strip().lower()
                
                if response == 'y':
                    # Update app_db_uuid
                    success = update_app_db_uuid(
                        warehouse_conn,
                        athlete['athlete_uuid'],
                        user['uuid'],
                        args.dry_run
                    )
                    
                    if success:
                        confirmed_count += 1
                    break
                    
                elif response == 'n':
                    skipped_count += 1
                    logger.info("Skipped.")
                    break
                    
                elif response == 's':
                    logger.info("Skipping all remaining matches.")
                    return
                    
                elif response == 'q':
                    logger.info("Quitting.")
                    return
                    
                else:
                    print("Please enter 'y' (yes), 'n' (no), 's' (skip all), or 'q' (quit)")
        
        # Summary
        logger.info("\n" + "=" * 80)
        logger.info("SUMMARY")
        logger.info("=" * 80)
        logger.info(f"Total matches found: {len(matches)}")
        logger.info(f"Confirmed and updated: {confirmed_count}")
        logger.info(f"Skipped: {skipped_count}")
        
    finally:
        warehouse_conn.close()
        app_conn.close()
        logger.info("\nDatabase connections closed.")


if __name__ == "__main__":
    main()

