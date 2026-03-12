# Cloud Database Quick Start

Quick reference for setting up Neon and Vercel databases.

## 1. Create Databases

### Vercel/Prisma Postgres (App Database)
1. Go to https://vercel.com/dashboard
2. Select your project (or create one)
3. Click "Storage" tab in left sidebar
4. Click "Create Database" → Select "Prisma Postgres"
5. Choose region, plan, and name your database
6. After creation, click the database → "Connect" tab
7. Copy POSTGRES_URL or connection string (looks like: `postgres://user:pass@host:5432/db?sslmode=require`)

**Note:** Vercel doesn't have a direct "Postgres" option - it's called "Prisma Postgres" in the Storage section.

### Neon (Warehouse Database)
1. Go to https://neon.tech
2. Sign up / Log in
3. Click "Create Project"
4. Name it (e.g., "uais-warehouse")
5. Select region (closest to you)
6. Click "Create Project"
7. Copy the connection string shown (looks like: `postgres://user:pass@ep-xxx.region.aws.neon.tech/db?sslmode=require`)

## 2. Configure

**Update your existing `.env` file** (you already have one):

Find and update these variables:
```bash
APP_DATABASE_URL="postgres://user:pass@host:5432/db?sslmode=require"
WAREHOUSE_DATABASE_URL="postgres://user:pass@ep-xxx.region.aws.neon.tech/db?sslmode=require"
```

Your existing PROTEUS_ and other variables will remain unchanged.

## 3. Migrate Data

```powershell
# Backup local databases first!
python python/scripts/backup_databases.py --compress

# Migrate app database to Vercel
python python/scripts/migrate_to_cloud.py --source local --target vercel --db app

# Migrate warehouse database to Neon
python python/scripts/migrate_to_cloud.py --source local --target neon --db warehouse
```

## 4. Test

```powershell
# Check database sizes
python python/scripts/check_database_sizes.py

# Test specific database
python python/scripts/check_database_sizes.py --db app
python python/scripts/check_database_sizes.py --db warehouse
```

## 5. Set Up Backups

### Daily Cloud Backups

Create scheduled task or run manually:
```powershell
python python/scripts/backup_cloud_databases.py --compress --keep 7
```

### Schedule with Task Scheduler

1. Open Task Scheduler
2. Create Basic Task
3. Trigger: Daily at 2 AM
4. Action: Start program
5. Program: `powershell.exe`
6. Arguments: `-File "C:\Users\Joey\PycharmProjects\UAIS\backup_cloud_databases.ps1"`

## How It Works

### Environment Variables Take Precedence

Your code automatically uses cloud databases if environment variables are set:
- `APP_DATABASE_URL` → Uses Vercel
- `WAREHOUSE_DATABASE_URL` → Uses Neon

If not set, falls back to `config/db_connections.yaml` (local databases).

### Switching Between Local and Cloud

**Use Cloud (Production):**
```powershell
# Set environment variables (in .env or system)
$env:APP_DATABASE_URL="postgres://..."
$env:WAREHOUSE_DATABASE_URL="postgres://..."
```

**Use Local (Development):**
```powershell
# Remove or comment out environment variables
# Code will use config/db_connections.yaml
```

## Troubleshooting

### SSL Connection Required
Make sure connection strings include `?sslmode=require`

### Connection Timeout
- Check firewall settings
- Verify IP whitelist in Neon/Vercel dashboard
- Test with `psql` command line first

### Migration Fails
- Backup local databases first
- Check connection strings are correct
- Verify databases exist in cloud providers

## Cost

- **Vercel Hobby**: Free (256 MB)
- **Vercel Pro**: $20/month (8 GB)
- **Neon Free**: Free (0.5 GB)
- **Neon Launch**: $19/month (10 GB)

## Next Steps

See `docs/cloud-database-migration-guide.md` for detailed instructions.

