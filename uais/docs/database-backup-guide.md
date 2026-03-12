# Database Backup Guide

This guide explains how to backup and restore your UAIS databases.

## Overview

Your UAIS system uses multiple databases:
- **PostgreSQL databases**: `app` (local), `warehouse` (uais_warehouse), `verceldb`
- **SQLite source databases**: Athletic Screen, Pro-Sup, etc.

This backup solution backs up all configured databases automatically.

## Quick Start

### Manual Backup

**Using Python:**
```powershell
# Basic backup (uncompressed)
python python/scripts/backup_databases.py

# Compressed backup (saves space)
python python/scripts/backup_databases.py --compress

# Keep only last 7 backups per database
python python/scripts/backup_databases.py --compress --keep 7
```

**Using PowerShell wrapper:**
```powershell
# Basic backup
.\backup_databases.ps1

# Compressed backup
.\backup_databases.ps1 -Compress

# Keep last 7 backups
.\backup_databases.ps1 -Compress -Keep 7
```

### Restore Database

```powershell
# List available backups
python python/scripts/restore_database.py --list

# Restore PostgreSQL database
python python/scripts/restore_database.py --db app --backup backups/app_20240101_120000.sql

# Restore SQLite database
python python/scripts/restore_database.py --db source_athletic_screen --backup backups/source_athletic_screen_20240101_120000.db
```

## Backup Location

Backups are stored in the `backups/` directory in your project root:
```
UAIS/
├── backups/
│   ├── app_20240101_120000.sql          # App database backup
│   ├── warehouse_20240101_120000.sql    # Warehouse database backup
│   ├── verceldb_20240101_120000.sql     # Vercel database backup
│   ├── source_athletic_screen_20240101_120000.db  # Source database backup
│   ├── source_pro_sup_20240101_120000.db
│   └── backup_log.txt                   # Backup history log
```

## Automated Backups (Windows Task Scheduler)

### Option 1: Daily Backup at 2 AM

1. **Open Task Scheduler** (search "Task Scheduler" in Windows)

2. **Create Basic Task:**
   - Name: "UAIS Database Backup"
   - Trigger: Daily at 2:00 AM
   - Action: Start a program
   - Program: `powershell.exe`
   - Arguments: `-File "C:\Users\Joey\PycharmProjects\UAIS\backup_databases.ps1" -Compress -Keep 7`
   - Start in: `C:\Users\Joey\PycharmProjects\UAIS`

3. **Set Conditions:**
   - ✅ Run whether user is logged on or not
   - ✅ Run with highest privileges (if needed for PostgreSQL access)

### Option 2: Weekly Backup Script

Create a batch file `weekly_backup.bat`:
```batch
@echo off
cd /d "C:\Users\Joey\PycharmProjects\UAIS"
powershell.exe -File "backup_databases.ps1" -Compress -Keep 4
```

Schedule this to run weekly.

## Backup Options

### Compression

**Uncompressed backups:**
- Faster to create
- Easier to inspect/restore
- Larger file size

**Compressed backups:**
- Smaller file size (typically 70-90% reduction)
- Slower to create/restore
- Still readable (gzip format)

**Recommendation:** Use compression for automated backups, uncompressed for manual backups you might inspect.

### Retention Policy

Use `--keep N` to automatically delete old backups:
```powershell
# Keep last 7 backups per database
python python/scripts/backup_databases.py --compress --keep 7
```

This helps manage disk space. Without `--keep`, all backups are kept.

## What Gets Backed Up

The backup script automatically backs up:

1. **All databases in `config/db_connections.yaml`:**
   - `app` (PostgreSQL)
   - `warehouse` (PostgreSQL)
   - `verceldb` (PostgreSQL)
   - Any SQLite databases configured

2. **All source databases:**
   - Athletic Screen database
   - Pro-Sup database
   - Any other source databases in config

## Restore Process

### Restore PostgreSQL Database

1. **List available backups:**
   ```powershell
   python python/scripts/restore_database.py --list
   ```

2. **Restore from backup:**
   ```powershell
   python python/scripts/restore_database.py --db app --backup backups/app_20240101_120000.sql
   ```

3. **The script will:**
   - Ask for confirmation (type "yes" to proceed)
   - Drop existing tables
   - Restore from backup
   - Recreate all data

**⚠️ Warning:** Restoring will **overwrite** existing data. Make sure you have a current backup before restoring!

