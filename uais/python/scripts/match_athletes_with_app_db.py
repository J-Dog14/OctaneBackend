#!/usr/bin/env python3
"""
Match Warehouse Athletes with App Database User Table

This script:
1. Fetches all athletes from analytics.d_athletes in the warehouse
2. Compares their normalized names with public."User" table in the app database
3. Updates app_db_uuid in the warehouse when a name match is found

The script handles name normalization:
- Converts "Last, First" to "First Last" format
- Removes dates (e.g., "11-25", "12-24")
- Case-insensitive matching

Usage:
    python python/scripts/match_athletes_with_app_db.py [--dry-run] [--update-all] [--app-db-name NAME]
    
Options:
    --dry-run: Show what would be updated without making changes
    --update-all: Update all athletes, even if they already have app_db_uuid
    --app-db-name: Name of the app database (defaults to "vercel" or auto-detects)
"""

import sys
import argparse
import logging
from pathlib import Path
from typing import Dict, List, Tuple, Optional
from collections import defaultdict

# Add project root to path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from python.common.athlete_manager import (
    get_warehouse_connection,
    load_db_config,
    normalize_name_for_matching
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


def get_app_connection_from_warehouse_config(app_db_name: Optional[str] = None):
    """
    Get connection to app database using warehouse connection parameters.
    
    Since both databases are on the same server, we use the warehouse config
    but connect to the app database instead.
    
    Args:
        app_db_name: Name of the app database (defaults to "vercel" or tries to detect)
        
    Returns:
        psycopg2 connection object
    """
    config = load_db_config()
    wh_config = config['databases']['warehouse']['postgres']
    
    # Try to get app database name
    if app_db_name is None:
        # First, try verceldb from config (most likely location for User table)
        try:
            verceldb_name = config['databases']['verceldb']['postgres']['database']
            try:
                test_conn = psycopg2.connect(
                    host=wh_config['host'],
                    port=wh_config['port'],
                    database=verceldb_name,
                    user=wh_config['user'],
                    password=wh_config['password'],
                    connect_timeout=5
                )
                # Verify User table exists
                with test_conn.cursor() as cur:
                    cur.execute('''
                        SELECT 1 FROM information_schema.tables 
                        WHERE table_schema = 'public' AND table_name = 'User'
                    ''')
                    if cur.fetchone():
                        test_conn.close()
                        app_db_name = verceldb_name
                        logger.info(f"Using verceldb database: {verceldb_name}")
                    else:
                        test_conn.close()
            except psycopg2.OperationalError:
                pass
        except (KeyError, TypeError):
            pass
        
        # If verceldb didn't work, try app database from config
        if app_db_name is None:
            try:
                config_db_name = config['databases']['app']['postgres']['database']
                try:
                    test_conn = psycopg2.connect(
                        host=wh_config['host'],
                        port=wh_config['port'],
                        database=config_db_name,
                        user=wh_config['user'],
                        password=wh_config['password'],
                        connect_timeout=5
                    )
                    # Verify User table exists
                    with test_conn.cursor() as cur:
                        cur.execute('''
                            SELECT 1 FROM information_schema.tables 
                            WHERE table_schema = 'public' AND table_name = 'User'
                        ''')
                        if cur.fetchone():
                            test_conn.close()
                            app_db_name = config_db_name
                            logger.info(f"Using app database from config: {config_db_name}")
                        else:
                            test_conn.close()
                except psycopg2.OperationalError:
                    pass
            except (KeyError, TypeError):
                pass
        
        # If still None, try common names (try "vercel" first as it's most common)
        if app_db_name is None:
            # Try common database names
            for db_name in ['vercel', 'verceldb', 'vercel_db', 'app', 'app_db']:
                try:
                    test_conn = psycopg2.connect(
                        host=wh_config['host'],
                        port=wh_config['port'],
                        database=db_name,
                        user=wh_config['user'],
                        password=wh_config['password'],
                        connect_timeout=5
                    )
                    # Verify User table exists
                    with test_conn.cursor() as cur:
                        cur.execute('''
                            SELECT 1 FROM information_schema.tables 
                            WHERE table_schema = 'public' AND table_name = 'User'
                        ''')
                        if cur.fetchone():
                            test_conn.close()
                            app_db_name = db_name
                            logger.info(f"Auto-detected app database name: {db_name}")
                            break
                        else:
                            test_conn.close()
                except psycopg2.OperationalError:
                    continue
        
        if app_db_name is None:
            raise ValueError(
                "Could not determine app database name. "
                "Please specify with --app-db-name or update config file. "
                "Make sure the database exists and contains a 'User' table."
            )
    
    logger.info(f"Connecting to app database: {wh_config['user']}@{wh_config['host']}:{wh_config['port']}/{app_db_name}")
    
    conn = psycopg2.connect(
        host=wh_config['host'],
        port=wh_config['port'],
        database=app_db_name,
        user=wh_config['user'],
        password=wh_config['password'],
        connect_timeout=10
    )
    conn.set_client_encoding('UTF8')
    
    return conn


