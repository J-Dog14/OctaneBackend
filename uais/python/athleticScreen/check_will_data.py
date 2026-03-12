"""
Check if Will Saxenmeyer has athletic screen data
"""
import sys
from pathlib import Path

# Add python directory to path
project_root = Path(__file__).parent.parent.parent
python_dir = project_root / "python"
if str(python_dir) not in sys.path:
    sys.path.insert(0, str(python_dir))

from common.athlete_manager import get_warehouse_connection

conn = get_warehouse_connection()

try:
    # Find Will Saxenmeyer's UUID
    with conn.cursor() as cur:
        cur.execute("""
            SELECT athlete_uuid, name
            FROM analytics.d_athletes
            WHERE LOWER(name) LIKE '%saxenmeyer%'
            ORDER BY created_at DESC
            LIMIT 1
        """)
        result = cur.fetchone()
        
        if not result:
            print("Could not find Will Saxenmeyer")
            sys.exit(1)
        
        athlete_uuid = result[0]
        athlete_name = result[1]
        print(f"Found athlete: {athlete_name} (UUID: {athlete_uuid})")
        
        # Check each movement type
        movements = ['CMJ', 'DJ', 'PPU', 'SLV']
        for mov in movements:
            table = f'f_athletic_screen_{mov.lower()}'
            cur.execute(f"""
                SELECT COUNT(*) as count
                FROM public.{table}
                WHERE athlete_uuid = %s
            """, (athlete_uuid,))
            count = cur.fetchone()[0]
            print(f"  {mov}: {count} records")
            
            if count > 0:
                # Get sample data
                cur.execute(f"""
                    SELECT session_date, jh_in, pp_forceplate
                    FROM public.{table}
                    WHERE athlete_uuid = %s
                    ORDER BY session_date DESC
                    LIMIT 3
                """, (athlete_uuid,))
                samples = cur.fetchall()
                print(f"    Sample records:")
                for sample in samples:
                    print(f"      Date: {sample[0]}, JH: {sample[1]}, PP: {sample[2]}")
finally:
    conn.close()

