"""
Migrate Database to Cloud (Neon/Vercel)
Migrates data from local PostgreSQL to cloud databases

Usage:
    python python/scripts/migrate_to_cloud.py --source local --target vercel --db app
    python python/scripts/migrate_to_cloud.py --source local --target neon --db warehouse
    python python/scripts/migrate_to_cloud.py --source local --target neon --db warehouse --dry-run
"""

import subprocess
import sys
import argparse
import os
from pathlib import Path
from typing import Dict, Any, Optional
import yaml
import psycopg2
from urllib.parse import urlparse


def load_config() -> Dict[str, Any]:
    """Load database configuration"""
    config_path = Path(__file__).parent.parent.parent / "config" / "db_connections.yaml"
    
    if not config_path.exists():
        raise FileNotFoundError(f"Config file not found at {config_path}")
    
    with open(config_path, 'r') as f:
        return yaml.safe_load(f)


def find_pg_dump() -> Optional[Path]:
    """Find pg_dump executable"""
    possible_paths = [
        Path("C:/Program Files/PostgreSQL/16/bin/pg_dump.exe"),
        Path("C:/Program Files/PostgreSQL/15/bin/pg_dump.exe"),
        Path("C:/Program Files/PostgreSQL/14/bin/pg_dump.exe"),
    ]
    
    try:
        result = subprocess.run(['pg_dump', '--version'], 
                              capture_output=True, text=True, timeout=5)
        if result.returncode == 0:
            return Path('pg_dump')
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass
    
    for path in possible_paths:
        if path.exists():
            return path
    
    return None


def find_psql() -> Optional[Path]:
    """Find psql executable"""
    possible_paths = [
        Path("C:/Program Files/PostgreSQL/16/bin/psql.exe"),
        Path("C:/Program Files/PostgreSQL/15/bin/psql.exe"),
        Path("C:/Program Files/PostgreSQL/14/bin/psql.exe"),
    ]
    
    try:
        result = subprocess.run(['psql', '--version'], 
                              capture_output=True, text=True, timeout=5)
        if result.returncode == 0:
            return Path('psql')
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass
    
    for path in possible_paths:
        if path.exists():
            return path
    
    return None


def get_connection_string_from_config(db_name: str, config: Dict[str, Any]) -> Optional[str]:
    """Get connection string from config"""
    databases = config.get('databases', {})
    if db_name not in databases:
        return None
    
    db_config = databases[db_name]
    if 'postgres' not in db_config:
        return None
    
    pg = db_config['postgres']
    
    # Check for connection_string first
    if 'connection_string' in pg:
        return pg['connection_string']
    
    # Build from individual fields
    return f"postgresql://{pg['user']}:{pg['password']}@{pg['host']}:{pg['port']}/{pg['database']}"


def get_connection_string_from_env(db_name: str) -> Optional[str]:
    """Get connection string from environment variable"""
    env_var = f"{db_name.upper()}_DATABASE_URL"
    return os.environ.get(env_var)


def test_connection(conn_str: str) -> bool:
    """Test database connection"""
    try:
        parsed = urlparse(conn_str)
        conn = psycopg2.connect(
            host=parsed.hostname,
            port=parsed.port or 5432,
            database=parsed.path.lstrip('/'),
            user=parsed.username,
            password=parsed.password,
            sslmode='require' if 'sslmode=require' in conn_str else 'prefer'
        )
        conn.close()
        return True
    except Exception as e:
        print(f"  Connection test failed: {e}")
        return False


