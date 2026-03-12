#!/usr/bin/env python3
"""
Audit Age Data in f_kinematics_pitching

This script audits the f_kinematics_pitching table to identify:
- Rows missing age_at_collection
- Rows missing age_group
- Rows with age_at_collection but missing age_group (should be calculated)
- Summary statistics by athlete and session

Usage:
    python python/scripts/audit_age_data_pitching.py
"""

import sys
from pathlib import Path
from collections import defaultdict

# Add project root to path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from python.common.athlete_manager import get_warehouse_connection
import psycopg2
from psycopg2.extras import RealDictCursor


def audit_age_data():
    """Audit age_at_collection and age_group data in f_kinematics_pitching."""
    print("=" * 80)
    print("AUDITING AGE DATA IN f_kinematics_pitching")
    print("=" * 80)
    
    conn = None
    try:
        print("\n1. Connecting to warehouse database...")
        conn = get_warehouse_connection()
        print("   [OK] Connected to warehouse")
        
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # Get overall statistics
            print("\n2. Getting overall statistics...")
            cur.execute("""
                SELECT 
                    COUNT(*) as total_rows,
                    COUNT(age_at_collection) as rows_with_age_at_collection,
                    COUNT(age_group) as rows_with_age_group,
                    COUNT(*) - COUNT(age_at_collection) as rows_missing_age_at_collection,
                    COUNT(*) - COUNT(age_group) as rows_missing_age_group,
                    COUNT(CASE WHEN age_at_collection IS NOT NULL AND age_group IS NULL THEN 1 END) as rows_with_age_but_no_group
                FROM public.f_kinematics_pitching
            """)
            stats = cur.fetchone()
            
            print(f"\n   Total rows: {stats['total_rows']:,}")
            print(f"   Rows with age_at_collection: {stats['rows_with_age_at_collection']:,} ({stats['rows_with_age_at_collection']/stats['total_rows']*100:.1f}%)")
            print(f"   Rows with age_group: {stats['rows_with_age_group']:,} ({stats['rows_with_age_group']/stats['total_rows']*100:.1f}%)")
            print(f"   Rows missing age_at_collection: {stats['rows_missing_age_at_collection']:,} ({stats['rows_missing_age_at_collection']/stats['total_rows']*100:.1f}%)")
            print(f"   Rows missing age_group: {stats['rows_missing_age_group']:,} ({stats['rows_missing_age_group']/stats['total_rows']*100:.1f}%)")
            print(f"   Rows with age_at_collection but missing age_group: {stats['rows_with_age_but_no_group']:,}")
            
            # Get unique athletes and sessions affected
            print("\n3. Analyzing affected athletes and sessions...")
            cur.execute("""
                SELECT 
                    COUNT(DISTINCT athlete_uuid) as total_athletes,
                    COUNT(DISTINCT CASE WHEN age_at_collection IS NULL THEN athlete_uuid END) as athletes_missing_age,
                    COUNT(DISTINCT CASE WHEN age_group IS NULL THEN athlete_uuid END) as athletes_missing_group,
                    COUNT(DISTINCT session_date) as total_sessions,
                    COUNT(DISTINCT CASE WHEN age_at_collection IS NULL THEN session_date END) as sessions_missing_age,
                    COUNT(DISTINCT CASE WHEN age_group IS NULL THEN session_date END) as sessions_missing_group
                FROM public.f_kinematics_pitching
            """)
            athlete_stats = cur.fetchone()
            
            print(f"\n   Total unique athletes: {athlete_stats['total_athletes']:,}")
            print(f"   Athletes missing age_at_collection: {athlete_stats['athletes_missing_age']:,}")
            print(f"   Athletes missing age_group: {athlete_stats['athletes_missing_group']:,}")
            print(f"\n   Total unique sessions: {athlete_stats['total_sessions']:,}")
            print(f"   Sessions missing age_at_collection: {athlete_stats['sessions_missing_age']:,}")
            print(f"   Sessions missing age_group: {athlete_stats['sessions_missing_group']:,}")
            
            # Get top athletes with missing data
            print("\n4. Top 10 athletes with most rows missing age_at_collection:")
            cur.execute("""
                SELECT 
                    athlete_uuid,
                    COUNT(*) as missing_count,
                    COUNT(DISTINCT session_date) as affected_sessions
                FROM public.f_kinematics_pitching
                WHERE age_at_collection IS NULL
                GROUP BY athlete_uuid
                ORDER BY missing_count DESC
                LIMIT 10
            """)
            missing_age = cur.fetchall()
            if missing_age:
                for row in missing_age:
                    print(f"   {row['athlete_uuid']}: {row['missing_count']:,} rows across {row['affected_sessions']} sessions")
            else:
                print("   [OK] No rows missing age_at_collection!")
            
            print("\n5. Top 10 athletes with most rows missing age_group:")
            cur.execute("""
                SELECT 
                    athlete_uuid,
                    COUNT(*) as missing_count,
                    COUNT(DISTINCT session_date) as affected_sessions
                FROM public.f_kinematics_pitching
                WHERE age_group IS NULL
                GROUP BY athlete_uuid
                ORDER BY missing_count DESC
                LIMIT 10
            """)
            missing_group = cur.fetchall()
            if missing_group:
                for row in missing_group:
                    print(f"   {row['athlete_uuid']}: {row['missing_count']:,} rows across {row['affected_sessions']} sessions")
            else:
                print("   [OK] No rows missing age_group!")
            
            # Check if athletes with missing age_at_collection have DOB in d_athletes
            print("\n6. Checking if athletes missing age_at_collection have DOB in d_athletes...")
            cur.execute("""
                SELECT 
                    COUNT(DISTINCT p.athlete_uuid) as athletes_missing_age,
                    COUNT(DISTINCT CASE WHEN a.date_of_birth IS NOT NULL THEN p.athlete_uuid END) as athletes_with_dob,
                    COUNT(DISTINCT CASE WHEN a.date_of_birth IS NULL THEN p.athlete_uuid END) as athletes_without_dob
                FROM public.f_kinematics_pitching p
                LEFT JOIN analytics.d_athletes a ON p.athlete_uuid = a.athlete_uuid
                WHERE p.age_at_collection IS NULL
            """)
            dob_check = cur.fetchone()
            
            if dob_check['athletes_missing_age']:
                print(f"\n   Athletes with missing age_at_collection: {dob_check['athletes_missing_age']:,}")
                print(f"   Of those, have DOB in d_athletes: {dob_check['athletes_with_dob']:,}")
                print(f"   Of those, missing DOB in d_athletes: {dob_check['athletes_without_dob']:,}")
                
                if dob_check['athletes_with_dob'] > 0:
                    print(f"\n   [OK] {dob_check['athletes_with_dob']:,} athletes can have age_at_collection backfilled from DOB + session_date")
                if dob_check['athletes_without_dob'] > 0:
                    print(f"   [WARNING] {dob_check['athletes_without_dob']:,} athletes need DOB synced from local database first")
            else:
                print("   [OK] All athletes have age_at_collection!")
            
            # Check age_group values for consistency
            print("\n7. Checking age_group value distribution:")
            cur.execute("""
                SELECT 
                    age_group,
                    COUNT(*) as row_count,
                    COUNT(DISTINCT athlete_uuid) as athlete_count,
                    ROUND(AVG(age_at_collection), 2) as avg_age_at_collection,
                    ROUND(MIN(age_at_collection), 2) as min_age,
                    ROUND(MAX(age_at_collection), 2) as max_age
                FROM public.f_kinematics_pitching
                WHERE age_group IS NOT NULL
                GROUP BY age_group
                ORDER BY row_count DESC
            """)
            age_groups = cur.fetchall()
            if age_groups:
                print(f"\n   {'Age Group':<15} {'Rows':<15} {'Athletes':<15} {'Avg Age':<12} {'Min Age':<12} {'Max Age':<12}")
                print("   " + "-" * 80)
                for row in age_groups:
                    print(f"   {row['age_group']:<15} {row['row_count']:<15,} {row['athlete_count']:<15,} {row['avg_age_at_collection']:<12} {row['min_age']:<12} {row['max_age']:<12}")
            else:
                print("   No age_group values found")
            
            # Check for potential inconsistencies (age_at_collection doesn't match age_group)
            print("\n8. Checking for age_group inconsistencies (age_at_collection doesn't match age_group):")
            cur.execute("""
                SELECT 
                    COUNT(*) as inconsistent_rows,
                    COUNT(DISTINCT athlete_uuid) as affected_athletes
                FROM public.f_kinematics_pitching
                WHERE age_at_collection IS NOT NULL 
                  AND age_group IS NOT NULL
                  AND (
                    (age_at_collection < 13 AND age_group != 'YOUTH') OR
                    (age_at_collection >= 14 AND age_at_collection <= 18 AND age_group != 'HIGH SCHOOL') OR
                    (age_at_collection > 18 AND age_at_collection <= 22 AND age_group != 'COLLEGE') OR
                    (age_at_collection > 22 AND age_group != 'PRO')
                  )
            """)
            inconsistent = cur.fetchone()
            
            if inconsistent['inconsistent_rows']:
                print(f"   [WARNING] Found {inconsistent['inconsistent_rows']:,} rows with inconsistent age_group values")
                print(f"   Affects {inconsistent['affected_athletes']:,} athletes")
                print("\n   Sample inconsistent rows:")
                cur.execute("""
                    SELECT 
                        athlete_uuid,
                        session_date,
                        age_at_collection,
                        age_group,
                        COUNT(*) as row_count
                    FROM public.f_kinematics_pitching
                    WHERE age_at_collection IS NOT NULL 
                      AND age_group IS NOT NULL
                      AND (
                        (age_at_collection < 13 AND age_group != 'YOUTH') OR
                        (age_at_collection >= 14 AND age_at_collection <= 18 AND age_group != 'HIGH SCHOOL') OR
                        (age_at_collection > 18 AND age_at_collection <= 22 AND age_group != 'COLLEGE') OR
                        (age_at_collection > 22 AND age_group != 'PRO')
                      )
                    GROUP BY athlete_uuid, session_date, age_at_collection, age_group
                    ORDER BY row_count DESC
                    LIMIT 5
                """)
                samples = cur.fetchall()
                for sample in samples:
                    print(f"   {sample['athlete_uuid']}: age={sample['age_at_collection']:.2f}, group={sample['age_group']}, {sample['row_count']:,} rows")
            else:
                print("   [OK] No inconsistencies found - all age_group values match age_at_collection!")
            
            # Summary
            print("\n" + "=" * 80)
            print("SUMMARY")
            print("=" * 80)
            
            if stats['rows_missing_age_at_collection'] == 0 and stats['rows_missing_age_group'] == 0:
                print("[OK] All rows have both age_at_collection and age_group!")
            else:
                print("\n[ISSUES FOUND]:")
                if stats['rows_missing_age_at_collection'] > 0:
                    print(f"  - {stats['rows_missing_age_at_collection']:,} rows missing age_at_collection")
                if stats['rows_missing_age_group'] > 0:
                    print(f"  - {stats['rows_missing_age_group']:,} rows missing age_group")
                if stats['rows_with_age_but_no_group'] > 0:
                    print(f"  - {stats['rows_with_age_but_no_group']:,} rows have age_at_collection but missing age_group (can be calculated)")
                
                print("\nNext steps:")
                if stats['rows_missing_age_at_collection'] > 0:
                    print("  1. Run backfill_age_and_age_groups.py to calculate age_at_collection from DOB + session_date")
                if stats['rows_with_age_but_no_group'] > 0:
                    print("  2. Run backfill_age_and_age_groups.py to calculate age_group from age_at_collection")
                if dob_check['athletes_without_dob'] > 0:
                    print("  3. Run sync_dob_local_to_warehouse.py to sync missing DOBs from local database")
        
        return 0
        
    except Exception as e:
        print(f"\n[ERROR]: {e}")
        import traceback
        traceback.print_exc()
        return 1
    finally:
        if conn:
            conn.close()


if __name__ == '__main__':
    sys.exit(audit_age_data())
