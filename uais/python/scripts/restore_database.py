"""
Database Restore Script for UAIS
Restores a PostgreSQL or SQLite database from a backup

Usage:
    # Restore PostgreSQL database
    python python/scripts/restore_database.py --db app --backup backups/app_20240101_120000.sql
    
    # Restore SQLite database
    python python/scripts/restore_database.py --db source_athletic_screen --backup backups/source_athletic_screen_20240101_120000.db
    
    # List available backups
    python python/scripts/restore_database.py --list
"""

import subprocess
import shutil
import sys
import os
import argparse
import gzip
from pathlib import Path
from typing import Dict, Any, Optional
import yaml


def load_config() -> Dict[str, Any]:
    """Load database configuration from db_connections.yaml"""
    config_path = Path(__file__).parent.parent.parent / "config" / "db_connections.yaml"
    
    if not config_path.exists():
        raise FileNotFoundError(
            f"Config file not found at {config_path}."
        )
    
    with open(config_path, 'r') as f:
        return yaml.safe_load(f)


def find_pg_restore() -> Optional[Path]:
    """Find pg_restore or psql executable on Windows"""
    # Common PostgreSQL installation paths
    possible_paths = [
        Path("C:/Program Files/PostgreSQL/16/bin/psql.exe"),
        Path("C:/Program Files/PostgreSQL/15/bin/psql.exe"),
        Path("C:/Program Files/PostgreSQL/14/bin/psql.exe"),
        Path("C:/Program Files/PostgreSQL/13/bin/psql.exe"),
    ]
    
    # Check if psql is in PATH
    try:
        result = subprocess.run(['psql', '--version'], 
                              capture_output=True, text=True, timeout=5)
        if result.returncode == 0:
            return Path('psql')
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass
    
    # Check common installation paths
    for path in possible_paths:
        if path.exists():
            return path
    
    return None


def restore_postgres_db(db_name: str, db_config: Dict[str, Any], backup_file: Path):
    """
    Restore a PostgreSQL database from a SQL dump
    
    Args:
        db_name: Name identifier for the database
        db_config: PostgreSQL connection config from YAML
        backup_file: Path to backup SQL file
    """
    psql_path = find_pg_restore()
    
    if psql_path is None:
        raise FileNotFoundError(
            "psql not found. Please install PostgreSQL or add it to your PATH."
        )
    
    if not backup_file.exists():
        raise FileNotFoundError(f"Backup file not found: {backup_file}")
    
    pg_config = db_config['postgres']
    
    print(f"Restoring PostgreSQL database: {pg_config['database']}...")
    print(f"  From backup: {backup_file.name}")
    print(f"  WARNING: This will overwrite existing data!")
    
    # Confirm before proceeding
    response = input("  Continue? (yes/no): ")
    if response.lower() != 'yes':
        print("  Restore cancelled.")
        return
    
    # Build psql command
    cmd = [
        str(psql_path),
        '-h', pg_config['host'],
        '-p', str(pg_config['port']),
        '-U', pg_config['user'],
        '-d', pg_config['database'],
        '-f', str(backup_file)
    ]
    
    # Set password via environment variable
    env = os.environ.copy()
    env['PGPASSWORD'] = pg_config['password']
    
    try:
        # Handle compressed backups
        if backup_file.suffix == '.gz':
            print("  Decompressing backup...")
            with gzip.open(backup_file, 'rt', encoding='utf-8') as f_in:
                process = subprocess.run(
                    cmd,
                    stdin=f_in,
                    env=env,
                    check=True
                )
        else:
            process = subprocess.run(
                cmd,
                env=env,
                check=True
            )
        
        print(f"  [OK] Database restored successfully!")
        
    except subprocess.CalledProcessError as e:
        raise RuntimeError(f"Restore failed: {e}")


