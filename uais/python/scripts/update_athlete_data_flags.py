#!/usr/bin/env python3
"""
Update Athlete Data Flags Script

This script updates the data presence flags and session counts in the d_athletes table.
It can be run manually or scheduled to keep the flags in sync with fact tables.

Usage:
    python python/scripts/update_athlete_data_flags.py
"""

import sys
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from python.common.athlete_manager import get_warehouse_connection
import psycopg2

def update_athlete_flags():
    """
    Update all athlete data flags and session counts.
    """
    conn = get_warehouse_connection()
    
    try:
        with conn.cursor() as cur:
            # Call the PostgreSQL function
            cur.execute("SELECT update_athlete_data_flags()")
            conn.commit()
            
            # Get count of updated athletes
            cur.execute("SELECT COUNT(*) FROM analytics.d_athletes")
            total_athletes = cur.fetchone()[0]
            
            # Get summary stats
            cur.execute("""
                SELECT 
                    COUNT(*) FILTER (WHERE has_pitching_data) as with_pitching,
                    COUNT(*) FILTER (WHERE has_athletic_screen_data) as with_athletic_screen,
                    COUNT(*) FILTER (WHERE has_pro_sup_data) as with_pro_sup,
                    COUNT(*) FILTER (WHERE has_readiness_screen_data) as with_readiness,
                    COUNT(*) FILTER (WHERE has_mobility_data) as with_mobility,
                    COUNT(*) FILTER (WHERE has_proteus_data) as with_proteus,
                    COUNT(*) FILTER (WHERE has_hitting_data) as with_hitting
                FROM analytics.d_athletes
            """)
            
            stats = cur.fetchone()
            
            print("=" * 80)
            print("ATHLETE DATA FLAGS UPDATED")
            print("=" * 80)
            print(f"Total athletes: {total_athletes}")
            print()
            print("Athletes with data in each system:")
            print(f"  Pitching: {stats[0]}")
            print(f"  Athletic Screen: {stats[1]}")
            print(f"  Pro-Sup: {stats[2]}")
            print(f"  Readiness Screen: {stats[3]}")
            print(f"  Mobility: {stats[4]}")
            print(f"  Proteus: {stats[5]}")
            print(f"  Hitting: {stats[6]}")
            print("=" * 80)
            
    finally:
        conn.close()

if __name__ == '__main__':
    update_athlete_flags()