### Restore SQLite Database

```powershell
python python/scripts/restore_database.py --db source_athletic_screen --backup backups/source_athletic_screen_20240101_120000.db
```

The SQLite file will be copied back to its original location.

## Off-Site Backup (Recommended)

For disaster recovery, store backups in cloud storage:

### Option 1: OneDrive / Google Drive

1. **Create a backup script that copies to cloud:**
   ```powershell
   # backup_to_cloud.ps1
   .\backup_databases.ps1 -Compress -Keep 7
   
   # Copy to OneDrive
   $backupDir = "C:\Users\Joey\PycharmProjects\UAIS\backups"
   $cloudDir = "$env:USERPROFILE\OneDrive\UAIS_Backups"
   Copy-Item -Path "$backupDir\*" -Destination $cloudDir -Recurse -Force
   ```

2. **Schedule this script** instead of the basic backup script

### Option 2: External Drive

1. **Modify backup script to copy to external drive:**
   ```powershell
   .\backup_databases.ps1 -Compress -Keep 7 -OutputDir "E:\UAIS_Backups"
   ```

2. **Run weekly** and keep external drive in safe location

### Option 3: Automated Cloud Sync

Use tools like:
- **rclone** - Sync to Google Drive, Dropbox, S3, etc.
- **FreeFileSync** - GUI-based file synchronization
- **Windows Backup** - Built-in Windows backup to network drive

## Backup Verification

### Check Backup Log

The backup script creates a log file:
```
backups/backup_log.txt
```

This contains a history of all backups with timestamps.

### Verify Backup Integrity

**For PostgreSQL:**
```powershell
# Test restore to a test database
createdb test_restore
psql -d test_restore -f backups/app_20240101_120000.sql
```

**For SQLite:**
```powershell
# Open backup file in SQLite browser
sqlite3 backups/source_athletic_screen_20240101_120000.db
.schema
```

## Troubleshooting

### Error: "pg_dump not found"

**Solution:** Install PostgreSQL or add it to PATH:
1. Download PostgreSQL from https://www.postgresql.org/download/windows/
2. During installation, check "Add to PATH"
3. Or manually add `C:\Program Files\PostgreSQL\16\bin` to PATH

### Error: "Permission denied"

**Solution:** Run PowerShell as Administrator, or ensure your PostgreSQL user has backup permissions.

### Error: "Database is locked" (SQLite)

**Solution:** Close Beekeeper Studio or any other application using the database, then retry backup.

### Backup File is Empty

**Possible causes:**
- Database is empty (check with Beekeeper)
- pg_dump failed silently (check backup_log.txt)
- Compression issue (try uncompressed backup)

## Best Practices

1. **Backup regularly:**
   - Daily for active development
   - Weekly for stable systems

2. **Test restores:**
   - Periodically test restoring from backup
   - Verify data integrity after restore

3. **Keep multiple backups:**
   - Use `--keep 7` to keep a week of backups
   - Store monthly backups separately

4. **Off-site backup:**
   - Don't rely only on local backups
   - Use cloud storage or external drive

5. **Before major changes:**
   - Always backup before:
     - Running ETL scripts
     - Database migrations
     - Bulk data imports
     - Schema changes

## Backup Size Estimates

Typical backup sizes (uncompressed):
- **App database**: 1-10 MB (small, mostly metadata)
- **Warehouse database**: 100 MB - 10 GB (depends on data volume)
- **Source databases**: 10-100 MB each

With compression, expect 70-90% size reduction.

## Example Workflow

**Daily automated backup:**
```powershell
# Task Scheduler runs at 2 AM:
.\backup_databases.ps1 -Compress -Keep 7
```

**Weekly manual verification:**
```powershell
# Check backup log
Get-Content backups\backup_log.txt -Tail 20

# List recent backups
python python/scripts/restore_database.py --list
```

**Monthly off-site backup:**
```powershell
# Copy to external drive
Copy-Item -Path "backups\*" -Destination "E:\UAIS_Backups\Monthly" -Recurse
```

## Summary

- ✅ **Easy to use**: Single command backs up everything
- ✅ **Automatic**: Can be scheduled with Task Scheduler
- ✅ **Flexible**: Compressed or uncompressed, retention policy
- ✅ **Safe**: Confirmation required before restore
- ✅ **Complete**: Backs up all configured databases

Your databases are critical - make sure you have regular backups!



