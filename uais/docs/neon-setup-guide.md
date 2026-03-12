# Neon Database Setup Guide

Step-by-step guide to set up your UAIS warehouse database on Neon.

## Step 1: Create Neon Account and Project

1. **Go to Neon**: https://neon.tech
2. **Sign up** (or log in if you have an account)
3. **Create a new project**:
   - Click "Create Project"
   - Choose a project name (e.g., "uais-warehouse")
   - Select a region (closest to you)
   - Choose PostgreSQL version (latest is fine)
   - Click "Create Project"

## Step 2: Get Connection String

After creating the project:

1. **You'll see the connection string** on the project page
2. **It looks like**: `postgres://user:password@ep-xxx.region.aws.neon.tech/neondb?sslmode=require`
3. **Copy this connection string** - you'll need it

**Alternative:** If you don't see it immediately:
1. Click on your project
2. Look for "Connection Details" or "Connection String"
3. Copy the connection string

## Step 3: Update Your .env File

Open your `.env` file and update `WAREHOUSE_DATABASE_URL`:

```bash
# Change this line:
WAREHOUSE_DATABASE_URL="postgresql://postgres:Byoung15!@localhost:5432/uais_warehouse?schema=public"

# To this (using your Neon connection string):
WAREHOUSE_DATABASE_URL="postgres://user:password@ep-xxx.region.aws.neon.tech/neondb?sslmode=require"
```

**Important:** Make sure the connection string includes `?sslmode=require` at the end.

## Step 4: Test the Connection

Test that you can connect to Neon:

```powershell
python python/scripts/check_database_sizes.py --db warehouse
```

This should connect to Neon and show your database size (will be 0 or very small since it's empty).

## Step 5: Migrate Your Data

**Important:** Make sure you've completed Step 3 (updated `.env` with `WAREHOUSE_DATABASE_URL`) before running the migration. The script will automatically use that environment variable.

### Option A: Use Migration Script (Recommended)

**If you've already set `WAREHOUSE_DATABASE_URL` in your `.env` file** (which you should have done in Step 3):

```powershell
# Backup local database first!
python python/scripts/backup_databases.py --compress

# Migrate to Neon (script will automatically use WAREHOUSE_DATABASE_URL from .env)
python python/scripts/migrate_to_cloud.py --source local --target neon --db warehouse
```

**If you haven't set it in .env yet**, you can provide it directly:

```powershell
python python/scripts/migrate_to_cloud.py --source local --target neon --db warehouse --target-conn "postgresql://neondb_owner:npg_7EvrQcJsO1LB@ep-cold-bonus-a4zk087n-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
```

But it's better to set it in `.env` first (Step 3), then you don't need the `--target-conn` flag.

### Option B: Manual Migration with pg_dump

```powershell
# Export from local
pg_dump -h localhost -U postgres -d uais_warehouse > warehouse_backup.sql

# Import to Neon (replace with your connection string)
psql "postgres://user:password@ep-xxx.region.aws.neon.tech/neondb?sslmode=require" < warehouse_backup.sql
```

## Step 6: Verify Migration

1. **Check database size:**
   ```powershell
   python python/scripts/check_database_sizes.py --db warehouse --tables
   ```

2. **Test a query:**
   ```powershell
   python -c "from python.common.config import get_warehouse_engine; from sqlalchemy import text; engine = get_warehouse_engine(); conn = engine.connect(); result = conn.execute(text('SELECT COUNT(*) FROM analytics.d_athletes')); print('Athletes:', result.scalar())"
   ```

3. **Check in Beekeeper** (if you want):
   - Add Neon as a new PostgreSQL connection
   - Use the connection string from Neon
   - Browse your tables

## Step 7: Update Prisma (If Using)

**Important:** Before running Prisma migrations, see `docs/safe-prisma-migrations-guide.md` for instructions on syncing your schema and avoiding data loss.

If you're using Prisma for the warehouse:

1. **Update .env** (already done in Step 3)
2. **Sync schema from Neon database:**
   ```powershell
   npm run prisma:warehouse:db:pull
   ```
   This updates your schema.prisma to match what's actually in Neon.

3. **Mark existing migrations as applied:**
   ```powershell
   npx prisma migrate resolve --applied --schema=prisma/warehouse/schema.prisma
   ```

4. **For future migrations, use deploy (not dev):**
   ```powershell
   npm run prisma:warehouse:migrate:deploy
   ```

**See `docs/safe-prisma-migrations-guide.md` for full details on safe migration workflow.**

## Troubleshooting

### Connection Timeout

**Problem:** Can't connect to Neon

**Solutions:**
- Check firewall settings
- Verify IP whitelist in Neon dashboard (if enabled)
- Make sure connection string includes `?sslmode=require`
- Test with `psql` command line first

### SSL Connection Required

**Problem:** SSL connection errors

**Solution:** Make sure connection string ends with `?sslmode=require`

### Migration Fails

**Problem:** Data migration errors

**Solutions:**
- Make sure local database is backed up first
- Check that Neon database is empty (or drop tables if needed)
- Verify connection string is correct
- Check migration logs for specific errors

### Schema Issues

**Problem:** Tables not found after migration

**Solutions:**
- Make sure you're using the correct schema (`analytics` for dimension tables, `public` for fact tables)
- Check that migrations ran successfully
- Verify table names match your Prisma schema

## After Migration

### Keep Local as Backup

You can:
- Keep local database as backup
- Or delete it if you're confident in Neon
- Or keep both and sync periodically

### Update Your Workflow

1. **ETL scripts** will now write to Neon automatically (via `WAREHOUSE_DATABASE_URL`)
2. **Backup scripts** can backup from Neon:
   ```powershell
   python python/scripts/backup_cloud_databases.py --compress
   ```
3. **Local development** - You can still use local if you comment out `WAREHOUSE_DATABASE_URL` in `.env`

## Switching Between Local and Neon

### Use Neon (Production)

```bash
# In .env
WAREHOUSE_DATABASE_URL="postgres://user:pass@ep-xxx.region.aws.neon.tech/neondb?sslmode=require"
```

### Use Local (Development)

```bash
# In .env - comment out Neon, uncomment local
# WAREHOUSE_DATABASE_URL="postgres://user:pass@ep-xxx.region.aws.neon.tech/neondb?sslmode=require"
WAREHOUSE_DATABASE_URL="postgresql://postgres:Byoung15!@localhost:5432/uais_warehouse?schema=public"
```

## Cost

Neon free tier includes:
- 0.5 GB storage
- 1 project
- Unlimited compute time (with limits)

This should be plenty for your warehouse database size.

## Next Steps

1. Create Neon project
2. Get connection string
3. Update `.env` file
4. Test connection
5. Migrate data
6. Verify everything works
7. Set up daily backups from Neon

You're all set!

