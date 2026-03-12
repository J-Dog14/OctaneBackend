# Cloud Database Migration Summary

I've set up everything you need to migrate to Neon and Vercel databases. Here's what's been created and how to use it.

## What's Been Set Up

### Configuration System
- Updated `python/common/config.py` to support:
  - Environment variables (for cloud databases)
  - Connection strings (with SSL support)
  - Falls back to YAML config (for local development)

### Migration Tools
- **`python/scripts/migrate_to_cloud.py`**: Migrates data from local to cloud
- **`python/scripts/backup_cloud_databases.py`**: Backs up cloud databases
- **`python/scripts/check_database_sizes.py`**: Check database sizes (already existed)

### Documentation
- **`docs/cloud-database-migration-guide.md`**: Complete migration guide
- **`docs/cloud-database-quick-start.md`**: Quick reference
- **`config/env.example`**: Template for environment variables

### Setup Script
- **`setup-cloud-databases.ps1`**: Helper script to get started

## Quick Start (5 Steps)

### 1. Create Cloud Databases

**Vercel Postgres:**
- Go to https://vercel.com/dashboard
- Create Storage → Postgres
- Copy connection string

**Neon:**
- Go to https://neon.tech
- Create new project
- Copy connection string

### 2. Configure Connection Strings

**Update your existing `.env` file** (you already have one from Prisma setup):

Find these variables in your `.env` file and update them with cloud connection strings:
```bash
# Update these existing variables:
APP_DATABASE_URL="postgres://user:pass@host:5432/db?sslmode=require"
WAREHOUSE_DATABASE_URL="postgres://user:pass@ep-xxx.region.aws.neon.tech/db?sslmode=require"
```

**Note:** Your existing PROTEUS_ variables and other settings will remain unchanged. Only update the database URLs.

### 3. Backup Local Databases

```powershell
python python/scripts/backup_databases.py --compress
```

### 4. Migrate Data

```powershell
# Migrate app database to Vercel
python python/scripts/migrate_to_cloud.py --source local --target vercel --db app --target-conn "YOUR_VERCEL_CONNECTION_STRING"

# Migrate warehouse database to Neon
python python/scripts/migrate_to_cloud.py --source local --target neon --db warehouse --target-conn "YOUR_NEON_CONNECTION_STRING"
```

### 5. Test & Set Up Backups

```powershell
# Test connections
python python/scripts/check_database_sizes.py

# Set up daily cloud backups
python python/scripts/backup_cloud_databases.py --compress --keep 7
```

## How It Works

### Automatic Switching

Your code automatically uses:
- **Cloud databases** if `APP_DATABASE_URL` and `WAREHOUSE_DATABASE_URL` are set in `.env`
- **Local databases** if environment variables are not set (uses `config/db_connections.yaml`)

No code changes needed! Just set environment variables to switch.

### Daily Backup Strategy

**Recommended approach:**

1. **Cloud provider backups** (automatic):
   - Vercel: Daily backups on Pro plan
   - Neon: Continuous backups (all plans)

2. **Local script backups** (scheduled):
   ```powershell
   # Run daily at 2 AM via Task Scheduler
   python python/scripts/backup_cloud_databases.py --compress --keep 7
   ```

3. **Off-site storage** (optional):
   - Copy backups to OneDrive/Google Drive
   - Or use cloud storage sync

## File Structure

```
UAIS/
├── .env                          # Your connection strings (create this)
├── config/
│   ├── db_connections.yaml       # Local database config (still works)
│   └── env.example               # Template for .env
├── python/
│   ├── common/
│   │   └── config.py            # Updated to support cloud
│   └── scripts/
│       ├── migrate_to_cloud.py   # New: Migrate to cloud
│       ├── backup_cloud_databases.py  # New: Backup cloud DBs
│       └── check_database_sizes.py    # Check sizes
├── docs/
│   ├── cloud-database-migration-guide.md  # Complete guide
│   └── cloud-database-quick-start.md      # Quick reference
└── setup-cloud-databases.ps1    # Setup helper
```

## Benefits

- **No code changes needed** - Environment variables handle switching  
- **Keep local for development** - Fast, no internet needed  
- **Use cloud for production** - Accessible anywhere, automatic backups  
- **Easy migration** - Automated scripts handle data transfer  
- **Daily backups** - Scripts ready to schedule  

## Next Steps

1. **Read the quick start**: `docs/cloud-database-quick-start.md`
2. **Create cloud databases** (Vercel + Neon)
3. **Set up `.env` file** with connection strings
4. **Test connections**: `python python/scripts/check_database_sizes.py`
5. **Migrate data**: Use migration scripts
6. **Set up backups**: Schedule daily cloud backups

## Questions?

- **Detailed guide**: See `docs/cloud-database-migration-guide.md`
- **Quick reference**: See `docs/cloud-database-quick-start.md`
- **Troubleshooting**: Check the migration guide's troubleshooting section

## Cost Estimate

Based on your small database size:
- **Vercel Hobby**: Free (256 MB) - Perfect for app database
- **Neon Free**: Free (0.5 GB) - Perfect for warehouse

**Total: $0/month** for your current size!

You can upgrade later if needed:
- Vercel Pro: $20/month (8 GB)
- Neon Launch: $19/month (10 GB)