def migrate_database(source_conn_str: str, target_conn_str: str, 
                    db_name: str, dry_run: bool = False, confirm: bool = True):
    """Migrate database from source to target.
    
    When confirm=False, skips the interactive confirmation (for automated use).
    """
    
    pg_dump_path = find_pg_dump()
    psql_path = find_psql()
    
    if not pg_dump_path:
        raise FileNotFoundError("pg_dump not found. Please install PostgreSQL.")
    if not psql_path:
        raise FileNotFoundError("psql not found. Please install PostgreSQL.")
    
    print(f"\n{'='*70}")
    print(f"Migrating {db_name} database")
    print(f"{'='*70}")
    print(f"Source: {source_conn_str.split('@')[1] if '@' in source_conn_str else 'local'}")
    print(f"Target: {target_conn_str.split('@')[1] if '@' in target_conn_str else 'cloud'}")
    
    if dry_run:
        print("\n[DRY RUN] Would execute:")
        print(f"  pg_dump {source_conn_str.split('@')[0]}@...")
        print(f"  psql {target_conn_str.split('@')[0]}@...")
        return True
    
    # Test connections
    print("\nTesting connections...")
    if not test_connection(source_conn_str):
        print("  [ERROR] Source connection failed")
        return False
    print("  [OK] Source connection OK")
    
    if not test_connection(target_conn_str):
        print("  [ERROR] Target connection failed")
        return False
    print("  [OK] Target connection OK")
    
    # Confirm (unless --yes / confirm=False)
    if confirm:
        print("\n[WARNING] This will overwrite data in the target database!")
        response = input("Continue? (yes/no): ")
        if response.lower() != 'yes':
            print("Migration cancelled.")
            return False
    
    # Export from source
    print("\nExporting from source database...")
    dump_file = Path(f"temp_{db_name}_dump.sql")
    
    try:
        parsed_source = urlparse(source_conn_str)
        env = os.environ.copy()
        env['PGPASSWORD'] = parsed_source.password
        
        cmd = [
            str(pg_dump_path),
            '-h', parsed_source.hostname,
            '-p', str(parsed_source.port or 5432),
            '-U', parsed_source.username,
            '-d', parsed_source.path.lstrip('/'),
            '--no-owner',
            '--no-acl',
            '--clean',
            '--if-exists',
            '-f', str(dump_file)
        ]
        
        process = subprocess.run(cmd, env=env, check=True, capture_output=True, text=True)
        dump_size = dump_file.stat().st_size / (1024 * 1024)
        print(f"  [OK] Export complete: {dump_size:.2f} MB")
        
    except subprocess.CalledProcessError as e:
        print(f"  [ERROR] Export failed: {e.stderr}")
        if dump_file.exists():
            dump_file.unlink()
        return False
    
    # Import to target
    print("\nImporting to target database...")
    
    try:
        parsed_target = urlparse(target_conn_str)
        env = os.environ.copy()
        env['PGPASSWORD'] = parsed_target.password
        
        # Read dump file and pipe to psql
        with open(dump_file, 'r', encoding='utf-8') as f:
            cmd = [
                str(psql_path),
                '-h', parsed_target.hostname,
                '-p', str(parsed_target.port or 5432),
                '-U', parsed_target.username,
                '-d', parsed_target.path.lstrip('/'),
            ]
            
            # Add SSL mode if needed
            if 'sslmode=require' in target_conn_str:
                cmd.extend(['-v', 'sslmode=require'])
            
            process = subprocess.run(
                cmd,
                stdin=f,
                env=env,
                check=True,
                capture_output=True,
                text=True
            )
        
        print("  [OK] Import complete")
        
    except subprocess.CalledProcessError as e:
        print(f"  [ERROR] Import failed: {e.stderr}")
        print(f"  Error output: {e.stdout}")
        return False
    finally:
        # Clean up
        if dump_file.exists():
            dump_file.unlink()
    
    print(f"\n[OK] Migration complete!")
    return True


def main():
    parser = argparse.ArgumentParser(description="Migrate database to cloud")
    parser.add_argument('--source', type=str, required=True, 
                       choices=['local', 'neon'], help='Source database location')
    parser.add_argument('--target', type=str, required=True,
                       choices=['vercel', 'neon'], help='Target cloud provider')
    parser.add_argument('--db', type=str, required=True,
                       choices=['app', 'warehouse'], help='Database to migrate')
    parser.add_argument('--dry-run', action='store_true',
                       help='Show what would be done without executing')
    parser.add_argument('--yes', '-y', action='store_true',
                       help='Skip confirmation prompt (for automation)')
    parser.add_argument('--source-conn', type=str, default=None,
                       help='Source connection string (overrides config; required for source=neon)')
    parser.add_argument('--target-conn', type=str, default=None,
                       help='Target connection string (overrides config; required for target=neon when copying between branches)')
    args = parser.parse_args()
    
    # Neon-to-Neon (branch copy) requires both connection strings
    if args.source == 'neon' and args.target == 'neon':
        if not args.source_conn or not args.target_conn:
            print("Error: For neon-to-neon copy, both --source-conn and --target-conn are required.")
            sys.exit(1)
        source_conn_str = args.source_conn
        target_conn_str = args.target_conn
    else:
        # Load config when using local source
        try:
            config = load_config()
        except Exception as e:
            print(f"Error loading config: {e}")
            sys.exit(1)
        
        # Get source connection string
        if args.source_conn:
            source_conn_str = args.source_conn
        else:
            source_conn_str = get_connection_string_from_config(args.db, config)
            if not source_conn_str:
                print(f"Error: Could not find source connection for {args.db}")
                print("Please provide --source-conn or update config file")
                sys.exit(1)
        
        # Get target connection string
        if args.target_conn:
            target_conn_str = args.target_conn
        else:
            env_var = f"{args.db.upper()}_DATABASE_URL"
            target_conn_str = os.environ.get(env_var)
            if not target_conn_str:
                print(f"\nError: Target connection string not found.")
                print(f"Please provide --target-conn or set {env_var} environment variable")
                sys.exit(1)
    
    # Perform migration
    try:
        ok = migrate_database(
            source_conn_str, target_conn_str, args.db,
            dry_run=args.dry_run, confirm=not args.yes
        )
        if ok is False:
            sys.exit(1)
    except Exception as e:
        print(f"\nError: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()

