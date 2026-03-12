#!/usr/bin/env python3
"""
Standardize Age Group Values in f_kinematics_pitching

This script standardizes age_group values to match the defined format:
- "High School" → "HIGH SCHOOL"
- "College" → "COLLEGE"
- "Pro" → "PRO"
- "YOUTH" → "YOUTH" (already correct)

It also calculates age_group for rows that have age_at_collection but missing age_group.

Usage:
    python python/scripts/standardize_age_groups_pitching.py --dry-run
    python python/scripts/standardize_age_groups_pitching.py
"""

import sys
import argparse
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from python.common.athlete_manager import get_warehouse_connection
from python.common.age_utils import calculate_age_group, standardize_age_group
import psycopg2
from psycopg2.extras import execute_values


def standardize_age_groups(dry_run=False):
    """Standardize age_group values and calculate missing ones."""
    print("=" * 80)
    print("STANDARDIZING AGE GROUP VALUES IN f_kinematics_pitching")
    print("=" * 80)
    
    if dry_run:
        print("\n[DRY RUN MODE] - No changes will be made")
    
    conn = None
    try:
        print("\n1. Connecting to warehouse database...")
        conn = get_warehouse_connection()
        print("   [OK] Connected to warehouse")
        
        with conn.cursor() as cur:
            # Step 1: Standardize existing age_group values
            print("\n2. Standardizing existing age_group values...")
            
            # Get counts of values to change
            cur.execute("""
                SELECT 
                    age_group,
                    COUNT(*) as count
                FROM public.f_kinematics_pitching
                WHERE age_group IS NOT NULL
                GROUP BY age_group
                ORDER BY count DESC
            """)
            existing_groups = cur.fetchall()
            
            print("\n   Current age_group values:")
            for row in existing_groups:
                standardized = standardize_age_group(row[0])
                if standardized != row[0]:
                    print(f"     '{row[0]}' ({row[1]:,} rows) -> '{standardized}'")
                else:
                    print(f"     '{row[0]}' ({row[1]:,} rows) [already standardized]")
            
            # Create mapping of old → new values
            updates = []
            for row in existing_groups:
                old_value = row[0]
                new_value = standardize_age_group(old_value)
                if new_value != old_value:
                    updates.append((new_value, old_value))
            
            if updates:
                print(f"\n   Will update {len(updates)} different age_group values")
                for new_val, old_val in updates:
                    cur.execute("""
                        SELECT COUNT(*) 
                        FROM public.f_kinematics_pitching 
                        WHERE age_group = %s
                    """, (old_val,))
                    count = cur.fetchone()[0]
                    print(f"     '{old_val}' -> '{new_val}': {count:,} rows")
                    
                    if not dry_run:
                        cur.execute("""
                            UPDATE public.f_kinematics_pitching
                            SET age_group = %s
                            WHERE age_group = %s
                        """, (new_val, old_val))
                        updated = cur.rowcount
                        print(f"       Updated {updated:,} rows")
                conn.commit()
                print("   [OK] Standardization complete")
            else:
                print("   [OK] All age_group values are already standardized")
            
            # Step 2: Calculate age_group for rows with age_at_collection but missing age_group
            print("\n3. Calculating age_group for rows with age_at_collection but missing age_group...")
            
            cur.execute("""
                SELECT COUNT(*) 
                FROM public.f_kinematics_pitching
                WHERE age_at_collection IS NOT NULL 
                  AND age_group IS NULL
            """)
            rows_to_calculate = cur.fetchone()[0]
            
            if rows_to_calculate > 0:
                print(f"   Found {rows_to_calculate:,} rows that need age_group calculated")
                
                if not dry_run:
                    # Get all rows that need updating
                    cur.execute("""
                        SELECT 
                            athlete_uuid,
                            session_date,
                            metric_name,
                            frame,
                            age_at_collection
                        FROM public.f_kinematics_pitching
                        WHERE age_at_collection IS NOT NULL 
                          AND age_group IS NULL
                    """)
                    rows = cur.fetchall()
                    
                    # Calculate age_group for each row
                    updates = []
                    for row in rows:
                        age_at_collection = float(row[4])
                        age_group = calculate_age_group(age_at_collection)
                        if age_group:
                            updates.append((age_group, row[0], row[1], row[2], row[3]))
                    
                    print(f"   Calculated age_group for {len(updates):,} rows")
                    
                    # Batch update using execute_values
                    if updates:
                        batch_size = 5000
                        total_updated = 0
                        
                        for i in range(0, len(updates), batch_size):
                            batch = updates[i:i + batch_size]
                            
                            execute_values(
                                cur,
                                """
                                UPDATE public.f_kinematics_pitching p
                                SET age_group = v.age_group::text
                                FROM (VALUES %s) AS v(age_group, athlete_uuid, session_date, metric_name, frame)
                                WHERE p.athlete_uuid = v.athlete_uuid::varchar
                                  AND p.session_date = v.session_date::date
                                  AND p.metric_name = v.metric_name::text
                                  AND p.frame = v.frame::integer
                                  AND p.age_group IS NULL
                                """,
                                batch,
                                template=None,
                                page_size=1000
                            )
                            
                            total_updated += cur.rowcount
                            if (i // batch_size) % 10 == 0:
                                print(f"   Processed {min(i + batch_size, len(updates)):,} of {len(updates):,} rows...")
                        
                        conn.commit()
                        print(f"   [OK] Updated {total_updated:,} rows with calculated age_group")
                else:
                    print(f"   [DRY RUN] Would calculate age_group for {rows_to_calculate:,} rows")
            else:
                print("   [OK] No rows need age_group calculated")
            
            # Step 3: Verify results
            print("\n4. Verifying results...")
            cur.execute("""
                SELECT 
                    age_group,
                    COUNT(*) as count,
                    COUNT(DISTINCT athlete_uuid) as athlete_count
                FROM public.f_kinematics_pitching
                WHERE age_group IS NOT NULL
                GROUP BY age_group
                ORDER BY count DESC
            """)
            final_groups = cur.fetchall()
            
            print("\n   Final age_group distribution:")
            for row in final_groups:
                print(f"     {row[0]}: {row[1]:,} rows, {row[2]:,} athletes")
            
            cur.execute("""
                SELECT COUNT(*) 
                FROM public.f_kinematics_pitching
                WHERE age_at_collection IS NOT NULL AND age_group IS NULL
            """)
            still_missing = cur.fetchone()[0]
            
            if still_missing > 0:
                print(f"\n   [WARNING] {still_missing:,} rows still have age_at_collection but missing age_group")
                print("   This may indicate age_at_collection values outside expected ranges")
            else:
                print("\n   [OK] All rows with age_at_collection now have age_group")
        
        print("\n" + "=" * 80)
        print("STANDARDIZATION COMPLETE")
        print("=" * 80)
        
        return 0
        
    except Exception as e:
        print(f"\n[ERROR]: {e}")
        import traceback
        traceback.print_exc()
        if conn:
            conn.rollback()
        return 1
    finally:
        if conn:
            conn.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Standardize age_group values in f_kinematics_pitching")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be changed without making changes")
    args = parser.parse_args()
    
    sys.exit(standardize_age_groups(dry_run=args.dry_run))
