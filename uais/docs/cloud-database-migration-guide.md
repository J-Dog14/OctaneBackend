# Cloud Database Migration Guide (Neon + Vercel)

This guide explains how to migrate your UAIS databases to Neon (warehouse) and Vercel (app database) while maintaining your current local setup.

## Architecture Overview

**Recommended Setup:**
- **Vercel Postgres**: App database (User table, small, frequently accessed)
- **Neon**: Warehouse database (large fact tables, analytics)
- **Local PostgreSQL**: Keep for development/testing

**Why this split?**
- Vercel: Tight integration if you deploy to Vercel, good for app data
- Neon: Better for large datasets, analytics workloads, branching for testing
- Local: Fast development, no internet dependency

## Step 1: Create Cloud Databases

### Create Vercel Postgres Database

**Note:** Vercel doesn't have a direct "Postgres" option. You have two options:

#### Option A: Prisma Postgres (Recommended for Vercel)

1. **Go to Vercel Dashboard**: https://vercel.com/dashboard
2. **Go to your project** (or create a new one)
3. **Click "Storage" tab** in the left sidebar
4. **Click "Create Database"**
5. **Select "Prisma Postgres"** from the options
6. **Choose region and plan**:
   - Free tier available (limited storage)
   - Paid plans start around $20/month
7. **Name your database** (e.g., "uais-app")
8. **After creation, click on the database** → **"Connect"** tab
9. **Copy the connection string** - it will look like:
   ```
   postgres://user:password@host:5432/database?sslmode=require
   ```
   Or you'll see separate variables: `POSTGRES_URL`, `POSTGRES_PRISMA_URL`, `POSTGRES_URL_NON_POOLING`

#### Option B: Use Neon (Also works great)

Since Vercel's native Postgres is actually Prisma Postgres (which may have limitations), many users prefer Neon which integrates well with Vercel:

1. **Go to Neon**: https://neon.tech
2. **Create account** (free tier available)
3. **Create new project**
4. **Copy connection string** from the dashboard

**Recommendation:** For app database, either Prisma Postgres (if you want Vercel integration) or Neon (if you want more flexibility). Both work the same way - just different connection strings.

### Create Neon Database

1. **Sign up at Neon**: https://neon.tech
2. **Create new project**
3. **Choose region** (closest to you)
4. **Copy connection string**:
   ```
   postgres://user:password@ep-xxx.region.aws.neon.tech/neondb?sslmode=require
   ```
5. **Save credentials**

## Step 2: Update Configuration

### Update Your Existing .env File

**Important:** You already have a `.env` file! Don't create a new one. Just update the existing `APP_DATABASE_URL` and `WAREHOUSE_DATABASE_URL` variables.

Your `.env` file should already have these variables (from Prisma setup). Update them with your cloud connection strings:

```bash
# Update these existing variables with cloud connection strings:

# Vercel Postgres / Prisma Postgres (App Database)
APP_DATABASE_URL="postgres://user:pass@host:5432/db?sslmode=require"

# Neon (Warehouse Database)
WAREHOUSE_DATABASE_URL="postgres://user:pass@ep-xxx.region.aws.neon.tech/neondb?sslmode=require"
```

**Note:** If you want to keep local databases for development, you can:
1. Comment out the cloud URLs when developing locally
2. Or create separate variables like `APP_DATABASE_URL_CLOUD` and switch between them
3. Or use different `.env` files (`.env.local` for local, `.env.production` for cloud)

**Your existing PROTEUS_ variables and other settings will remain unchanged.**

### Alternative: Update YAML Config (If you prefer YAML over .env)

If you want to keep using `config/db_connections.yaml` instead of `.env`, you can update it:

```yaml
databases:
  app:
    postgres:
      # Use connection string for cloud
      connection_string: "postgres://user:pass@host:5432/db?sslmode=require"
      # OR use individual fields:
      # host: "ep-xxx.region.aws.neon.tech"
      # port: 5432
      # database: "neondb"
      # user: "user"
      # password: "pass"
      # sslmode: "require"
  
  warehouse:
    postgres:
      connection_string: "postgres://user:pass@ep-xxx.region.aws.neon.tech/neondb?sslmode=require"
```

**However, using `.env` is recommended** because:
- Prisma already uses `.env` for `APP_DATABASE_URL` and `WAREHOUSE_DATABASE_URL`
- Your Python code now checks `.env` first (via `os.environ.get()`)
- Keeps all database config in one place
- Standard practice for cloud deployments

## Step 3: Migrate Data

### Backup Local Databases

```powershell
# Backup everything first!
python python/scripts/backup_databases.py --compress
```

### Migrate App Database (Vercel)

1. **Export from local:**
   ```powershell
   pg_dump -h localhost -U postgres -d local > app_backup.sql
   ```

2. **Restore to Vercel:**
   ```powershell
   psql "postgres://user:pass@host:5432/db?sslmode=require" < app_backup.sql
   ```

### Migrate Warehouse Database (Neon)

