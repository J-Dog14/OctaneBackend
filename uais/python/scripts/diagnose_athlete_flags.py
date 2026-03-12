#!/usr/bin/env python3
"""
Diagnostic script to check athlete flags setup and status.

This script will:
1. Check if the update_athlete_data_flags() function exists
2. Check if triggers are set up
3. Check current flag status
4. Test updating flags
5. Show what needs to be fixed
"""

import sys
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from python.common.athlete_manager import get_warehouse_connection
import psycopg2

def check_function_exists(conn):
    """Check if update_athlete_data_flags function exists."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT EXISTS (
                SELECT 1 
                FROM pg_proc p
                JOIN pg_namespace n ON p.pronamespace = n.oid
                WHERE n.nspname = 'public'
                AND p.proname = 'update_athlete_data_flags'
            )
        """)
        return cur.fetchone()[0]

def check_triggers_exist(conn):
    """Check if triggers are set up on fact tables."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT 
                tgname as trigger_name,
                tgrelid::regclass as table_name
            FROM pg_trigger
            WHERE tgname LIKE 'trg_update_flags%'
            ORDER BY tgname
        """)
        return cur.fetchall()

def check_table_structure(conn):
    """Check if d_athletes has the flag columns."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_schema = 'analytics'
            AND table_name = 'd_athletes'
            AND column_name LIKE '%pitching%'
            ORDER BY column_name
        """)
        return cur.fetchall()

def check_pitching_data_exists(conn):
    """Check if there's pitching data and how many athletes have it."""
    with conn.cursor() as cur:
        # Count total rows in f_kinematics_pitching
        cur.execute("SELECT COUNT(*) FROM public.f_kinematics_pitching")
        total_rows = cur.fetchone()[0]
        
        # Count unique athletes with pitching data
        cur.execute("""
            SELECT COUNT(DISTINCT athlete_uuid) 
            FROM public.f_kinematics_pitching
        """)
        unique_athletes = cur.fetchone()[0]
        
        # Count athletes with has_pitching_data = TRUE
        cur.execute("""
            SELECT COUNT(*) 
            FROM analytics.d_athletes
            WHERE has_pitching_data = TRUE
        """)
        flagged_athletes = cur.fetchone()[0]
        
        return {
            'total_rows': total_rows,
            'unique_athletes': unique_athletes,
            'flagged_athletes': flagged_athletes
        }

def test_update_function(conn):
    """Test if the update function works."""
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT update_athlete_data_flags()")
            conn.commit()
            return True, None
    except Exception as e:
        return False, str(e)

def main():
    print("=" * 80)
    print("ATHLETE FLAGS DIAGNOSTIC")
    print("=" * 80)
    print()
    
    conn = get_warehouse_connection()
    
    try:
        # 1. Check function exists
        print("1. Checking if update_athlete_data_flags() function exists...")
        function_exists = check_function_exists(conn)
        if function_exists:
            print("   [OK] Function exists")
        else:
            print("   [MISSING] Function DOES NOT EXIST")
            print("   -> Need to run: psql -U postgres -d uais_warehouse -f sql/update_athlete_data_flags.sql")
        print()
        
        # 2. Check triggers
        print("2. Checking if triggers are set up...")
        triggers = check_triggers_exist(conn)
        if triggers:
            print(f"   [OK] Found {len(triggers)} trigger(s):")
            for trigger_name, table_name in triggers:
                print(f"     - {trigger_name} on {table_name}")
        else:
            print("   [MISSING] NO TRIGGERS FOUND")
            print("   -> Need to run: psql -U postgres -d uais_warehouse -f sql/update_athlete_data_flags.sql")
        print()
        
        # 3. Check table structure
        print("3. Checking d_athletes table structure...")
        columns = check_table_structure(conn)
        if columns:
            print("   [OK] Flag columns found:")
            for col_name, data_type, is_nullable in columns:
                print(f"     - {col_name} ({data_type})")
        else:
            print("   [MISSING] NO FLAG COLUMNS FOUND")
            print("   → Need to run Prisma migration or add columns manually")
        print()
        
        # 4. Check data status
        print("4. Checking pitching data status...")
        data_status = check_pitching_data_exists(conn)
        print(f"   Total rows in f_kinematics_pitching: {data_status['total_rows']}")
        print(f"   Unique athletes with pitching data: {data_status['unique_athletes']}")
        print(f"   Athletes flagged as having pitching data: {data_status['flagged_athletes']}")
        
        if data_status['total_rows'] > 0:
            if data_status['flagged_athletes'] == 0:
                print("   [WARNING] Data exists but NO athletes are flagged!")
            elif data_status['flagged_athletes'] < data_status['unique_athletes']:
                print(f"   [WARNING] Only {data_status['flagged_athletes']} of {data_status['unique_athletes']} athletes are flagged")
            else:
                print("   [OK] All athletes with data are flagged")
        print()
        
        # 5. Test update function (if it exists)
        if function_exists:
            print("5. Testing update_athlete_data_flags() function...")
            success, error = test_update_function(conn)
            if success:
                print("   [OK] Function executed successfully")
                
                # Check status after update
                data_status_after = check_pitching_data_exists(conn)
                print(f"   Athletes flagged after update: {data_status_after['flagged_athletes']}")
                
                if data_status_after['flagged_athletes'] > data_status['flagged_athletes']:
                    print("   [OK] Flags were updated!")
                else:
                    print("   [WARNING] No change in flag count")
            else:
                print(f"   [ERROR] Function FAILED: {error}")
        else:
            print("5. Skipping function test (function doesn't exist)")
        print()
        
        # Summary and recommendations
        print("=" * 80)
        print("SUMMARY & RECOMMENDATIONS")
        print("=" * 80)
        
        issues = []
        if not function_exists:
            issues.append("Missing update_athlete_data_flags() function")
        if not triggers:
            issues.append("Missing database triggers")
        if not columns:
            issues.append("Missing flag columns in d_athletes table")
        if data_status['total_rows'] > 0 and data_status['flagged_athletes'] == 0:
            issues.append("Data exists but flags not set")
        
        if issues:
            print("ISSUES FOUND:")
            for i, issue in enumerate(issues, 1):
                print(f"  {i}. {issue}")
            print()
            print("TO FIX:")
            print("  1. Ensure Prisma migration has been run (creates flag columns)")
            print("  2. Run SQL setup script:")
            print("     psql -U postgres -d uais_warehouse -f sql/update_athlete_data_flags.sql")
            print("  3. Manually update flags:")
            print("     python python/scripts/update_athlete_data_flags.py")
        else:
            print("[OK] Everything looks good!")
            if data_status['flagged_athletes'] < data_status['unique_athletes']:
                print()
                print("However, flags may need updating. Run:")
                print("  python python/scripts/update_athlete_data_flags.py")
        
    finally:
        conn.close()

if __name__ == '__main__':
    main()

