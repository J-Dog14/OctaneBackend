"""
Backup Cloud Databases (Neon/Vercel)
Backs up databases from cloud providers to local storage

Usage:
    python python/scripts/backup_cloud_databases.py
    python python/scripts/backup_cloud_databases.py --compress --keep 7
"""

import subprocess
import sys
import argparse
import os
import gzip
from pathlib import Path
from datetime import datetime
from typing import Optional
from urllib.parse import urlparse


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


def backup_from_connection_string(conn_str: str, db_name: str, 
                                  backup_dir: Path, compress: bool = False) -> Path:
    """Backup database from connection string"""
    
    pg_dump_path = find_pg_dump()
    if not pg_dump_path:
        raise FileNotFoundError("pg_dump not found. Please install PostgreSQL.")
    
    parsed = urlparse(conn_str)
    
    # Create backup filename
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    extension = ".sql.gz" if compress else ".sql"
    backup_file = backup_dir / f"{db_name}_cloud_{timestamp}{extension}"
    
    # Build command
    cmd = [
        str(pg_dump_path),
        '-h', parsed.hostname,
        '-p', str(parsed.port or 5432),
        '-U', parsed.username,
        '-d', parsed.path.lstrip('/'),
        '--no-owner',
        '--no-acl',
        '--clean',
        '--if-exists',
    ]
    
    # Add SSL mode
    if 'sslmode=require' in conn_str or 'sslmode=require' in parsed.query:
        cmd.append('--no-password')  # Will use PGPASSWORD env var
    
    env = os.environ.copy()
    env['PGPASSWORD'] = parsed.password
    
    print(f"Backing up {db_name} from cloud...")
    
    try:
        if compress:
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
            with open(backup_file, 'wb') as f:
                process = subprocess.run(
                    cmd,
                    stdout=f,
                    stderr=subprocess.PIPE,
                    env=env,
                    check=True
                )
        
        file_size = backup_file.stat().st_size / (1024 * 1024)
        print(f"  [OK] Backup created: {backup_file.name} ({file_size:.2f} MB)")
        return backup_file
        
    except subprocess.CalledProcessError as e:
        error_msg = e.stderr.decode() if isinstance(e.stderr, bytes) else str(e.stderr)
        raise RuntimeError(f"pg_dump failed: {error_msg}")


def cleanup_old_backups(backup_dir: Path, db_name: str, keep_count: int):
    """Keep only the most recent N backups"""
    pattern = f"{db_name}_cloud_*.sql*"
    backups = sorted(backup_dir.glob(pattern), key=lambda p: p.stat().st_mtime, reverse=True)
    
    if len(backups) > keep_count:
        for old_backup in backups[keep_count:]:
            print(f"  Removing old backup: {old_backup.name}")
            old_backup.unlink()


def main():
    parser = argparse.ArgumentParser(description="Backup cloud databases")
    parser.add_argument('--compress', action='store_true', help='Compress backups')
    parser.add_argument('--keep', type=int, default=0, help='Keep only last N backups')
    parser.add_argument('--output-dir', type=str, default=None, help='Backup directory')
    args = parser.parse_args()
    
    # Setup backup directory
    project_root = Path(__file__).parent.parent.parent
    if args.output_dir:
        backup_dir = Path(args.output_dir)
    else:
        backup_dir = project_root / "backups"
    
    backup_dir.mkdir(exist_ok=True)
    
    print(f"Cloud Database Backup")
    print(f"{'='*70}")
    print(f"Backup directory: {backup_dir}")
    print(f"Timestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("-" * 70)
    
    # Get connection strings from environment
    app_conn_str = os.environ.get('APP_DATABASE_URL')
    warehouse_conn_str = os.environ.get('WAREHOUSE_DATABASE_URL')
    
    if not app_conn_str and not warehouse_conn_str:
        print("Error: No cloud database connection strings found.")
        print("Please set APP_DATABASE_URL and/or WAREHOUSE_DATABASE_URL in .env file")
        sys.exit(1)
    
    backed_up = []
    errors = []
    
    # Backup app database
    if app_conn_str:
        try:
            backup_file = backup_from_connection_string(
                app_conn_str, 'app', backup_dir, args.compress
            )
            backed_up.append(('app', backup_file))
            
            if args.keep > 0:
                cleanup_old_backups(backup_dir, 'app', args.keep)
        except Exception as e:
            print(f"  [ERROR] Error backing up app database: {e}")
            errors.append(('app', str(e)))
    
    # Backup warehouse database
    if warehouse_conn_str:
        try:
            backup_file = backup_from_connection_string(
                warehouse_conn_str, 'warehouse', backup_dir, args.compress
            )
            backed_up.append(('warehouse', backup_file))
            
            if args.keep > 0:
                cleanup_old_backups(backup_dir, 'warehouse', args.keep)
        except Exception as e:
            print(f"  [ERROR] Error backing up warehouse database: {e}")
            errors.append(('warehouse', str(e)))
    
    # Summary
    print("-" * 70)
    print(f"Backup complete!")
    print(f"  Successfully backed up: {len(backed_up)} database(s)")
    if errors:
        print(f"  Errors: {len(errors)} database(s)")
        for db_name, error in errors:
            print(f"    - {db_name}: {error}")
    
    if errors:
        sys.exit(1)


if __name__ == "__main__":
    main()