def fetch_warehouse_athletes(conn, update_all: bool = False) -> List[Dict]:
    """
    Fetch athletes from warehouse database.
    
    Args:
        conn: Warehouse database connection
        update_all: If True, fetch all athletes. If False, only those without app_db_uuid
        
    Returns:
        List of athlete dictionaries
    """
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        if update_all:
            query = '''
                SELECT 
                    athlete_uuid,
                    name,
                    normalized_name,
                    app_db_uuid
                FROM analytics.d_athletes
                ORDER BY created_at
            '''
        else:
            query = '''
                SELECT 
                    athlete_uuid,
                    name,
                    normalized_name,
                    app_db_uuid
                FROM analytics.d_athletes
                WHERE app_db_uuid IS NULL
                ORDER BY created_at
            '''
        
        cur.execute(query)
        athletes = cur.fetchall()
        
        logger.info(f"Fetched {len(athletes)} athletes from warehouse")
        return [dict(athlete) for athlete in athletes]


def build_user_name_map(conn) -> Dict[str, str]:
    """
    Build a mapping of normalized names to UUIDs from the User table.
    
    This loads all users from the app database and creates a normalized name -> UUID mapping.
    Handles multiple users with the same normalized name by keeping the first one found.
    
    Args:
        conn: App database connection
        
    Returns:
        Dictionary mapping normalized_name -> uuid (as string)
    """
    logger.info("Loading users from app database...")
    
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute('SELECT uuid, name FROM public."User"')
        users = cur.fetchall()
    
    logger.info(f"Loaded {len(users)} users from app database")
    
    # Build mapping: normalized_name -> uuid
    name_map = {}
    duplicates = defaultdict(list)
    
    for user in users:
        user_name = user['name']
        user_uuid = str(user['uuid'])
        
        # Normalize the name for matching
        normalized = normalize_name_for_matching(user_name)
        
        if not normalized:
            logger.warning(f"Could not normalize user name: {user_name}")
            continue
        
        # If we already have this normalized name, track the duplicate
        if normalized in name_map:
            duplicates[normalized].append((user_name, user_uuid))
            logger.debug(f"Duplicate normalized name '{normalized}': {user_name} (keeping first)")
        else:
            name_map[normalized] = user_uuid
    
    if duplicates:
        logger.warning(f"Found {len(duplicates)} normalized names with multiple users in app database")
        for norm_name, dup_list in list(duplicates.items())[:5]:  # Show first 5
            logger.warning(f"  '{norm_name}': {len(dup_list) + 1} users")
    
    logger.info(f"Built name mapping with {len(name_map)} unique normalized names")
    return name_map


def find_matches(warehouse_athletes: List[Dict], user_name_map: Dict[str, str]) -> List[Tuple[str, str, str]]:
    """
    Find matches between warehouse athletes and app database users.
    
    Args:
        warehouse_athletes: List of athlete dictionaries from warehouse
        user_name_map: Dictionary mapping normalized_name -> uuid from app database
        
    Returns:
        List of tuples: (athlete_uuid, app_db_uuid, warehouse_name)
    """
    matches = []
    
    for athlete in warehouse_athletes:
        athlete_uuid = athlete['athlete_uuid']
        warehouse_name = athlete['name']
        warehouse_normalized = athlete.get('normalized_name')
        
        # Re-normalize the name to ensure consistency
        # (in case normalized_name in DB is outdated)
        normalized = normalize_name_for_matching(warehouse_name)
        
        if not normalized:
            logger.debug(f"Could not normalize warehouse name: {warehouse_name}")
            continue
        
        # Check if we have a match in the user map
        if normalized in user_name_map:
            app_db_uuid = user_name_map[normalized]
            matches.append((athlete_uuid, app_db_uuid, warehouse_name))
            logger.debug(f"Match found: '{warehouse_name}' -> {app_db_uuid}")
    
    return matches


