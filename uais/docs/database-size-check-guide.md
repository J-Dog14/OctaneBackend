# Database Size Check Guide

This guide explains how to check the size of your UAIS databases, which is useful for:
- Planning cloud database migrations (Vercel DB, Neon, etc.)
- Understanding storage requirements
- Monitoring database growth

## Quick Start

### Using Python Script (Recommended)

**Check all databases:**
```powershell
python python/scripts/check_database_sizes.py
```

**Check specific database:**
```powershell
python python/scripts/check_database_sizes.py --db verceldb
python python/scripts/check_database_sizes.py --db warehouse
python python/scripts/check_database_sizes.py --db app
```

**Show table-level sizes:**
```powershell
python python/scripts/check_database_sizes.py --tables
python python/scripts/check_database_sizes.py --db warehouse --tables
```

### Using SQL Script (Beekeeper/psql)

1. **Open Beekeeper Studio** and connect to your PostgreSQL server

2. **Run the SQL script:**
   - Open `sql/check_database_sizes.sql`
   - Or copy/paste queries directly

3. **Check specific database size:**
   ```sql
   SELECT 
       pg_size_pretty(pg_database_size('verceldb')) AS database_size,
       pg_database_size('verceldb') AS size_bytes;
   ```

4. **Check all databases:**
   ```sql
   SELECT 
       datname AS database_name,
       pg_size_pretty(pg_database_size(datname)) AS size,
       pg_database_size(datname) AS size_bytes
   FROM pg_database
   WHERE datistemplate = false
   ORDER BY pg_database_size(datname) DESC;
   ```

## Understanding the Output

### Database Sizes

The script shows:
- **Total Size**: Complete database size including indexes, tables, and metadata
- **Size in bytes**: Raw byte count (useful for exact calculations)

### Table Sizes

When using `--tables`, you'll see:
- **Schema**: Database schema (usually `public` or `analytics`)
- **Table**: Table name
- **Size**: Total size including indexes

### Size Units

- **B**: Bytes
- **KB**: Kilobytes (1,024 bytes)
- **MB**: Megabytes (1,024 KB)
- **GB**: Gigabytes (1,024 MB)
- **TB**: Terabytes (1,024 GB)

## Example Output

```
UAIS Database Size Report
======================================================================
Database: verceldb (verceldb)
======================================================================
Total Size: 15.23 MB (15,987,456 bytes)

Schema Summary:
Schema               Tables     Size           
---------------------------------------------
public               3          15.23 MB       

Table Sizes (Top 20):
Schema          Table                              Size           
-----------------------------------------------------------------
public          User                               12.45 MB       
public          source_athlete_map                 2.78 MB        
```

## Size Recommendations for Cloud Providers

### Free Tiers
- **Neon**: 0.5 GB
- **Supabase**: 500 MB
- **Vercel Postgres**: 256 MB (Hobby plan)
- **Railway**: 1 GB

### Paid Tiers (Typical Pricing)
- **1-10 GB**: $10-25/month
- **10-50 GB**: $25-50/month
- **50-100 GB**: $50-100/month
- **100+ GB**: $100+/month or dedicated instance

### Your Current Setup

Based on typical UAIS database sizes:
- **App database** (`local`): Usually < 50 MB (small, mostly metadata)
- **Warehouse database** (`uais_warehouse`): Can be 100 MB - 10 GB (depends on data volume)
- **Vercel database** (`verceldb`): Usually < 100 MB (User table and mappings)

**Total typical size**: 200 MB - 10 GB

## Monitoring Database Growth

### Regular Checks

Run the size check script periodically:
```powershell
# Weekly check
python python/scripts/check_database_sizes.py --tables > database_sizes_$(Get-Date -Format "yyyyMMdd").txt
```

### Track Growth Over Time

Create a simple log:
```powershell
# Add to weekly backup script
python python/scripts/check_database_sizes.py >> backups/size_log.txt
```

## Troubleshooting

### Error: "database does not exist"

**Solution:** Make sure you're connected to the correct PostgreSQL server and the database name is correct.

### Error: "permission denied"

**Solution:** Your PostgreSQL user needs `pg_database_size()` permission. This is usually granted by default, but you may need to run as a superuser.

### Large Database Sizes

If your database is unexpectedly large:

1. **Check table sizes:**
   ```powershell
   python python/scripts/check_database_sizes.py --db warehouse --tables
   ```

2. **Look for large tables:**
   - Fact tables (`f_*`) are usually the largest
   - Check if you have duplicate data
   - Consider archiving old data

3. **Check indexes:**
   - Indexes can take significant space
   - Use `pg_size_pretty(pg_indexes_size('table_name'))` to check

## For Vercel DB Migration

When migrating to Vercel DB:

1. **Check current size:**
   ```powershell
   python python/scripts/check_database_sizes.py --db verceldb
   ```

2. **Verify it fits in Vercel plan:**
   - Hobby: 256 MB
   - Pro: 8 GB per database
   - Enterprise: Custom

3. **If too large:**
   - Consider splitting into multiple databases
   - Archive old data
   - Use Vercel's Pro plan for larger databases

## SQL Queries Reference

### Check Single Database
```sql
SELECT pg_size_pretty(pg_database_size('database_name'));
```

### Check All Databases
```sql
SELECT 
    datname,
    pg_size_pretty(pg_database_size(datname)) AS size
FROM pg_database
WHERE datistemplate = false
ORDER BY pg_database_size(datname) DESC;
```

### Check Table Sizes
```sql
SELECT 
    tablename,
    pg_size_pretty(pg_total_relation_size('public.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size('public.'||tablename) DESC;
```

### Check Index Sizes
```sql
SELECT 
    indexname,
    pg_size_pretty(pg_relation_size(indexname::regclass)) AS size
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY pg_relation_size(indexname::regclass) DESC;
```

## Summary

- ✅ **Easy to use**: Single command shows all database sizes
- ✅ **Detailed**: Can show table-level breakdown
- ✅ **Useful for planning**: Know your size before migrating to cloud
- ✅ **Monitoring**: Track growth over time

Run the script regularly to stay informed about your database sizes!

