#!/usr/bin/env python3
"""
Compare Prisma Schema vs Actual Database Schema

This script queries the actual PostgreSQL database and compares it with
what Prisma expects, helping identify discrepancies between Prisma and Beekeeper views.
"""

import sys
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from python.common.athlete_manager import get_warehouse_connection
import psycopg2
from psycopg2.extras import RealDictCursor

def get_table_columns(conn, schema: str, table: str) -> list:
    """Get all columns for a table."""
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("""
            SELECT 
                column_name,
                data_type,
                is_nullable,
                column_default
            FROM information_schema.columns
            WHERE table_schema = %s AND table_name = %s
            ORDER BY ordinal_position
        """, (schema, table))
        return [dict(row) for row in cur.fetchall()]

def get_all_tables(conn, schemas: list = ['public', 'analytics']) -> list:
    """Get all tables in specified schemas."""
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("""
            SELECT 
                table_schema,
                table_name
            FROM information_schema.tables
            WHERE table_schema = ANY(%s)
            ORDER BY table_schema, table_name
        """, (schemas,))
        return [dict(row) for row in cur.fetchall()]

def main():
    print("=" * 80)
    print("PRISMA vs DATABASE SCHEMA COMPARISON")
    print("=" * 80)
    print()
    
    try:
        conn = get_warehouse_connection()
        
        # Get all tables
        print("Fetching all tables from database...")
        tables = get_all_tables(conn, ['public', 'analytics'])
        print(f"Found {len(tables)} tables\n")
        
        # Check for age_group columns
        print("=" * 80)
        print("CHECKING FOR age_at_collection AND age_group COLUMNS")
        print("=" * 80)
        print()
        
        tables_with_age_group = []
        tables_without_age_group = []
        
        for table_info in tables:
            schema = table_info['table_schema']
            table = table_info['table_name']
            
            # Skip Prisma internal tables
            if table.startswith('_prisma_'):
                continue
            
            columns = get_table_columns(conn, schema, table)
            column_names = [col['column_name'] for col in columns]
            
            has_age_at_collection = 'age_at_collection' in column_names
            has_age_group = 'age_group' in column_names
            
            if has_age_at_collection and has_age_group:
                tables_with_age_group.append((schema, table))
                print(f"✓ {schema}.{table}: Has both age_at_collection and age_group")
            elif has_age_at_collection or has_age_group:
                print(f"⚠ {schema}.{table}: Has age_at_collection={has_age_at_collection}, age_group={has_age_group}")
            else:
                tables_without_age_group.append((schema, table))
                print(f"✗ {schema}.{table}: Missing age_at_collection and age_group")
        
        print()
        print("=" * 80)
        print("SUMMARY")
        print("=" * 80)
        print(f"Tables WITH age_group columns: {len(tables_with_age_group)}")
        print(f"Tables WITHOUT age_group columns: {len(tables_without_age_group)}")
        
        if tables_without_age_group:
            print("\nTables missing age_group columns:")
            for schema, table in tables_without_age_group:
                print(f"  - {schema}.{table}")
        
        # Show sample table structure
        if tables:
            print()
            print("=" * 80)
            print(f"SAMPLE: {tables[0]['table_schema']}.{tables[0]['table_name']} COLUMNS")
            print("=" * 80)
            sample_columns = get_table_columns(conn, tables[0]['table_schema'], tables[0]['table_name'])
            for col in sample_columns[:15]:  # Show first 15 columns
                nullable = "NULL" if col['is_nullable'] == 'YES' else "NOT NULL"
                print(f"  {col['column_name']:30} {col['data_type']:20} {nullable}")
            if len(sample_columns) > 15:
                print(f"  ... and {len(sample_columns) - 15} more columns")
        
        conn.close()
        
    except Exception as e:
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()
        return 1
    
    return 0

if __name__ == '__main__':
    sys.exit(main())