def update_warehouse_athletes(conn, matches: List[Tuple[str, str, str]], dry_run: bool = False) -> int:
    """
    Update app_db_uuid for matched athletes in the warehouse.
    
    Args:
        conn: Warehouse database connection
        matches: List of (athlete_uuid, app_db_uuid, warehouse_name) tuples
        dry_run: If True, don't actually update, just log what would be updated
        
    Returns:
        Number of athletes updated
    """
    if not matches:
        logger.info("No matches to update")
        return 0
    
    logger.info(f"{'Would update' if dry_run else 'Updating'} {len(matches)} athletes...")
    
    if dry_run:
        for athlete_uuid, app_db_uuid, name in matches[:10]:  # Show first 10
            logger.info(f"  Would update: {name} ({athlete_uuid}) -> app_db_uuid: {app_db_uuid}")
        if len(matches) > 10:
            logger.info(f"  ... and {len(matches) - 10} more")
        return len(matches)
    
    # Perform batch update
    updated_count = 0
    with conn.cursor() as cur:
        for athlete_uuid, app_db_uuid, name in matches:
            try:
                cur.execute('''
                    UPDATE analytics.d_athletes
                    SET 
                        app_db_uuid = %s,
                        app_db_synced_at = NOW()
                    WHERE athlete_uuid = %s
                ''', (app_db_uuid, athlete_uuid))
                
                if cur.rowcount > 0:
                    updated_count += 1
                    logger.debug(f"Updated: {name} ({athlete_uuid}) -> {app_db_uuid}")
                else:
                    logger.warning(f"No row updated for athlete_uuid: {athlete_uuid}")
                    
            except psycopg2.Error as e:
                logger.error(f"Error updating athlete {athlete_uuid}: {e}")
                conn.rollback()
                raise
        
        conn.commit()
    
    logger.info(f"Successfully updated {updated_count} athletes")
    return updated_count


def main():
    """Main execution function."""
    parser = argparse.ArgumentParser(
        description='Match warehouse athletes with app database User table'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Show what would be updated without making changes'
    )
    parser.add_argument(
        '--update-all',
        action='store_true',
        help='Update all athletes, even if they already have app_db_uuid'
    )
    parser.add_argument(
        '--app-db-name',
        type=str,
        default=None,
        help='Name of the app database (defaults to "vercel" or auto-detects)'
    )
    
    args = parser.parse_args()
    
    warehouse_conn = None
    app_conn = None
    
    try:
        logger.info("=" * 60)
        logger.info("Matching Warehouse Athletes with App Database")
        logger.info("=" * 60)
        
        if args.dry_run:
            logger.info("DRY RUN MODE - No changes will be made")
        
        # Connect to databases
        logger.info("Connecting to databases...")
        warehouse_conn = get_warehouse_connection()
        app_conn = get_app_connection_from_warehouse_config(app_db_name=args.app_db_name)
        logger.info("Connected successfully")
        
        # Step 1: Fetch warehouse athletes
        logger.info("\nStep 1: Fetching warehouse athletes...")
        warehouse_athletes = fetch_warehouse_athletes(warehouse_conn, update_all=args.update_all)
        
        if not warehouse_athletes:
            logger.info("No athletes to process")
            return 0
        
        # Step 2: Build user name map from app database
        logger.info("\nStep 2: Building user name map from app database...")
        user_name_map = build_user_name_map(app_conn)
        
        if not user_name_map:
            logger.warning("No users found in app database")
            return 0
        
        # Step 3: Find matches
        logger.info("\nStep 3: Finding matches...")
        matches = find_matches(warehouse_athletes, user_name_map)
        
        logger.info(f"Found {len(matches)} matches out of {len(warehouse_athletes)} athletes")
        
        # Step 4: Update warehouse
        logger.info("\nStep 4: Updating warehouse...")
        updated = update_warehouse_athletes(warehouse_conn, matches, dry_run=args.dry_run)
        
        # Summary
        logger.info("\n" + "=" * 60)
        logger.info("SUMMARY")
        logger.info("=" * 60)
        logger.info(f"Warehouse athletes processed: {len(warehouse_athletes)}")
        logger.info(f"App database users loaded: {len(user_name_map)}")
        logger.info(f"Matches found: {len(matches)}")
        logger.info(f"Athletes {'would be updated' if args.dry_run else 'updated'}: {updated}")
        
        return 0
        
    except psycopg2.OperationalError as e:
        logger.error(f"Database connection error: {e}")
        return 1
    except psycopg2.Error as e:
        logger.error(f"Database error: {e}")
        if warehouse_conn:
            warehouse_conn.rollback()
        return 2
    except Exception as e:
        logger.exception(f"Unexpected error: {e}")
        return 3
    finally:
        if warehouse_conn:
            warehouse_conn.close()
            logger.debug("Closed warehouse connection")
        if app_conn:
            app_conn.close()
            logger.debug("Closed app database connection")


if __name__ == '__main__':
    sys.exit(main())