1. **Export from local:**
   ```powershell
   pg_dump -h localhost -U postgres -d uais_warehouse > warehouse_backup.sql
   ```

2. **Restore to Neon:**
   ```powershell
   psql "postgres://user:pass@ep-xxx.region.aws.neon.tech/neondb?sslmode=require" < warehouse_backup.sql
   ```

### Using Python Migration Script

I've created a migration script that automates this:
```powershell
python python/scripts/migrate_to_cloud.py --source local --target vercel --db app
python python/scripts/migrate_to_cloud.py --source local --target neon --db warehouse
```

## Step 4: Update Prisma

Update `.env` for Prisma:
```bash
APP_DATABASE_URL="postgres://user:pass@host:5432/db?sslmode=require"
WAREHOUSE_DATABASE_URL="postgres://user:pass@ep-xxx.region.aws.neon.tech/neondb?sslmode=require"
```

Run migrations:
```powershell
cd prisma/app
npx prisma migrate deploy

cd ../warehouse
npx prisma migrate deploy
```

## Step 5: Test Connections

```powershell
# Test app database
python python/scripts/check_database_sizes.py --db app

# Test warehouse database
python python/scripts/check_database_sizes.py --db warehouse
```

## Step 6: Set Up Automated Backups

Cloud databases need regular backups too!

### Option 1: Use Cloud Provider Backups

**Vercel:**
- Automatic daily backups (Pro plan)
- Manual backups available

**Neon:**
- Automatic backups (all plans)
- Point-in-time recovery (paid plans)

### Option 2: Script-Based Backups

Update backup script to backup from cloud:
```powershell
# Backup from cloud databases
python python/scripts/backup_databases.py --source cloud --compress
```

## Step 7: Environment-Based Switching

### Development vs Production

**Development (local):**
```yaml
# config/db_connections.yaml
databases:
  app:
    postgres:
      host: "localhost"
      port: 5432
      database: "local"
```

**Production (cloud):**
```bash
# .env
APP_DATABASE_URL="postgres://user:pass@host:5432/db?sslmode=require"
```

The config system will automatically use environment variables if available, falling back to YAML.

## Daily Backup Strategy

### Recommended Approach

1. **Cloud provider backups** (automatic):
   - Vercel: Daily backups (Pro plan)
   - Neon: Continuous backups

2. **Local script backups** (manual/scheduled):
   ```powershell
   # Daily backup from cloud to local storage
   python python/scripts/backup_cloud_databases.py --compress --keep 7
   ```

3. **Off-site storage**:
   - Copy backups to OneDrive/Google Drive
   - Or use cloud storage sync

### Backup Script Setup

Create scheduled task:
```powershell
# backup_cloud_daily.ps1
python python/scripts/backup_databases.py --source cloud --compress --keep 7
Copy-Item -Path "backups\*" -Destination "$env:USERPROFILE\OneDrive\UAIS_Backups" -Recurse
```

Schedule in Task Scheduler to run daily at 2 AM.

## Switching Between Local and Cloud

### Use Local for Development

```powershell
# Set environment variable
$env:USE_LOCAL_DB="true"
python python/scripts/run_etl.py
```

### Use Cloud for Production

```powershell
# Don't set USE_LOCAL_DB, or set to false
$env:USE_LOCAL_DB="false"
python python/scripts/run_etl.py
```

## Troubleshooting

### SSL Connection Errors

**Error**: `SSL connection required`

**Solution**: Make sure connection string includes `?sslmode=require`:
```
postgres://user:pass@host:5432/db?sslmode=require
```

### Connection Timeout

**Error**: `Connection timeout`

**Solution**: 
- Check firewall settings
- Verify IP whitelist in Neon/Vercel dashboard
- Check network connectivity

### Migration Issues

**Error**: `Table already exists`

**Solution**: 
- Drop existing tables first (careful!)
- Or use `--if-exists` flag in pg_dump

## Best Practices

1. **Always backup before migrating**
2. **Test connections before switching**
3. **Keep local copy for development**
4. **Use environment variables for secrets** (never commit to git)
5. **Monitor database sizes** regularly
6. **Set up alerts** for storage limits
7. **Test restore process** periodically

## Cost Estimates

### Vercel Postgres
- **Hobby**: Free (256 MB)
- **Pro**: $20/month (8 GB per database)

### Neon
- **Free**: 0.5 GB storage, 1 project
- **Launch**: $19/month (10 GB storage)
- **Scale**: $69/month (50 GB storage)

### Total Estimated Cost
- **Small setup** (< 1 GB): Free tier on both
- **Medium setup** (1-10 GB): ~$20-40/month
- **Large setup** (10-50 GB): ~$50-100/month

## Next Steps

1. Create Vercel and Neon accounts
2. Create databases
3. Update configuration
4. Migrate data
5. Test connections
6. Set up backups
7. Update deployment scripts

## Support

If you run into issues:
1. Check connection strings are correct
2. Verify SSL is enabled
3. Check firewall/IP whitelist
4. Test with `psql` command line first
5. Review cloud provider logs

