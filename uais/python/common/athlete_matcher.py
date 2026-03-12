"""
Athlete matching and management for ETL scripts.
Implements top-down approach: d_athletes is master reference.
Matches by name/normalized_name, fills blanks non-destructively, updates flags.
"""
import uuid
import re
import logging
from typing import Optional, Dict, Any
from datetime import datetime

from common.athlete_manager import (
    get_warehouse_connection,
    normalize_name_for_matching,
    normalize_name_for_display
)

logger = logging.getLogger(__name__)


def find_athlete_by_name(conn, name: str, normalized_name: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    Find athlete in d_athletes by matching name or normalized_name.
    Uses flexible matching - checks if name appears in either column.
    
    Args:
        conn: PostgreSQL connection
        name: Original name from source data
        normalized_name: Pre-normalized name (optional, will normalize if not provided)
    
    Returns:
        Dictionary with athlete data if found, None otherwise
    """
    if normalized_name is None:
        normalized_name = normalize_name_for_matching(name)
    
    if not normalized_name:
        return None
    
    with conn.cursor() as cur:
        # Try exact match on normalized_name first (most reliable)
        cur.execute("""
            SELECT athlete_uuid, name, normalized_name, date_of_birth, age, age_at_collection,
                   gender, height, weight, notes, source_system, source_athlete_id,
                   has_pitching_data, has_athletic_screen_data, has_pro_sup_data,
                   has_readiness_screen_data, has_mobility_data, has_proteus_data, has_hitting_data
            FROM analytics.d_athletes
            WHERE normalized_name = %s
        """, (normalized_name,))
        
        result = cur.fetchone()
        if result:
            return {
                'athlete_uuid': result[0],
                'name': result[1],
                'normalized_name': result[2],
                'date_of_birth': result[3],
                'age': result[4],
                'age_at_collection': result[5],
                'gender': result[6],
                'height': result[7],
                'weight': result[8],
                'notes': result[9],
                'source_system': result[10],
                'source_athlete_id': result[11],
                'has_pitching_data': result[12],
                'has_athletic_screen_data': result[13],
                'has_pro_sup_data': result[14],
                'has_readiness_screen_data': result[15],
                'has_mobility_data': result[16],
                'has_proteus_data': result[17],
                'has_hitting_data': result[18]
            }
        
        # Fallback: try fuzzy match on name (case-insensitive contains)
        # This handles cases where normalized_name might differ slightly
        # Also try matching base name (without suffixes like _MS_2, _TG, etc.)
        base_name = normalized_name
        # Remove common suffixes (e.g., "_MS_2", "_TG", "_MS", etc.)
        base_name_no_suffix = re.sub(r'_[A-Z]{1,3}_?\d*$', '', base_name).strip()
        
        # Try multiple patterns
        patterns = [
            (f'%{normalized_name}%', f'%{normalized_name}%'),  # Full match
            (f'%{base_name_no_suffix}%', f'%{base_name_no_suffix}%'),  # Base name match
        ]
        
        for name_pattern, norm_pattern in patterns:
            cur.execute("""
                SELECT athlete_uuid, name, normalized_name, date_of_birth, age, age_at_collection,
                       gender, height, weight, notes, source_system, source_athlete_id,
                       has_pitching_data, has_athletic_screen_data, has_pro_sup_data,
                       has_readiness_screen_data, has_mobility_data, has_proteus_data, has_hitting_data
                FROM analytics.d_athletes
                WHERE UPPER(name) LIKE %s OR UPPER(normalized_name) LIKE %s
                LIMIT 1
            """, (name_pattern, norm_pattern))
            
            result = cur.fetchone()
            if result:
                return {
                    'athlete_uuid': result[0],
                    'name': result[1],
                    'normalized_name': result[2],
                    'date_of_birth': result[3],
                    'age': result[4],
                    'age_at_collection': result[5],
                    'gender': result[6],
                    'height': result[7],
                    'weight': result[8],
                    'notes': result[9],
                    'source_system': result[10],
                    'source_athlete_id': result[11],
                    'has_pitching_data': result[12],
                    'has_athletic_screen_data': result[13],
                    'has_pro_sup_data': result[14],
                    'has_readiness_screen_data': result[15],
                    'has_mobility_data': result[16],
                    'has_proteus_data': result[17],
                    'has_hitting_data': result[18]
                }
        
        result = cur.fetchone()
        if result:
            return {
                'athlete_uuid': result[0],
                'name': result[1],
                'normalized_name': result[2],
                'date_of_birth': result[3],
                'age': result[4],
                'age_at_collection': result[5],
                'gender': result[6],
                'height': result[7],
                'weight': result[8],
                'notes': result[9],
                'source_system': result[10],
                'source_athlete_id': result[11],
                'has_pitching_data': result[12],
                'has_athletic_screen_data': result[13],
                'has_pro_sup_data': result[14],
                'has_readiness_screen_data': result[15],
                'has_mobility_data': result[16],
                'has_proteus_data': result[17],
                'has_hitting_data': result[18]
            }
    
    return None


def get_or_create_athlete_safe(
    name: str,
    source_system: str,
    source_athlete_id: Optional[str] = None,
    date_of_birth: Optional[str] = None,
    age: Optional[float] = None,
    gender: Optional[str] = None,
    height: Optional[float] = None,
    weight: Optional[float] = None,
    notes: Optional[str] = None,
    conn=None
) -> str:
    """
    Get or create athlete UUID with safe, non-destructive updates.
    
    Top-down approach:
    1. Check d_athletes for name match (normalized_name or name contains)
    2. If found: Update blanks with new data (non-destructive), update flags, return UUID
    3. If not found: Create new athlete, fill available data, return UUID
    
    Args:
        name: Original name from source data
        source_system: Source system name (e.g., 'readiness_screen', 'athletic_screen')
        source_athlete_id: Original ID from source system
        date_of_birth: Date of birth (YYYY-MM-DD)
        age: Age
        gender: Gender
        height: Height
        weight: Weight
        notes: Notes
        conn: PostgreSQL connection (optional, will create if not provided)
    
    Returns:
        athlete_uuid (string)
    """
    close_conn = False
    if conn is None:
        conn = get_warehouse_connection()
        close_conn = True
    
    try:
        normalized_name = normalize_name_for_matching(name)
        if not normalized_name:
            raise ValueError("Name cannot be empty after normalization")
        
        display_name = normalize_name_for_display(name)
        
        # Step 1: Try to find existing athlete
        existing = find_athlete_by_name(conn, name, normalized_name)
        
        if existing:
            # Athlete exists - update non-destructively
            athlete_uuid = existing['athlete_uuid']
            logger.info(f"Found existing athlete: {existing['name']} ({athlete_uuid})")
            
            # Build UPDATE statement - only update columns that are NULL/blank
            update_parts = []
            update_values = []
            
            # Update name if current name is blank or just normalized
            if not existing['name'] or existing['name'] == existing['normalized_name']:
                if display_name:
                    update_parts.append("name = %s")
                    update_values.append(display_name)
            
            # Fill in demographic data only if currently NULL
            if date_of_birth and not existing['date_of_birth']:
                update_parts.append("date_of_birth = %s")
                update_values.append(date_of_birth)
            
            if age is not None and existing['age'] is None:
                update_parts.append("age = %s")
                update_values.append(age)
            
            if gender and not existing['gender']:
                update_parts.append("gender = %s")
                update_values.append(gender)
            
            if height is not None and existing['height'] is None:
                update_parts.append("height = %s")
                update_values.append(height)
            
            if weight is not None and existing['weight'] is None:
                update_parts.append("weight = %s")
                update_values.append(weight)
            
            if notes and not existing['notes']:
                update_parts.append("notes = %s")
                update_values.append(notes)
            
            # Update source_system and source_athlete_id if not set
            if not existing['source_system']:
                update_parts.append("source_system = %s")
                update_values.append(source_system)
            
            if source_athlete_id and not existing['source_athlete_id']:
                update_parts.append("source_athlete_id = %s")
                update_values.append(source_athlete_id)
            
            # Update updated_at
            update_parts.append("updated_at = NOW()")
            
            # Execute update if there are changes
            if update_parts:
                update_values.append(athlete_uuid)
                with conn.cursor() as cur:
                    cur.execute(f"""
                        UPDATE analytics.d_athletes
                        SET {', '.join(update_parts)}
                        WHERE athlete_uuid = %s
                    """, update_values)
                    conn.commit()
                    logger.info(f"Updated athlete {athlete_uuid} with new data")
            
            return athlete_uuid
        
        # Step 2: Athlete doesn't exist - create new
        logger.info(f"Creating new athlete: {name}")
        athlete_uuid = str(uuid.uuid4())
        
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO analytics.d_athletes (
                    athlete_uuid, name, normalized_name,
                    date_of_birth, age, age_at_collection,
                    gender, height, weight, notes,
                    source_system, source_athlete_id,
                    created_at, updated_at
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW()
                )
            """, (
                athlete_uuid,
                display_name or name,
                normalized_name,
                date_of_birth,
                age,
                age_at_collection,
                gender,
                height,
                weight,
                notes,
                source_system,
                source_athlete_id
            ))
            conn.commit()
            logger.info(f"Created new athlete: {display_name or name} ({athlete_uuid})")
        
        return athlete_uuid
        
    finally:
        if close_conn:
            conn.close()


def update_athlete_data_flag(
    conn,
    athlete_uuid: str,
    source_system: str,
    has_data: bool = True
):
    """
    Update the has_xxxx_data flag for an athlete.
    
    Args:
        conn: PostgreSQL connection
        athlete_uuid: Athlete UUID
        source_system: Source system name (maps to flag column)
        has_data: Whether athlete has data in this system
    """
    # Map source_system to flag column name
    flag_map = {
        'pitching': 'has_pitching_data',
        'athletic_screen': 'has_athletic_screen_data',
        'pro_sup': 'has_pro_sup_data',
        'readiness_screen': 'has_readiness_screen_data',
        'mobility': 'has_mobility_data',
        'proteus': 'has_proteus_data',
        'hitting': 'has_hitting_data'
    }
    
    flag_column = flag_map.get(source_system)
    if not flag_column:
        logger.warning(f"Unknown source_system: {source_system}, cannot update flag")
        return
    
    with conn.cursor() as cur:
        cur.execute(f"""
            UPDATE analytics.d_athletes
            SET {flag_column} = %s, updated_at = NOW()
            WHERE athlete_uuid = %s
        """, (has_data, athlete_uuid))
        conn.commit()