def restore_sqlite_db(db_name: str, db_path: str, backup_file: Path):
    """
    Restore a SQLite database from a backup file
    
    Args:
        db_name: Name identifier for the database
        db_path: Path where SQLite database should be restored
        backup_file: Path to backup file
    """
    if not backup_file.exists():
        raise FileNotFoundError(f"Backup file not found: {backup_file}")
    
    target_path = Path(db_path)
    
    print(f"Restoring SQLite database: {target_path.name}...")
    print(f"  From backup: {backup_file.name}")
    print(f"  WARNING: This will overwrite existing data!")
    
    # Confirm before proceeding
    response = input("  Continue? (yes/no): ")
    if response.lower() != 'yes':
        print("  Restore cancelled.")
        return
    
    try:
        # Handle compressed backups
        if backup_file.suffix == '.gz':
            print("  Decompressing backup...")
            with gzip.open(backup_file, 'rb') as f_in:
                with open(target_path, 'wb') as f_out:
                    shutil.copyfileobj(f_in, f_out)
        else:
            shutil.copy2(backup_file, target_path)
        
        print(f"  [OK] Database restored successfully!")
        print(f"  Location: {target_path}")
        
    except Exception as e:
        raise RuntimeError(f"Restore failed: {e}")


def list_backups(backup_dir: Path):
    """List all available backups"""
    if not backup_dir.exists():
        print(f"Backup directory not found: {backup_dir}")
        return
    
    backups = sorted(backup_dir.glob("*_*.sql*")) + sorted(backup_dir.glob("*_*.db*"))
    backups = [b for b in backups if b.name != "backup_log.txt"]
    
    if not backups:
        print("No backups found.")
        return
    
    print(f"Available backups in {backup_dir}:")
    print("-" * 60)
    
    current_db = None
    for backup in backups:
        # Extract database name (everything before the timestamp)
        parts = backup.stem.split('_')
        if len(parts) >= 3:  # db_name_YYYYMMDD_HHMMSS
            db_name = '_'.join(parts[:-2])
        else:
            db_name = backup.stem
        
        if db_name != current_db:
            if current_db is not None:
                print()
            print(f"{db_name}:")
            current_db = db_name
        
        size_mb = backup.stat().st_size / (1024 * 1024)
        compressed = " (compressed)" if backup.suffix == '.gz' else ""
        print(f"  {backup.name} - {size_mb:.2f} MB{compressed}")


def main():
    parser = argparse.ArgumentParser(description="Restore UAIS database from backup")
    parser.add_argument('--db', type=str, help='Database name to restore (e.g., app, warehouse)')
    parser.add_argument('--backup', type=str, help='Path to backup file')
    parser.add_argument('--list', action='store_true', help='List available backups')
    parser.add_argument('--backup-dir', type=str, default=None,
                       help='Backup directory (default: backups/ in project root)')
    args = parser.parse_args()
    
    project_root = Path(__file__).parent.parent.parent
    if args.backup_dir:
        backup_dir = Path(args.backup_dir)
    else:
        backup_dir = project_root / "backups"
    
    # List backups
    if args.list:
        list_backups(backup_dir)
        return
    
    # Restore database
    if not args.db or not args.backup:
        parser.print_help()
        sys.exit(1)
    
    try:
        config = load_config()
    except Exception as e:
        print(f"Error loading config: {e}")
        sys.exit(1)
    
    backup_file = Path(args.backup)
    if not backup_file.is_absolute():
        backup_file = backup_dir / backup_file
    
    databases = config.get('databases', {})
    source_databases = config.get('source_databases', {})
    
    try:
        if args.db in databases:
            db_config = databases[args.db]
            if 'postgres' in db_config:
                restore_postgres_db(args.db, db_config, backup_file)
            elif 'sqlite' in db_config:
                restore_sqlite_db(args.db, db_config['sqlite'], backup_file)
        elif args.db.startswith('source_') and args.db[7:] in source_databases:
            source_name = args.db[7:]
            restore_sqlite_db(args.db, source_databases[source_name], backup_file)
        else:
            print(f"Database '{args.db}' not found in configuration.")
            print(f"Available databases: {list(databases.keys())}")
            print(f"Available source databases: {list(source_databases.keys())}")
            sys.exit(1)
            
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()

