"""
Database Backup Script for UAIS
Backs up all PostgreSQL and SQLite databases configured in db_connections.yaml

Usage:
    python python/scripts/backup_databases.py
    python python/scripts/backup_databases.py --compress
    python python/scripts/backup_databases.py --keep 7  # Keep last 7 backups
"""

import subprocess
import shutil
import sys
import os
import argparse
import gzip
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, List, Optional
import yaml


def load_config() -> Dict[str, Any]:
    """Load database configuration from db_connections.yaml"""
    config_path = Path(__file__).parent.parent.parent / "config" / "db_connections.yaml"
    
    if not config_path.exists():
        raise FileNotFoundError(
            f"Config file not found at {config_path}. "
            "Copy db_connections.example.yaml to db_connections.yaml and configure."
        )
    
    with open(config_path, 'r') as f:
        return yaml.safe_load(f)


def find_pg_dump() -> Optional[Path]:
    """Find pg_dump executable on Windows"""
    # Common PostgreSQL installation paths on Windows
    possible_paths = [
        Path("C:/Program Files/PostgreSQL/16/bin/pg_dump.exe"),
        Path("C:/Program Files/PostgreSQL/15/bin/pg_dump.exe"),
        Path("C:/Program Files/PostgreSQL/14/bin/pg_dump.exe"),
        Path("C:/Program Files/PostgreSQL/13/bin/pg_dump.exe"),
    ]
    
    # Check if pg_dump is in PATH
    try:
        result = subprocess.run(['pg_dump', '--version'], 
                              capture_output=True, text=True, timeout=5)
        if result.returncode == 0:
            return Path('pg_dump')  # Found in PATH
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass
    
    # Check common installation paths
    for path in possible_paths:
        if path.exists():
            return path
    
    return None


def backup_postgres_db(db_name: str, db_config: Dict[str, Any], 
                      backup_dir: Path, compress: bool = False) -> Path:
    """
    Backup a PostgreSQL database using pg_dump
    
    Args:
        db_name: Name identifier for the database (e.g., 'app', 'warehouse')
        db_config: PostgreSQL connection config from YAML
        backup_dir: Directory to save backup
        compress: Whether to compress the backup
    
    Returns:
        Path to the backup file
    """
    pg_dump_path = find_pg_dump()
    
    if pg_dump_path is None:
        raise FileNotFoundError(
            "pg_dump not found. Please install PostgreSQL or add it to your PATH.\n"
            "You can download PostgreSQL from: https://www.postgresql.org/download/windows/"
        )
    
    # Create backup filename with timestamp
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    extension = ".sql.gz" if compress else ".sql"
    backup_file = backup_dir / f"{db_name}_{timestamp}{extension}"
    
    # Build pg_dump command
    pg_config = db_config['postgres']
    cmd = [
        str(pg_dump_path),
        '-h', pg_config['host'],
        '-p', str(pg_config['port']),
        '-U', pg_config['user'],
        '-d', pg_config['database'],
        '--no-owner',  # Don't include ownership commands
        '--no-acl',    # Don't include access privileges
        '--clean',     # Include DROP statements
        '--if-exists', # Use IF EXISTS for DROP
    ]
    
    # Set password via environment variable (more secure than command line)
    env = os.environ.copy()
    env['PGPASSWORD'] = pg_config['password']
    
    print(f"Backing up PostgreSQL database: {db_config['postgres']['database']}...")
    
    try:
        if compress:
            # Compress on the fly
            with open(backup_file, 'wb') as f_out:
                with gzip.open(f_out, 'wb') as gz_out:
                    process = subprocess.Popen(
                        cmd,
                        stdout=gz_out,
                        stderr=subprocess.PIPE,
                        env=env,
                        text=False
                    )
                    _, stderr = process.communicate()
                    if process.returncode != 0:
                        raise subprocess.CalledProcessError(process.returncode, cmd, stderr=stderr)
        else:
            # Regular SQL dump
            with open(backup_file, 'wb') as f:
                process = subprocess.run(
                    cmd,
                    stdout=f,
                    stderr=subprocess.PIPE,
                    env=env,
                    check=True
                )
        
        file_size = backup_file.stat().st_size / (1024 * 1024)  # MB
        print(f"  [OK] Backup created: {backup_file.name} ({file_size:.2f} MB)")
        return backup_file
        
    except subprocess.CalledProcessError as e:
        error_msg = e.stderr.decode() if isinstance(e.stderr, bytes) else str(e.stderr)
        raise RuntimeError(f"pg_dump failed: {error_msg}")
    except Exception as e:
        # Clean up partial backup on error
        if backup_file.exists():
            backup_file.unlink()
        raise


