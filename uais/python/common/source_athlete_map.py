"""
Source Athlete Map Management

This module provides functions to manage the source_athlete_map table,
which stores ALL source_athlete_id values for each athlete across all source systems.
This prevents loss of source_athlete_id mappings when merging duplicates.
"""

import logging
from typing import Optional, Dict, List, Any
from psycopg2.extras import RealDictCursor

logger = logging.getLogger(__name__)


def ensure_source_map_table(conn):
    """
    Ensure the source_athlete_map table exists.
    
    Args:
        conn: Database connection
    """
    with conn.cursor() as cur:
        cur.execute('''
            CREATE TABLE IF NOT EXISTS analytics.source_athlete_map (
                source_system TEXT NOT NULL,
                source_athlete_id TEXT NOT NULL,
                athlete_uuid VARCHAR(36) NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (source_system, source_athlete_id),
                FOREIGN KEY (athlete_uuid) REFERENCES analytics.d_athletes(athlete_uuid) ON DELETE CASCADE
            )
        ''')
        
        # Create indexes
        cur.execute('''
            CREATE INDEX IF NOT EXISTS idx_source_map_uuid 
            ON analytics.source_athlete_map(athlete_uuid)
        ''')
        
        cur.execute('''
            CREATE INDEX IF NOT EXISTS idx_source_map_system 
            ON analytics.source_athlete_map(source_system)
        ''')
        
        conn.commit()


def add_source_mapping(
    conn,
    athlete_uuid: str,
    source_system: str,
    source_athlete_id: str,
    skip_if_exists: bool = True
) -> bool:
    """
    Add a source_athlete_id mapping for an athlete.
    
    Args:
        conn: Database connection
        athlete_uuid: Athlete UUID
        source_system: Source system (e.g., 'pitching', 'pro_sup')
        source_athlete_id: Source athlete ID (e.g., 'BW', 'Wahl, Bobby')
        skip_if_exists: If True, silently skip if mapping already exists
        
    Returns:
        True if mapping was added, False if it already existed
    """
    if not source_system or not source_athlete_id:
        return False
    
    ensure_source_map_table(conn)
    
    with conn.cursor() as cur:
        try:
            cur.execute('''
                INSERT INTO analytics.source_athlete_map 
                (athlete_uuid, source_system, source_athlete_id)
                VALUES (%s, %s, %s)
                ON CONFLICT (source_system, source_athlete_id) DO NOTHING
            ''', (athlete_uuid, source_system, source_athlete_id))
            
            conn.commit()
            return cur.rowcount > 0
            
        except Exception as e:
            if skip_if_exists and 'duplicate key' in str(e).lower():
                return False
            raise


def get_athlete_by_source_id(
    conn,
    source_system: str,
    source_athlete_id: str
) -> Optional[Dict[str, Any]]:
    """
    Find athlete by source_system and source_athlete_id using the mapping table.
    
    Args:
        conn: Database connection
        source_system: Source system
        source_athlete_id: Source athlete ID
        
    Returns:
        Athlete record if found, None otherwise
    """
    ensure_source_map_table(conn)
    
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute('''
            SELECT d.*
            FROM analytics.d_athletes d
            INNER JOIN analytics.source_athlete_map m
                ON d.athlete_uuid = m.athlete_uuid
            WHERE m.source_system = %s
              AND m.source_athlete_id = %s
            LIMIT 1
        ''', (source_system, source_athlete_id))
        
        result = cur.fetchone()
        return dict(result) if result else None


def get_all_source_mappings(
    conn,
    athlete_uuid: str
) -> List[Dict[str, Any]]:
    """
    Get all source_athlete_id mappings for an athlete.
    
    Args:
        conn: Database connection
        athlete_uuid: Athlete UUID
        
    Returns:
        List of mappings with source_system and source_athlete_id
    """
    ensure_source_map_table(conn)
    
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute('''
            SELECT source_system, source_athlete_id, created_at
            FROM analytics.source_athlete_map
            WHERE athlete_uuid = %s
            ORDER BY source_system, source_athlete_id
        ''', (athlete_uuid,))
        
        return [dict(row) for row in cur.fetchall()]


