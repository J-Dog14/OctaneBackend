"""
Check Database Sizes for UAIS
Shows sizes of all configured PostgreSQL databases and their tables

Usage:
    python python/scripts/check_database_sizes.py
    python python/scripts/check_database_sizes.py --db verceldb  # Check specific database
    python python/scripts/check_database_sizes.py --tables       # Show table sizes
"""

import sys
import argparse
from pathlib import Path
from typing import Dict, Any, List, Tuple
import yaml
import psycopg2
from psycopg2.extras import RealDictCursor


def load_config() -> Dict[str, Any]:
    """Load database configuration from db_connections.yaml"""
    config_path = Path(__file__).parent.parent.parent / "config" / "db_connections.yaml"
    
    if not config_path.exists():
        raise FileNotFoundError(
            f"Config file not found at {config_path}."
        )
    
    with open(config_path, 'r') as f:
        return yaml.safe_load(f)


def format_bytes(size_bytes: int) -> str:
    """Format bytes into human-readable format"""
    for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
        if size_bytes < 1024.0:
            return f"{size_bytes:.2f} {unit}"
        size_bytes /= 1024.0
    return f"{size_bytes:.2f} PB"


def get_database_size(conn, database_name: str) -> int:
    """Get size of a database in bytes"""
    with conn.cursor() as cur:
        cur.execute("SELECT pg_database_size(%s)", (database_name,))
        result = cur.fetchone()
        return result[0] if result else 0


def get_table_sizes(conn) -> List[Tuple[str, str, int]]:
    """Get sizes of all tables in the current database"""
    query = """
        SELECT 
            schemaname,
            tablename,
            pg_total_relation_size(schemaname||'.'||tablename) AS size_bytes
        FROM pg_tables
        WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
        ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
    """
    
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(query)
        return [(row['schemaname'], row['tablename'], row['size_bytes']) 
                for row in cur.fetchall()]


def get_schema_sizes(conn) -> List[Tuple[str, int, int]]:
    """Get sizes grouped by schema"""
    query = """
        SELECT 
            schemaname,
            COUNT(*) AS table_count,
            SUM(pg_total_relation_size(schemaname||'.'||tablename)) AS total_size_bytes
        FROM pg_tables
        WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
        GROUP BY schemaname
        ORDER BY SUM(pg_total_relation_size(schemaname||'.'||tablename)) DESC
    """
    
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(query)
        return [(row['schemaname'], row['table_count'], row['total_size_bytes']) 
                for row in cur.fetchall()]


def check_database(db_name: str, db_config: Dict[str, Any], show_tables: bool = False):
    """Check size of a single database"""
    pg_config = db_config['postgres']
    
    try:
        # Connect to the specific database
        conn = psycopg2.connect(
            host=pg_config['host'],
            port=pg_config['port'],
            database=pg_config['database'],
            user=pg_config['user'],
            password=pg_config['password'],
            connect_timeout=10
        )
        
        # Get database size
        db_size = get_database_size(conn, pg_config['database'])
        
        print(f"\n{'='*70}")
        print(f"Database: {db_name} ({pg_config['database']})")
        print(f"{'='*70}")
        print(f"Total Size: {format_bytes(db_size)} ({db_size:,} bytes)")
        
        if show_tables:
            # Show schema summary
            schema_sizes = get_schema_sizes(conn)
            if schema_sizes:
                print(f"\nSchema Summary:")
                print(f"{'Schema':<20} {'Tables':<10} {'Size':<15}")
                print("-" * 45)
                for schema, count, size in schema_sizes:
                    print(f"{schema:<20} {count:<10} {format_bytes(size):<15}")
            
            # Show table sizes
            table_sizes = get_table_sizes(conn)
            if table_sizes:
                print(f"\nTable Sizes (Top 20):")
                print(f"{'Schema':<15} {'Table':<35} {'Size':<15}")
                print("-" * 65)
                for schema, table, size in table_sizes[:20]:
                    schema_table = f"{schema}.{table}" if schema != 'public' else table
                    print(f"{schema:<15} {table:<35} {format_bytes(size):<15}")
                
                if len(table_sizes) > 20:
                    print(f"\n... and {len(table_sizes) - 20} more tables")
        
        conn.close()
        
    except psycopg2.Error as e:
        print(f"  [ERROR] Error connecting to {db_name}: {e}")
        return None
    
    return db_size


def main():
    parser = argparse.ArgumentParser(description="Check UAIS database sizes")
    parser.add_argument('--db', type=str, help='Check specific database only (e.g., verceldb, warehouse, app)')
    parser.add_argument('--tables', action='store_true', help='Show table-level sizes')
    args = parser.parse_args()
    
    try:
        config = load_config()
    except Exception as e:
        print(f"Error loading config: {e}")
        sys.exit(1)
    
    databases = config.get('databases', {})
    
    # Filter to only PostgreSQL databases
    pg_databases = {name: config for name, config in databases.items() 
                   if 'postgres' in config}
    
    if not pg_databases:
        print("No PostgreSQL databases found in configuration.")
        sys.exit(1)
    
    print("UAIS Database Size Report")
    print("=" * 70)
    
    total_size = 0
    results = []
    
    # Check databases
    if args.db:
        if args.db not in pg_databases:
            print(f"Database '{args.db}' not found in configuration.")
            print(f"Available databases: {list(pg_databases.keys())}")
            sys.exit(1)
        
        db_size = check_database(args.db, pg_databases[args.db], args.tables)
        if db_size:
            total_size = db_size
    else:
        # Check all databases
        for db_name, db_config in pg_databases.items():
            db_size = check_database(db_name, db_config, args.tables)
            if db_size:
                results.append((db_name, db_size))
                total_size += db_size
        
        # Summary
        if results:
            print(f"\n{'='*70}")
            print("Summary")
            print(f"{'='*70}")
            print(f"{'Database':<20} {'Size':<20}")
            print("-" * 40)
            for db_name, size in sorted(results, key=lambda x: x[1], reverse=True):
                print(f"{db_name:<20} {format_bytes(size):<20}")
            print("-" * 40)
            print(f"{'Total':<20} {format_bytes(total_size):<20}")
    
    print(f"\n{'='*70}")
    print(f"Total Size: {format_bytes(total_size)} ({total_size:,} bytes)")
    
    # Size recommendations
    if total_size > 0:
        print(f"\nSize Recommendations:")
        if total_size < 100 * 1024 * 1024:  # < 100 MB
            print("  [OK] Small database - Free tier on most cloud providers (0.5-1 GB)")
        elif total_size < 1024 * 1024 * 1024:  # < 1 GB
            print("  [OK] Medium database - Most free tiers, or ~$10-20/month")
        elif total_size < 10 * 1024 * 1024 * 1024:  # < 10 GB
            print("  [WARNING] Large database - Consider paid tier (~$20-50/month)")
        else:
            print("  [WARNING] Very large database - May need dedicated instance")


if __name__ == "__main__":
    main()