def backup_sqlite_db(db_name: str, db_path: str, backup_dir: Path, 
                    compress: bool = False) -> Path:
    """
    Backup a SQLite database by copying the file
    
    Args:
        db_name: Name identifier for the database
        db_path: Path to SQLite database file
        backup_dir: Directory to save backup
        compress: Whether to compress the backup
    
    Returns:
        Path to the backup file
    """
    source_path = Path(db_path)
    
    if not source_path.exists():
        raise FileNotFoundError(f"SQLite database not found: {db_path}")
    
    # Create backup filename with timestamp
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    
    if compress:
        backup_file = backup_dir / f"{db_name}_{timestamp}.db.gz"
        print(f"Backing up SQLite database: {source_path.name}...")
        
        # Copy and compress
        with open(source_path, 'rb') as f_in:
            with gzip.open(backup_file, 'wb') as f_out:
                shutil.copyfileobj(f_in, f_out)
    else:
        backup_file = backup_dir / f"{db_name}_{timestamp}.db"
        print(f"Backing up SQLite database: {source_path.name}...")
        
        # Simple copy
        shutil.copy2(source_path, backup_file)
    
    file_size = backup_file.stat().st_size / (1024 * 1024)  # MB
    print(f"  [OK] Backup created: {backup_file.name} ({file_size:.2f} MB)")
    return backup_file


def cleanup_old_backups(backup_dir: Path, db_name: str, keep_count: int):
    """
    Keep only the most recent N backups for a database
    
    Args:
        backup_dir: Directory containing backups
        db_name: Database name to filter by
        keep_count: Number of backups to keep
    """
    # Find all backups for this database
    pattern = f"{db_name}_*.sql*" if "postgres" in db_name.lower() else f"{db_name}_*.db*"
    backups = sorted(backup_dir.glob(pattern), key=lambda p: p.stat().st_mtime, reverse=True)
    
    # Remove old backups
    if len(backups) > keep_count:
        for old_backup in backups[keep_count:]:
            print(f"  Removing old backup: {old_backup.name}")
            old_backup.unlink()


def main():
    parser = argparse.ArgumentParser(description="Backup UAIS databases")
    parser.add_argument('--compress', action='store_true', 
                       help='Compress backups (saves space but slower)')
    parser.add_argument('--keep', type=int, default=0,
                       help='Keep only the last N backups per database (0 = keep all)')
    parser.add_argument('--output-dir', type=str, default=None,
                       help='Custom backup directory (default: backups/ in project root)')
    parser.add_argument('--source', type=str, default='auto',
                       choices=['auto', 'local', 'cloud'],
                       help='Backup source: auto (detect), local (config), or cloud (env vars)')
    args = parser.parse_args()
    
    # Setup backup directory
    project_root = Path(__file__).parent.parent.parent
    if args.output_dir:
        backup_dir = Path(args.output_dir)
    else:
        backup_dir = project_root / "backups"
    
    backup_dir.mkdir(exist_ok=True)
    
    print(f"Backup directory: {backup_dir}")
    print(f"Timestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("-" * 60)
    
    # Load configuration
    try:
        config = load_config()
    except Exception as e:
        print(f"Error loading config: {e}")
        sys.exit(1)
    
    databases = config.get('databases', {})
    source_databases = config.get('source_databases', {})
    
    backed_up = []
    errors = []
    
    # Check for cloud databases
    if args.source == 'cloud':
        print("Note: For cloud database backups, use:")
        print("  python python/scripts/backup_cloud_databases.py")
        print("This script backs up local databases from config file.")
        return
    
    # Backup configured databases (local)
    if args.source in ['auto', 'local']:
        for db_name, db_config in databases.items():
            try:
                if 'postgres' in db_config:
                    backup_file = backup_postgres_db(db_name, db_config, backup_dir, args.compress)
                    backed_up.append((db_name, backup_file))
                    
                    if args.keep > 0:
                        cleanup_old_backups(backup_dir, db_name, args.keep)
                        
                elif 'sqlite' in db_config:
                    backup_file = backup_sqlite_db(db_name, db_config['sqlite'], backup_dir, args.compress)
                    backed_up.append((db_name, backup_file))
                    
                    if args.keep > 0:
                        cleanup_old_backups(backup_dir, db_name, args.keep)
            except Exception as e:
                print(f"  [ERROR] Error backing up {db_name}: {e}")
                errors.append((db_name, str(e)))
    
    # Backup source databases (SQLite files)
    for db_name, db_path in source_databases.items():
        try:
            backup_file = backup_sqlite_db(f"source_{db_name}", db_path, backup_dir, args.compress)
            backed_up.append((f"source_{db_name}", backup_file))
            
            if args.keep > 0:
                cleanup_old_backups(backup_dir, f"source_{db_name}", args.keep)
        except Exception as e:
            print(f"  [ERROR] Error backing up source database {db_name}: {e}")
            errors.append((f"source_{db_name}", str(e)))
    
    # Summary
    print("-" * 60)
    print(f"Backup complete!")
    print(f"  Successfully backed up: {len(backed_up)} database(s)")
    if errors:
        print(f"  Warnings/Errors: {len(errors)} database(s)")
        for db_name, error in errors:
            # Check if it's a "does not exist" error (common and usually fine)
            if "does not exist" in error.lower():
                print(f"    - {db_name}: Database not found (this is OK if database doesn't exist)")
            else:
                print(f"    - {db_name}: {error}")
    
    # Write backup log
    log_file = backup_dir / "backup_log.txt"
    with open(log_file, 'a') as f:
        f.write(f"{datetime.now().isoformat()}\n")
        for db_name, backup_file in backed_up:
            f.write(f"  {db_name}: {backup_file.name}\n")
        if errors:
            f.write("  Errors:\n")
            for db_name, error in errors:
                f.write(f"    {db_name}: {error}\n")
        f.write("\n")
    
    if errors:
        sys.exit(1)


if __name__ == "__main__":
    main()

