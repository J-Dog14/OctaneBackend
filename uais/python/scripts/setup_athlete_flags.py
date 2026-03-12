#!/usr/bin/env python3
"""
Setup script to create athlete flags function and triggers.

This script reads sql/update_athlete_data_flags.sql and executes it
to create the necessary database functions and triggers.
"""

import sys
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from python.common.athlete_manager import get_warehouse_connection

def setup_athlete_flags():
    """Read and execute the SQL setup script."""
    sql_file = project_root / 'sql' / 'update_athlete_data_flags.sql'
    
    if not sql_file.exists():
        print(f"ERROR: SQL file not found: {sql_file}")
        return False
    
    print("=" * 80)
    print("SETTING UP ATHLETE FLAGS")
    print("=" * 80)
    print()
    print(f"Reading SQL file: {sql_file}")
    
    # Read SQL file
    with open(sql_file, 'r', encoding='utf-8') as f:
        sql_content = f.read()
    
    # Split by semicolons (but be careful with function definitions)
    # PostgreSQL functions contain semicolons, so we need to handle them specially
    # For now, just execute the whole thing as one statement
    conn = get_warehouse_connection()
    
    try:
        with conn.cursor() as cur:
            print("Executing SQL...")
            # Execute the entire script
            cur.execute(sql_content)
            conn.commit()
            print("[SUCCESS] Function and triggers created successfully!")
            print()
            
            # Verify function exists
            cur.execute("""
                SELECT EXISTS (
                    SELECT 1 
                    FROM pg_proc p
                    JOIN pg_namespace n ON p.pronamespace = n.oid
                    WHERE n.nspname = 'public'
                    AND p.proname = 'update_athlete_data_flags'
                )
            """)
            function_exists = cur.fetchone()[0]
            
            # Verify triggers exist
            cur.execute("""
                SELECT COUNT(*) 
                FROM pg_trigger
                WHERE tgname LIKE 'trg_update_flags%'
            """)
            trigger_count = cur.fetchone()[0]
            
            print("Verification:")
            print(f"  Function exists: {function_exists}")
            print(f"  Triggers created: {trigger_count}")
            print()
            
            if function_exists and trigger_count > 0:
                print("=" * 80)
                print("SETUP COMPLETE!")
                print("=" * 80)
                print()
                print("Next steps:")
                print("  1. Run update script to set initial flags:")
                print("     python python/scripts/update_athlete_data_flags.py")
                print()
                print("  2. Flags will now update automatically when data is inserted")
                return True
            else:
                print("[WARNING] Setup may have failed - verification incomplete")
                return False
                
    except Exception as e:
        print(f"[ERROR] Failed to execute SQL: {e}")
        conn.rollback()
        return False
    finally:
        conn.close()

if __name__ == '__main__':
    success = setup_athlete_flags()
    sys.exit(0 if success else 1)

