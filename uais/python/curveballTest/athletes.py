"""
Athlete management for Curveball Test data.
Now uses warehouse d_athletes table via athlete_manager.
This module is kept for backward compatibility but most functionality
is now handled by common.athlete_manager.
"""

import sys
from pathlib import Path

# Add parent directory to path for imports
python_dir = Path(__file__).parent.parent
if str(python_dir) not in sys.path:
    sys.path.insert(0, str(python_dir))

from common.athlete_manager import update_athlete_flags


def init_athletes_db():
    """
    Initialize athletes in warehouse.
    This is a no-op now since athletes are managed via athlete_manager
    during data ingestion.
    """
    # Athletes are now created/updated during data ingestion via get_or_create_athlete()
    # No separate initialization needed
    pass


def update_athletes_summary():
    """
    Update athlete flags in warehouse d_athletes table.
    This updates has_curveball_test_data and curveball_test_session_count flags.
    """
    # Update all athlete flags (including curveball test flags)
    result = update_athlete_flags(verbose=True)
    
    if result.get('success'):
        print("Athlete flags updated successfully")
    else:
        print(f"Warning: Failed to update athlete flags: {result.get('message')}")


def get_athlete_summary(participant_name=None):
    """
    Retrieve athlete summary data from warehouse.
    
    Args:
        participant_name: Optional filter by participant name
        
    Returns:
        list: List of dictionaries with athlete summary data
    """
    from common.athlete_manager import get_warehouse_connection
    from psycopg2.extras import RealDictCursor
    
    conn = get_warehouse_connection()
    
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            if participant_name:
                # Normalize name for matching
                from common.athlete_manager import normalize_name_for_matching
                normalized_name = normalize_name_for_matching(participant_name)
                
                query = """
                SELECT 
                    a.name, a.athlete_uuid,
                    COUNT(DISTINCT ct.session_date) as total_sessions,
                    COUNT(ct.id) as total_pitches,
                    MIN(ct.session_date) as first_session_date,
                    MAX(ct.session_date) as last_session_date
                FROM analytics.d_athletes a
                LEFT JOIN public.f_curveball_test ct ON a.athlete_uuid = ct.athlete_uuid
                WHERE a.normalized_name = %s
                GROUP BY a.name, a.athlete_uuid
                ORDER BY last_session_date DESC
                """
                cur.execute(query, (normalized_name,))
            else:
                query = """
                SELECT 
                    a.name, a.athlete_uuid,
                    COUNT(DISTINCT ct.session_date) as total_sessions,
                    COUNT(ct.id) as total_pitches,
                    MIN(ct.session_date) as first_session_date,
                    MAX(ct.session_date) as last_session_date
                FROM analytics.d_athletes a
                LEFT JOIN public.f_curveball_test ct ON a.athlete_uuid = ct.athlete_uuid
                WHERE a.has_curveball_test_data = TRUE
                GROUP BY a.name, a.athlete_uuid
                ORDER BY a.name, last_session_date DESC
                """
                cur.execute(query)
            
            results = cur.fetchall()
            return [dict(row) for row in results]
    finally:
        conn.close()
