"""
Script to check database status and show what's in the warehouse tables.
"""

import sys
from pathlib import Path

# Add parent directory to path for imports
python_dir = Path(__file__).parent.parent
if str(python_dir) not in sys.path:
    sys.path.insert(0, str(python_dir))

from common.athlete_manager import get_warehouse_connection
from psycopg2.extras import RealDictCursor


def check_database_status():
    """Display current warehouse database status."""
    conn = get_warehouse_connection()
    
    try:
        print("=" * 100)
        print("WAREHOUSE DATABASE STATUS CHECK - ARM ACTION")
        print("=" * 100)
        
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # Check f_arm_action table
            cur.execute("SELECT COUNT(*) as count FROM public.f_arm_action")
            arm_action_count = cur.fetchone()['count']
            print(f"\nf_arm_action: {arm_action_count} record(s)")
            
            if arm_action_count > 0:
                # Get sample data
                cur.execute("""
                    SELECT DISTINCT 
                        a.name as participant_name, 
                        aa.session_date, 
                        aa.movement_type,
                        COUNT(*) as num_movements
                    FROM public.f_arm_action aa
                    JOIN analytics.d_athletes a ON aa.athlete_uuid = a.athlete_uuid
                    GROUP BY a.name, aa.session_date, aa.movement_type
                    ORDER BY aa.session_date DESC, a.name
                    LIMIT 10
                """)
                rows = cur.fetchall()
                print("  Sample records:")
                for row in rows:
                    print(f"    - {row['participant_name']}, {row['session_date']}, {row['movement_type']}: {row['num_movements']} movement(s)")
            
            # Check d_athletes with arm action data
            cur.execute("""
                SELECT COUNT(*) as count 
                FROM analytics.d_athletes 
                WHERE has_arm_action_data = TRUE
            """)
            athletes_with_data = cur.fetchone()['count']
            
            cur.execute("""
                SELECT 
                    name, 
                    athlete_uuid,
                    arm_action_session_count as session_count
                FROM analytics.d_athletes
                WHERE has_arm_action_data = TRUE
                ORDER BY name
                LIMIT 20
            """)
            athlete_rows = cur.fetchall()
            
            print(f"\nd_athletes with arm action data: {athletes_with_data} athlete(s)")
            if athlete_rows:
                print("  Athletes with arm action data:")
                for row in athlete_rows:
                    print(f"    - {row['name']}: {row['session_count']} session(s)")
            
            # Get summary statistics
            cur.execute("""
                SELECT 
                    COUNT(DISTINCT athlete_uuid) as unique_athletes,
                    COUNT(DISTINCT session_date) as unique_dates,
                    COUNT(*) as total_movements,
                    COUNT(DISTINCT movement_type) as movement_types
                FROM public.f_arm_action
            """)
            stats = cur.fetchone()
            
            print("\n" + "=" * 100)
            print("SUMMARY STATISTICS")
            print("=" * 100)
            print(f"Unique athletes: {stats['unique_athletes']}")
            print(f"Unique session dates: {stats['unique_dates']}")
            print(f"Total movements: {stats['total_movements']}")
            print(f"Movement types: {stats['movement_types']}")
            
            if stats['movement_types'] > 0:
                cur.execute("""
                    SELECT movement_type, COUNT(*) as count
                    FROM public.f_arm_action
                    GROUP BY movement_type
                    ORDER BY count DESC
                """)
                movement_types = cur.fetchall()
                print("\nMovements by type:")
                for mt in movement_types:
                    print(f"  - {mt['movement_type']}: {mt['count']} movement(s)")
        
    finally:
        conn.close()
    
    print("\n" + "=" * 100)
    print("To update athlete flags:")
    print("  - Run: python main.py (which does this automatically)")
    print("  - Or call: from common.athlete_manager import update_athlete_flags; update_athlete_flags()")
    print("=" * 100)


if __name__ == "__main__":
    check_database_status()
