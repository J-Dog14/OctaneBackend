# PowerShell Scripts Guide

This guide explains what each PowerShell script does and when to use them.

## Setup Scripts (One-Time Use)

### `setup-neon.ps1`

**Purpose:** Interactive setup wizard for connecting to Neon

**When to use:** 
- First time setting up Neon
- If you need to update your Neon connection string

**What it does:**
1. Guides you through creating a Neon project
2. Asks for your connection string
3. Updates `.env` file with `WAREHOUSE_DATABASE_URL`
4. Tests the connection
5. Optionally helps migrate data

**Usage:**
```powershell
.\setup-neon.ps1
```

**Status:** You've already used this - you don't need to run it again unless you're setting up a new Neon database.

### `setup-cloud-databases.ps1`

**Purpose:** General cloud database setup helper

**When to use:**
- First time setting up cloud databases
- If you need guidance on Vercel/Neon setup

**What it does:**
- Checks if `.env` exists
- Provides step-by-step instructions for Vercel and Neon
- Doesn't actually configure anything (just guides you)

**Usage:**
```powershell
.\setup-cloud-databases.ps1
```

**Status:** You've already set up Neon, so you don't need this anymore.

### `setup-prisma.ps1`

**Purpose:** Initial Prisma setup

**When to use:**
- First time setting up Prisma
- If Prisma dependencies are missing

**What it does:**
- Installs npm dependencies
- Sets up Prisma
- Generates Prisma clients

**Usage:**
```powershell
.\setup-prisma.ps1
```

**Status:** One-time setup - you've probably already done this.

## Daily/Recurring Scripts

### `backup_databases.ps1`

**Purpose:** Backup your databases (local and cloud)

**When to use:**
- Daily backups (schedule with Windows Task Scheduler)
- Before making major changes
- Manual backups when needed

**What it does:**
- Runs the Python backup script
- Backs up all databases from `config/db_connections.yaml`
- Can compress backups
- Can keep only N most recent backups

**Usage:**
```powershell
# Basic backup
.\backup_databases.ps1

# Compressed backup
.\backup_databases.ps1 -Compress

# Keep only last 7 backups
.\backup_databases.ps1 -Compress -Keep 7
```

**Status:** You should set this up to run daily! See scheduling section below.

## Other Scripts

### `run_python.ps1`

**Purpose:** Helper to run Python scripts with virtual environment

**When to use:**
- If you have issues running Python scripts directly
- Ensures you're using the correct Python/venv

**Usage:**
```powershell
.\run_python.ps1 python/scripts/backup_databases.py
```

### Domain-Specific Scripts

- `python\mobility\setup_daily_task.ps1` - Sets up daily task for mobility ETL
- `python\proteus\setup_daily_task.ps1` - Sets up daily task for proteus ETL

These are for scheduling domain-specific ETL jobs.

## Setting Up Daily Backups

### Option 1: Windows Task Scheduler (Recommended)

1. **Open Task Scheduler:**
   - Press `Win + R`
   - Type `taskschd.msc`
   - Press Enter

2. **Create Basic Task:**
   - Right-click "Task Scheduler Library" → "Create Basic Task"
   - Name: "UAIS Daily Database Backup"
   - Trigger: Daily, set time (e.g., 2:00 AM)
   - Action: Start a program
   - Program: `powershell.exe`
   - Arguments: `-File "C:\Users\Joey\PycharmProjects\UAIS\backup_databases.ps1" -Compress -Keep 7`
   - Start in: `C:\Users\Joey\PycharmProjects\UAIS`

3. **Test it:**
   - Right-click the task → "Run"
   - Check that backup files are created

### Option 2: Manual Daily Run

Just run it manually when you remember:
```powershell
.\backup_databases.ps1 -Compress -Keep 7
```

### Option 3: Add to Existing Daily Scripts

If you already have daily ETL scripts, add backup to them:
```powershell
# At the end of your daily ETL script
.\backup_databases.ps1 -Compress
```

## What You Need to Do

### Already Done (One-Time Setup)
- [x] `setup-neon.ps1` - Connected to Neon
- [x] `setup-cloud-databases.ps1` - Got guidance
- [x] Neon database is set up

### Should Do Now
- [ ] **Set up daily backups** - Schedule `backup_databases.ps1` to run daily
- [ ] **Test backup restore** - Make sure you can restore from backups if needed

### Optional
- [ ] Use `backup_databases.ps1` before major changes
- [ ] Review backup files periodically to ensure they're working

## Summary

**One-time setup scripts (already done):**
- `setup-neon.ps1` - Neon connection
- `setup-cloud-databases.ps1` - Setup guidance
- `setup-prisma.ps1` - Prisma setup

**Daily/recurring scripts (should schedule):**
- `backup_databases.ps1` - **Schedule this to run daily!**

**Helper scripts:**
- `run_python.ps1` - Python execution helper
- Domain-specific setup scripts

The main thing you need to do is **schedule daily backups** using Windows Task Scheduler.

