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
from config import DB_PATH
import sqlite3


def check_database_status():
    """Display current warehouse database status."""
    conn = get_warehouse_connection()
    
    try:
        print("=" * 100)
        print("WAREHOUSE DATABASE STATUS CHECK - CURVEBALL TEST")
        print("=" * 100)
        
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # Check f_curveball_test table
            cur.execute("SELECT COUNT(*) as count FROM public.f_curveball_test")
            curveball_count = cur.fetchone()['count']
            print(f"\nf_curveball_test: {curveball_count} record(s)")
            
            if curveball_count > 0:
                # Get sample data
                cur.execute("""
                    SELECT DISTINCT 
                        a.name as participant_name, 
                        ct.session_date, 
                        ct.pitch_type,
                        ct.filename,
                        ct.foot_contact_frame,
                        ct.release_frame,
                        ct.pitch_stability_score,
                        jsonb_object_keys(ct.angle_accel_data) as sample_key
                    FROM public.f_curveball_test ct
                    JOIN analytics.d_athletes a ON ct.athlete_uuid = a.athlete_uuid
                    ORDER BY ct.session_date DESC, a.name
                    LIMIT 10
                """)
                rows = cur.fetchall()
                print("  Sample records:")
                for row in rows:
                    print(f"    - {row['participant_name']}, {row['session_date']}, {row['pitch_type']}: "
                          f"FC={row['foot_contact_frame']}, REL={row['release_frame']}, "
                          f"Score={row['pitch_stability_score']}")
                    if row.get('sample_key'):
                        print(f"      (Sample angle data key: {row['sample_key']})")
            
            # Check d_athletes with curveball test data
            cur.execute("""
                SELECT COUNT(*) as count 
                FROM analytics.d_athletes 
                WHERE has_curveball_test_data = TRUE
            """)
            athletes_with_data = cur.fetchone()['count']
            
            cur.execute("""
                SELECT 
                    name, 
                    athlete_uuid,
                    curveball_test_session_count as session_count
                FROM analytics.d_athletes
                WHERE has_curveball_test_data = TRUE
                ORDER BY name
                LIMIT 20
            """)
            athlete_rows = cur.fetchall()
            
            print(f"\nd_athletes with curveball test data: {athletes_with_data} athlete(s)")
            if athlete_rows:
                print("  Athletes with curveball test data:")
                for row in athlete_rows:
                    print(f"    - {row['name']}: {row['session_count']} session(s)")
            
            # Get summary statistics
            cur.execute("""
                SELECT 
                    COUNT(DISTINCT athlete_uuid) as unique_athletes,
                    COUNT(DISTINCT session_date) as unique_dates,
                    COUNT(*) as total_pitches,
                    COUNT(DISTINCT pitch_type) as pitch_types
                FROM public.f_curveball_test
            """)
            stats = cur.fetchone()
            
            print("\n" + "=" * 100)
            print("SUMMARY STATISTICS")
            print("=" * 100)
            print(f"Unique athletes: {stats['unique_athletes']}")
            print(f"Unique session dates: {stats['unique_dates']}")
            print(f"Total pitches: {stats['total_pitches']}")
            print(f"Pitch types: {stats['pitch_types']}")
            
            if stats['pitch_types'] > 0:
                cur.execute("""
                    SELECT pitch_type, COUNT(*) as count
                    FROM public.f_curveball_test
                    GROUP BY pitch_type
                    ORDER BY count DESC
                """)
                pitch_types = cur.fetchall()
                print("\nPitches by type:")
                for pt in pitch_types:
                    print(f"  - {pt['pitch_type']}: {pt['count']} pitch(es)")
            
            # Check angle_accel_data structure
            if curveball_count > 0:
                cur.execute("""
                    SELECT 
                        jsonb_object_keys(angle_accel_data) as key
                    FROM public.f_curveball_test
                    LIMIT 1
                """)
                sample_keys = cur.fetchall()
                if sample_keys:
                    print(f"\nAngle/accel data keys (sample): {len(sample_keys)} keys found")
                    print("  (Should have x, y, z, ax, ay, az for offsets -20 to +30)")
        
    finally:
        conn.close()
    
    # Also check SQLite reference_data if it exists
    print("\n" + "=" * 100)
    print("SQLITE REFERENCE DATA CHECK")
    print("=" * 100)
    try:
        sqlite_conn = sqlite3.connect(DB_PATH)
        c = sqlite_conn.cursor()
        
        tables = ['reference_data', 'pitch_data_archive']
        for table in tables:
            try:
                c.execute(f"SELECT COUNT(*) FROM {table}")
                count = c.fetchone()[0]
                print(f"\n{table}: {count} record(s)")
            except sqlite3.OperationalError:
                print(f"\n{table}: Table does not exist")
        
        sqlite_conn.close()
    except Exception as e:
        print(f"Could not check SQLite database: {e}")
    
    print("\n" + "=" * 100)
    print("To update athlete flags:")
    print("  - Run: python main.py (which does this automatically)")
    print("  - Or call: from common.athlete_manager import update_athlete_flags; update_athlete_flags()")
    print("=" * 100)


if __name__ == "__main__":
    check_database_status()