def merge_source_mappings(
    conn,
    canonical_uuid: str,
    duplicate_uuids: List[str],
    dry_run: bool = False
) -> int:
    """
    Merge source_athlete_id mappings from duplicate athletes into canonical athlete.
    
    This preserves ALL source_athlete_id values when merging duplicates.
    
    Args:
        conn: Database connection
        canonical_uuid: Canonical athlete UUID
        duplicate_uuids: List of duplicate athlete UUIDs to merge from
        dry_run: If True, only report what would be done
        
    Returns:
        Number of mappings merged
    """
    ensure_source_map_table(conn)
    
    if not duplicate_uuids:
        return 0
    
    mappings_added = 0
    
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        # Get all mappings from duplicate athletes
        placeholders = ','.join(['%s'] * len(duplicate_uuids))
        cur.execute(f'''
            SELECT DISTINCT source_system, source_athlete_id
            FROM analytics.source_athlete_map
            WHERE athlete_uuid IN ({placeholders})
        ''', duplicate_uuids)
        
        duplicate_mappings = cur.fetchall()
        
        # Also check d_athletes for source_athlete_id values that might not be in the map yet
        cur.execute(f'''
            SELECT DISTINCT source_system, source_athlete_id
            FROM analytics.d_athletes
            WHERE athlete_uuid IN ({placeholders})
              AND source_system IS NOT NULL
              AND source_athlete_id IS NOT NULL
        ''', duplicate_uuids)
        
        d_athletes_mappings = cur.fetchall()
        
        # Combine and deduplicate
        all_mappings = {}
        for mapping in duplicate_mappings + d_athletes_mappings:
            key = (mapping['source_system'], mapping['source_athlete_id'])
            if key not in all_mappings:
                all_mappings[key] = mapping
        
        # Add each mapping to canonical athlete
        for mapping in all_mappings.values():
            source_system = mapping['source_system']
            source_athlete_id = mapping['source_athlete_id']
            
            if not source_system or not source_athlete_id:
                continue
            
            if not dry_run:
                added = add_source_mapping(
                    conn, canonical_uuid, source_system, source_athlete_id
                )
                if added:
                    mappings_added += 1
                    logger.debug(f"  Added mapping: {source_system}/{source_athlete_id}")
            else:
                # Check if mapping already exists
                cur.execute('''
                    SELECT COUNT(*) 
                    FROM analytics.source_athlete_map
                    WHERE athlete_uuid = %s
                      AND source_system = %s
                      AND source_athlete_id = %s
                ''', (canonical_uuid, source_system, source_athlete_id))
                
                if cur.fetchone()[0] == 0:
                    mappings_added += 1
                    logger.debug(f"  [DRY RUN] Would add mapping: {source_system}/{source_athlete_id}")
    
    if not dry_run:
        conn.commit()
    
    return mappings_added


def backfill_source_mappings(conn, dry_run: bool = False) -> int:
    """
    Backfill source_athlete_map table from existing d_athletes records.
    
    This should be run once to populate the mapping table with existing data.
    
    Args:
        conn: Database connection
        dry_run: If True, only report what would be done
        
    Returns:
        Number of mappings added
    """
    ensure_source_map_table(conn)
    
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute('''
            SELECT athlete_uuid, source_system, source_athlete_id
            FROM analytics.d_athletes
            WHERE source_system IS NOT NULL
              AND source_athlete_id IS NOT NULL
        ''')
        
        athletes = cur.fetchall()
    
    mappings_added = 0
    
    for athlete in athletes:
        if not dry_run:
            added = add_source_mapping(
                conn,
                athlete['athlete_uuid'],
                athlete['source_system'],
                athlete['source_athlete_id']
            )
            if added:
                mappings_added += 1
        else:
            # Check if exists
            with conn.cursor() as cur:
                cur.execute('''
                    SELECT COUNT(*) 
                    FROM analytics.source_athlete_map
                    WHERE athlete_uuid = %s
                      AND source_system = %s
                      AND source_athlete_id = %s
                ''', (athlete['athlete_uuid'], athlete['source_system'], athlete['source_athlete_id']))
                
                if cur.fetchone()[0] == 0:
                    mappings_added += 1
    
    if not dry_run:
        conn.commit()
    
    return mappings_added

