#!/usr/bin/env python3
"""
Inspect athletes table to understand the duplicate issue.
"""

import sys
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from python.common.athlete_manager import (
    get_warehouse_connection,
    normalize_name_for_matching,
    normalize_name_for_display
)
from psycopg2.extras import RealDictCursor
from collections import defaultdict

def inspect_athletes():
    conn = get_warehouse_connection()
    
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute('''
                SELECT 
                    athlete_uuid,
                    name,
                    normalized_name,
                    date_of_birth,
                    created_at
                FROM analytics.d_athletes
                ORDER BY name, created_at
            ''')
            
            all_athletes = cur.fetchall()
        
        print("=" * 100)
        print("ALL ATHLETES IN DATABASE")
        print("=" * 100)
        print(f"Total athletes: {len(all_athletes)}\n")
        
        # Group by re-normalized name
        by_truly_normalized = defaultdict(list)
        for athlete in all_athletes:
            truly_normalized = normalize_name_for_matching(athlete['name'])
            if truly_normalized:
                by_truly_normalized[truly_normalized].append(athlete)
        
        print("=" * 100)
        print("DUPLICATES BY TRULY NORMALIZED NAME (after removing dates)")
        print("=" * 100)
        
        duplicates_found = 0
        for normalized, athletes in sorted(by_truly_normalized.items()):
            if len(athletes) > 1:
                duplicates_found += 1
                print(f"\n{normalized} ({len(athletes)} duplicates):")
                for a in athletes:
                    print(f"  UUID: {a['athlete_uuid']}")
                    print(f"    name: {a['name']}")
                    print(f"    normalized_name: {a['normalized_name']}")
                    print(f"    created_at: {a['created_at']}")
                    print()
        
        print(f"\nTotal duplicate groups: {duplicates_found}")
        
        # Also check for normalized_name conflicts
        print("\n" + "=" * 100)
        print("NORMALIZED_NAME CONFLICTS (same normalized_name, different truly normalized)")
        print("=" * 100)
        
        by_db_normalized = defaultdict(list)
        for athlete in all_athletes:
            by_db_normalized[athlete['normalized_name']].append(athlete)
        
        conflicts = 0
        for db_normalized, athletes in sorted(by_db_normalized.items()):
            if len(athletes) > 1:
                # Check if they truly normalize to the same thing
                truly_normalized_set = {normalize_name_for_matching(a['name']) for a in athletes}
                if len(truly_normalized_set) == 1:
                    # They're true duplicates
                    continue
                else:
                    # They have same normalized_name in DB but are actually different people
                    conflicts += 1
                    print(f"\n{db_normalized} ({len(athletes)} records with same DB normalized_name):")
                    for a in athletes:
                        truly_norm = normalize_name_for_matching(a['name'])
                        print(f"  UUID: {a['athlete_uuid']}")
                        print(f"    name: {a['name']}")
                        print(f"    normalized_name (DB): {a['normalized_name']}")
                        print(f"    truly normalized: {truly_norm}")
                        print()
        
        print(f"\nTotal normalized_name conflicts: {conflicts}")
        
    finally:
        conn.close()

if __name__ == '__main__':
    inspect_athletes()

