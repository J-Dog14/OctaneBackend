# Neon Multi-Database Setup Guide

Complete guide for setting up multiple Neon databases (main and dev) and using Neon branches.

## Overview

You have two main approaches:
1. **Separate Neon Projects** - Create completely separate projects (main and dev)
2. **Neon Branches** - Use Neon's branching feature (like Git branches for databases)

Both approaches work, but **Neon Branches** are recommended because they're designed for this exact use case and make it easy to create, merge, and manage database copies.

---

## Option 1: Neon Branches (Recommended)

Neon branches are like Git branches but for databases. You can:
- Create a branch from your main database (instant copy)
- Make changes in the branch without affecting main
- Merge branches back to main
- Delete branches when done

### Step 1: Create a Branch in Neon Dashboard

1. **Go to Neon Dashboard**: https://console.neon.tech
2. **Select your project** (the one with your main database)
3. **Click "Branches"** in the left sidebar
4. **Click "Create Branch"**
5. **Name it** (e.g., `dev` or `development`)
6. **Choose parent branch** (usually `main` or your default branch)
7. **Click "Create"**

**That's it!** You now have a complete copy of your database that you can modify independently.

### Step 2: Get Connection Strings

After creating a branch:

1. **Click on the branch** in the branches list
2. **Copy the connection string** (it will be different from main)
3. **Save it** - you'll need it for your dev environment

Each branch has its own connection string that looks like:
```
postgres://user:password@ep-xxx.region.aws.neon.tech/neondb?sslmode=require
```

### Step 3: Configure Your Code

You have several options for switching between main and dev:

#### Option A: Use Environment Variables (Recommended)

Create separate `.env` files or use environment variables:

**`.env.main`** (or set in production):
```bash
APP_DATABASE_URL="postgres://user:pass@ep-main.region.aws.neon.tech/neondb?sslmode=require"
WAREHOUSE_DATABASE_URL="postgres://user:pass@ep-main.region.aws.neon.tech/neondb?sslmode=require"
```

**`.env.dev`** (or set in development):
```bash
APP_DATABASE_URL="postgres://user:pass@ep-dev.region.aws.neon.tech/neondb?sslmode=require"
WAREHOUSE_DATABASE_URL="postgres://user:pass@ep-dev.region.aws.neon.tech/neondb?sslmode=require"
```

**Switch between them:**
```powershell
# Use main (production)
Copy-Item .env.main .env

# Use dev (development)
Copy-Item .env.dev .env
```

#### Option B: Use Separate Environment Variable Names

Update your `.env` file to have both:

```bash
# Main (Production) Databases
APP_DATABASE_URL_MAIN="postgres://user:pass@ep-main.region.aws.neon.tech/neondb?sslmode=require"
WAREHOUSE_DATABASE_URL_MAIN="postgres://user:pass@ep-main.region.aws.neon.tech/neondb?sslmode=require"

# Dev (Development) Databases
APP_DATABASE_URL_DEV="postgres://user:pass@ep-dev.region.aws.neon.tech/neondb?sslmode=require"
WAREHOUSE_DATABASE_URL_DEV="postgres://user:pass@ep-dev.region.aws.neon.tech/neondb?sslmode=require"

# Active environment (switch this)
ENVIRONMENT=main  # or "dev"

# Active URLs (set based on ENVIRONMENT)
APP_DATABASE_URL="${APP_DATABASE_URL_MAIN}"
WAREHOUSE_DATABASE_URL="${WAREHOUSE_DATABASE_URL_MAIN}"
```

Then update `python/common/config.py` to check `ENVIRONMENT` variable.

#### Option C: Use YAML Config with Multiple Entries

Update `config/db_connections.yaml`:

```yaml
databases:
  app:
    postgres:
      # Main database
      main:
        connection_string: "postgres://user:pass@ep-main.region.aws.neon.tech/neondb?sslmode=require"
      # Dev database
      dev:
        connection_string: "postgres://user:pass@ep-dev.region.aws.neon.tech/neondb?sslmode=require"
  
  warehouse:
    postgres:
      # Main database
      main:
        connection_string: "postgres://user:pass@ep-main.region.aws.neon.tech/neondb?sslmode=require"
      # Dev database
      dev:
        connection_string: "postgres://user:pass@ep-dev.region.aws.neon.tech/neondb?sslmode=require"
```

### Step 4: Working with Branches

#### Create a New Branch
- In Neon dashboard → Branches → Create Branch
- Or use Neon CLI (if installed)

#### Switch to a Branch
- Just use the branch's connection string in your `.env` file
- Your code automatically connects to that branch

#### Merge Branch to Main
1. In Neon dashboard → Branches
2. Click on your dev branch
3. Click "Merge" or "Promote" (if available)
4. This copies all changes from dev to main

#### Delete a Branch
- In Neon dashboard → Branches → Delete branch
- **Warning:** This permanently deletes the branch and all its data

---

## Option 2: Separate Neon Projects

If you prefer completely separate projects (not branches):

### Step 1: Create New Project in Neon

1. **Go to Neon Dashboard**: https://console.neon.tech
2. **Click "New Project"**
3. **Name it** (e.g., `uais-dev` or `uais-main`)
4. **Select region** (same as your main project)
5. **Click "Create Project"**

### Step 2: Copy Data from Main to Dev

You have several options:

