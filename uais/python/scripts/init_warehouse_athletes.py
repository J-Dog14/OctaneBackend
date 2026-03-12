#!/usr/bin/env python3
"""
Initialize Warehouse Athletes Table

This script creates the analytics.d_athletes table in the warehouse database.
Run this once to set up the athlete dimension table.

Usage:
    python python/scripts/init_warehouse_athletes.py
"""

import sys
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from python.common.athlete_manager import get_warehouse_connection

def main():
    """Create the warehouse athletes table."""
    sql_file = project_root / 'sql' / 'create_warehouse_athletes_table.sql'
    
    if not sql_file.exists():
        print(f"Error: SQL file not found: {sql_file}")
        return 1
    
    print(f"Reading SQL from: {sql_file}")
    with open(sql_file, 'r', encoding='utf-8') as f:
        sql = f.read()
    
    print("Connecting to warehouse database...")
    conn = get_warehouse_connection()
    
    try:
        with conn.cursor() as cur:
            print("Executing SQL...")
            cur.execute(sql)
            conn.commit()
            print("Successfully created analytics.d_athletes table")
            return 0
    except Exception as e:
        print(f"Error: {e}")
        conn.rollback()
        return 1
    finally:
        conn.close()

if __name__ == '__main__':
    sys.exit(main())

