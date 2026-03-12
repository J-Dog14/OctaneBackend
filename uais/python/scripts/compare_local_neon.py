#!/usr/bin/env python3
"""
Compare Local vs Neon Database

This script compares row counts and data between your local warehouse database
and Neon database to verify migration status.

Usage:
    python python/scripts/compare_local_neon.py
"""

import sys
import os
from pathlib import Path
from typing import Dict, List, Tuple

# Add project root to path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from python.common.athlete_manager import load_db_config
import psycopg2
from psycopg2.extras import RealDictCursor
import yaml


def get_local_connection():
    """Get connection to local warehouse database."""
    # IMPORTANT: do not hardcode credentials in this script.
    # Prefer env vars so this file is safe to commit.
    host = os.environ.get("UAIS_LOCAL_PGHOST", "localhost")
    port = int(os.environ.get("UAIS_LOCAL_PGPORT", "5432"))
    database = os.environ.get("UAIS_LOCAL_PGDATABASE", "uais_warehouse")
    user = os.environ.get("UAIS_LOCAL_PGUSER", "postgres")
    password = os.environ.get("UAIS_LOCAL_PGPASSWORD") or os.environ.get("PGPASSWORD")

    if not password:
        raise RuntimeError(
            "Local DB password not provided. Set UAIS_LOCAL_PGPASSWORD (recommended) "
            "or PGPASSWORD before running compare_local_neon.py."
        )

    return psycopg2.connect(
        host=host,
        port=port,
        database=database,
        user=user,
        password=password,
        connect_timeout=10,
        keepalives=1,
        keepalives_idle=30,
        keepalives_interval=10,
        keepalives_count=5
    )


def get_neon_connection():
    """Get connection to Neon database."""
    config = load_db_config()
    wh_config = config['databases']['warehouse']['postgres']
    
    # Check for connection_string first
    if 'connection_string' in wh_config:
        return psycopg2.connect(wh_config['connection_string'], connect_timeout=10)
    
    # Fallback to individual fields
    return psycopg2.connect(
        host=wh_config['host'],
        port=wh_config['port'],
        database=wh_config['database'],
        user=wh_config['user'],
        password=wh_config['password'],
        connect_timeout=10
    )


def get_table_row_counts(conn, schema: str = 'public') -> Dict[str, int]:
    """Get row counts for all fact tables."""
    counts = {}
    
    with conn.cursor() as cur:
        # Get all fact tables
        cur.execute("""
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = %s
              AND table_name LIKE 'f_%'
            ORDER BY table_name
        """, (schema,))
        
        rows = cur.fetchall()
        # Handle both tuple and list results - be defensive
        tables = []
        for row in rows:
            try:
                if isinstance(row, (tuple, list)) and len(row) > 0:
                    tables.append(row[0])
                elif isinstance(row, dict):
                    tables.append(row.get('table_name', str(row)))
                else:
                    tables.append(str(row))
            except Exception:
                continue
        
        for table in tables:
            try:
                cur.execute(f'SELECT COUNT(*) FROM {schema}."{table}"')
                result = cur.fetchone()
                count = result[0] if result else 0
                counts[table] = count
            except Exception as e:
                counts[table] = f"ERROR: {e}"
    
    # Also check analytics schema
    if schema == 'public':
        with conn.cursor() as cur:
            cur.execute("""
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = 'analytics'
                  AND table_name LIKE 'd_%'
                ORDER BY table_name
            """)
            
            rows = cur.fetchall()
            # Handle both tuple and list results - be defensive
            tables = []
            for row in rows:
                try:
                    if isinstance(row, (tuple, list)) and len(row) > 0:
                        tables.append(row[0])
                    elif isinstance(row, dict):
                        tables.append(row.get('table_name', str(row)))
                    else:
                        tables.append(str(row))
                except Exception:
                    continue
            
            for table in tables:
                try:
                    cur.execute(f'SELECT COUNT(*) FROM analytics."{table}"')
                    result = cur.fetchone()
                    count = result[0] if result else 0
                    counts[f"analytics.{table}"] = count
                except Exception as e:
                    counts[f"analytics.{table}"] = f"ERROR: {e}"
    
    return counts


def compare_databases():
    """Compare local and Neon databases."""
    print("=" * 80)
    print("COMPARING LOCAL vs NEON DATABASES")
    print("=" * 80)
    
    local_conn = None
    neon_conn = None
    
    try:
        print("\n1. Connecting to LOCAL database...")
        local_conn = get_local_connection()
        print("   ✓ Connected to LOCAL")
        
        print("\n2. Connecting to NEON database...")
        neon_conn = get_neon_connection()
        print("   ✓ Connected to NEON")
        
        print("\n3. Getting row counts from LOCAL...")
        local_counts = get_table_row_counts(local_conn)
        
        print("\n4. Getting row counts from NEON...")
        neon_counts = get_table_row_counts(neon_conn)
        
        print("\n" + "=" * 80)
        print("COMPARISON RESULTS")
        print("=" * 80)
        
        # Get all unique table names
        all_tables = set(local_counts.keys()) | set(neon_counts.keys())
        all_tables = sorted(all_tables)
        
        print(f"\n{'Table':<50} {'Local':<15} {'Neon':<15} {'Match':<10}")
        print("-" * 90)
        
        matches = 0
        mismatches = 0
        missing_local = 0
        missing_neon = 0
        
        for table in all_tables:
            local_count = local_counts.get(table, "N/A")
            neon_count = neon_counts.get(table, "N/A")
            
            if local_count == "N/A":
                status = "MISSING LOCAL"
                missing_local += 1
            elif neon_count == "N/A":
                status = "MISSING NEON"
                missing_neon += 1
            elif isinstance(local_count, str) or isinstance(neon_count, str):
                status = "ERROR"
                mismatches += 1
            elif local_count == neon_count:
                status = "✓ MATCH"
                matches += 1
            else:
                status = "✗ DIFFERENT"
                mismatches += 1
            
            print(f"{table:<50} {str(local_count):<15} {str(neon_count):<15} {status:<10}")
        
        print("\n" + "=" * 80)
        print("SUMMARY")
        print("=" * 80)
        print(f"Total tables: {len(all_tables)}")
        print(f"✓ Matches: {matches}")
        print(f"✗ Mismatches: {mismatches}")
        print(f"⚠ Missing in LOCAL: {missing_local}")
        print(f"⚠ Missing in NEON: {missing_neon}")
        
        if mismatches > 0 or missing_neon > 0:
            print("\n⚠ WARNING: Some data may not have been migrated to Neon!")
            print("   Consider re-running pg_dump/pg_restore or checking for errors.")
        elif matches == len(all_tables):
            print("\n✓ SUCCESS: All tables match between Local and Neon!")
        
    except psycopg2.OperationalError as e:
        print(f"\n✗ Connection error: {e}")
        return 1
    except Exception as e:
        print(f"\n✗ Error: {e}")
        import traceback
        traceback.print_exc()
        return 1
    finally:
        if local_conn:
            local_conn.close()
        if neon_conn:
            neon_conn.close()
    
    return 0


if __name__ == '__main__':
    sys.exit(compare_databases())