#### Option A: Use pg_dump and psql

```powershell
# Export from main
pg_dump "postgres://user:pass@ep-main.region.aws.neon.tech/neondb?sslmode=require" > main_backup.sql

# Import to dev
psql "postgres://user:pass@ep-dev.region.aws.neon.tech/neondb?sslmode=require" < main_backup.sql
```

#### Option B: Use Your Migration Script

```powershell
python python/scripts/migrate_to_cloud.py --source neon --target neon --db warehouse --source-conn "main_connection_string" --target-conn "dev_connection_string"
```

#### Option C: Use Neon's Point-in-Time Restore

If Neon supports it, you can restore a snapshot to a new project.

### Step 3: Configure Your Code

Same as Option 1, Step 3 above - use environment variables or YAML config.

---

## Recommended Setup: Environment Variables with Branches

Here's the simplest and most flexible approach:

### 1. Create Dev Branch in Neon

- Go to Neon dashboard
- Create a branch called `dev` from your main branch
- Copy the connection string

### 2. Update Your .env File

Add both main and dev connection strings to your `.env` file:

```bash
# Main (Production) - Your current connection strings
APP_DATABASE_URL_MAIN="postgres://user:pass@ep-main.region.aws.neon.tech/neondb?sslmode=require"
WAREHOUSE_DATABASE_URL_MAIN="postgres://user:pass@ep-main.region.aws.neon.tech/neondb?sslmode=require"

# Dev (Development) - New branch connection strings
APP_DATABASE_URL_DEV="postgres://user:pass@ep-dev.region.aws.neon.tech/neondb?sslmode=require"
WAREHOUSE_DATABASE_URL_DEV="postgres://user:pass@ep-dev.region.aws.neon.tech/neondb?sslmode=require"

# Active environment (use switch-db-env.ps1 to change this)
ENVIRONMENT=main

# Active URLs (these are updated by switch-db-env.ps1 script)
# When ENVIRONMENT=main, these should point to _MAIN URLs
# When ENVIRONMENT=dev, these should point to _DEV URLs
APP_DATABASE_URL="postgres://user:pass@ep-main.region.aws.neon.tech/neondb?sslmode=require"
WAREHOUSE_DATABASE_URL="postgres://user:pass@ep-main.region.aws.neon.tech/neondb?sslmode=require"
```

**Note:** The `APP_DATABASE_URL` and `WAREHOUSE_DATABASE_URL` are the active URLs that your code uses. The switch script will update these automatically.

### 3. Use the Helper Script

A helper script `switch-db-env.ps1` has been created in your project root. Use it to switch between environments:

```powershell
# Switch to dev
.\switch-db-env.ps1 -Environment dev

# Switch to main
.\switch-db-env.ps1 -Environment main

# Check current environment
.\check-db-env.ps1
```

The script will:
- Update the `ENVIRONMENT` variable
- Update `APP_DATABASE_URL` to point to the correct database
- Update `WAREHOUSE_DATABASE_URL` to point to the correct database
- Show you which databases are now active

---

## Best Practices

### 1. Always Backup Before Switching

```powershell
# Backup main before making changes
python python/scripts/backup_cloud_databases.py --compress
```

### 2. Use Dev for Testing

- Test schema changes in dev first
- Test data migrations in dev
- Only promote to main after testing

### 3. Keep Branches in Sync

Periodically refresh your dev branch from main:
- Create a new dev branch from main (replaces old dev)
- Or use Neon's merge/restore features

### 4. Document Your Setup

Keep track of:
- Which branch/project is main
- Which branch/project is dev
- Connection strings (securely)
- When you last synced dev from main

---

## Cost Considerations

### Neon Free Tier
- **1 project** (but unlimited branches within that project!)
- 0.5 GB storage per project
- Branches share storage with the parent project

### Neon Paid Plans
- Multiple projects allowed
- More storage
- Better performance

**Recommendation:** Use **branches** (Option 1) to stay within free tier limits. Branches are essentially free copies of your database.

---

## Troubleshooting

### Connection Issues

**Problem:** Can't connect to branch

**Solution:**
- Verify connection string is correct
- Check that branch exists in Neon dashboard
- Ensure `?sslmode=require` is in connection string

### Data Not Syncing

**Problem:** Changes in dev not appearing in main

**Solution:**
- Branches are independent - you need to merge them
- Or manually copy data using migration scripts

### Wrong Database

**Problem:** Accidentally writing to main instead of dev

**Solution:**
- Always check `ENVIRONMENT` variable before running scripts
- Add a confirmation prompt to destructive operations
- Use read-only connections when possible

---

## Quick Reference

### Create Dev Branch
1. Neon Dashboard → Branches → Create Branch → Name: `dev`

### Switch to Dev
```powershell
.\switch-db-env.ps1 -Environment dev
```

### Switch to Main
```powershell
.\switch-db-env.ps1 -Environment main
```

### Check Current Environment
```powershell
.\check-db-env.ps1
```

### Backup Current Database
```powershell
python python/scripts/backup_cloud_databases.py --compress
```

---

## Next Steps

1. **Create dev branch** in Neon dashboard
2. **Update `.env`** with both main and dev connection strings
3. **Create switch script** (or use the one provided above)
4. **Test switching** between environments
5. **Set up regular backups** of both main and dev

You're all set! You now have a safe development environment that won't affect your production data.
