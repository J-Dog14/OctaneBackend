#!/usr/bin/env python3
"""
Check which athletes are missing DOB and try to find them in local database by name.
"""

import sys
import os
from pathlib import Path

project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from python.common.athlete_manager import get_warehouse_connection, load_db_config
import psycopg2
from psycopg2.extras import RealDictCursor
import yaml

# Set local password
os.environ['UAIS_LOCAL_PGPASSWORD'] = 'Byoung15!'

def get_local_connection():
    return psycopg2.connect(
        host=os.environ.get("UAIS_LOCAL_PGHOST", "localhost"),
        port=int(os.environ.get("UAIS_LOCAL_PGPORT", "5432")),
        database=os.environ.get("UAIS_LOCAL_PGDATABASE", "uais_warehouse"),
        user=os.environ.get("UAIS_LOCAL_PGUSER", "postgres"),
        password=os.environ.get("UAIS_LOCAL_PGPASSWORD"),
        connect_timeout=10
    )

def get_app_connection():
    config = load_db_config()
    app_config = config['databases']['app']['postgres']
    return psycopg2.connect(
        host=app_config['host'],
        port=app_config['port'],
        database=app_config['database'],
        user=app_config['user'],
        password=app_config['password'],
        connect_timeout=10
    )

def main():
    print("Checking athletes missing DOB in warehouse...")
    
    wh = get_warehouse_connection()
    local = get_local_connection()
    
    try:
        with wh.cursor(cursor_factory=RealDictCursor) as cur:
            # Get the 3 athletes with missing DOB that have pitching data
            cur.execute("""
                SELECT 
                    a.athlete_uuid, 
                    a.name, 
                    a.normalized_name,
                    COUNT(p.id) as row_count
                FROM analytics.d_athletes a
                INNER JOIN public.f_kinematics_pitching p ON a.athlete_uuid = p.athlete_uuid
                WHERE a.date_of_birth IS NULL
                GROUP BY a.athlete_uuid, a.name, a.normalized_name
                ORDER BY row_count DESC
                LIMIT 10
            """)
            missing_dob = cur.fetchall()
            
            print(f"\nFound {len(missing_dob)} athletes missing DOB with pitching data:")
            for athlete in missing_dob:
                print(f"\n  UUID: {athlete['athlete_uuid']}")
                print(f"  Name: {athlete['name']}")
                print(f"  Normalized: {athlete['normalized_name']}")
                
                # Check local database
                with local.cursor(cursor_factory=RealDictCursor) as local_cur:
                    # Try by UUID first
                    local_cur.execute("""
                        SELECT athlete_uuid, name, normalized_name, date_of_birth
                        FROM analytics.d_athletes
                        WHERE athlete_uuid = %s
                    """, (athlete['athlete_uuid'],))
                    local_by_uuid = local_cur.fetchone()
                    
                    if local_by_uuid and local_by_uuid['date_of_birth']:
                        print(f"  [FOUND BY UUID] DOB: {local_by_uuid['date_of_birth']}")
                    else:
                        # Try by normalized name
                        local_cur.execute("""
                            SELECT athlete_uuid, name, normalized_name, date_of_birth
                            FROM analytics.d_athletes
                            WHERE normalized_name = %s
                            LIMIT 5
                        """, (athlete['normalized_name'],))
                        local_by_name = local_cur.fetchall()
                        
                        if local_by_name:
                            print(f"  [FOUND BY NAME] {len(local_by_name)} matches:")
                            for match in local_by_name:
                                print(f"    UUID: {match['athlete_uuid']}, Name: {match['name']}, DOB: {match['date_of_birth']}")
                        else:
                            print(f"  [NOT FOUND] No match in local database")
                    
                    # Check app database
                    try:
                        app = get_app_connection()
                        with app.cursor(cursor_factory=RealDictCursor) as app_cur:
                            app_cur.execute("""
                                SELECT uuid, name, "dateOfBirth"
                                FROM public."User"
                                WHERE LOWER(TRIM(name)) = LOWER(%s)
                                LIMIT 1
                            """, (athlete['normalized_name'],))
                            app_match = app_cur.fetchone()
                            
                            if app_match and app_match['dateOfBirth']:
                                print(f"  [FOUND IN APP DB] DOB: {app_match['dateOfBirth']}")
                            else:
                                print(f"  [NOT IN APP DB] No DOB found in app database")
                        app.close()
                    except Exception as e:
                        print(f"  [ERROR] Could not check app database: {e}")
    
    finally:
        wh.close()
        local.close()

if __name__ == '__main__':
    main()
