# Athlete Sync ETL Guide

This guide explains how to set up and run the ETL process that syncs canonical athlete identity from the app Postgres database to the warehouse Postgres database.

## Overview

The sync process:
1. Reads athlete data from `public."User"` table in the app database
2. Loads it into a temporary staging table in the warehouse
3. Performs an idempotent upsert into `analytics.athlete_dim`
4. Updates the `source_synced_at` timestamp for changed rows

## Prerequisites

- Python 3.7+
- PostgreSQL 9.5+ (for both app and warehouse databases)
- Access to create roles and grant permissions (superuser or admin)
- Network access to both databases

## Quick Start

### 1. Create Database Roles

#### App Database (Read-Only Role)

Run the SQL script on your app database as a superuser:

```bash
psql -h <app_host> -U postgres -d <app_db> -f sql/app_readonly.sql
```

**Important:** Change the password `CHANGE_ME` in the script before running, or update it afterward:

```sql
ALTER ROLE app_readonly WITH PASSWORD 'your_secure_password';
```

#### Warehouse Database (Schema & Table Setup)

Run the SQL script on your warehouse database:

```bash
psql -h <warehouse_host> -U postgres -d <warehouse_db> -f sql/warehouse_setup.sql
```

**Note:** Update the `GRANT` statements in the script to match your warehouse user role name.

### 2. Configure Environment Variables

Copy the example environment file and fill in your credentials:

```bash
cp .env.example .env
```

Edit `.env` with your actual database connection details:

```env
APP_HOST=your_app_host
APP_PORT=5432
APP_DB=app_prod
APP_USER=app_readonly
APP_PASSWORD=your_app_password

WH_HOST=your_warehouse_host
WH_PORT=5432
WH_DB=uias_warehouse
WH_USER=warehouse_writer
WH_PASSWORD=your_warehouse_password
```

**Security:** Never commit `.env` to version control! It's already in `.gitignore`.

### 3. Install Dependencies

```bash
make install
```

Or manually:

```bash
pip install -r python/requirements.txt
```

### 4. Run the Sync

```bash
make sync
```

Or directly:

```bash
python python/scripts/sync_athletes_from_app.py
```

## Understanding the Quoted "User" Table Name

The source table is named `public."User"` with quotes because `User` is a reserved word in SQL. The script handles this correctly by:

- Using quoted identifiers in SQL: `public."User"`
- Properly escaping identifiers in psycopg2 queries
- Aliasing columns (`uuid AS athlete_uuid`, `name AS full_name`) for clarity

## How It Works

### Bulk Load Strategy

The script uses a fast bulk load approach:

1. **Fetch**: Reads all athletes from app DB into a pandas DataFrame
2. **Stage**: Creates a temporary table `tmp_athlete_dim` in the warehouse
3. **Copy**: Uses PostgreSQL `COPY` to bulk load data into the staging table
4. **Upsert**: Performs a single `INSERT ... ON CONFLICT` statement to merge data
5. **Cleanup**: Temporary table is automatically dropped when the connection closes

This approach is much faster than row-by-row inserts, especially for large datasets.

### Idempotency

The sync is idempotent—you can run it multiple times safely:

- **New athletes**: Inserted with `source_synced_at = NOW()`
- **Existing athletes**: Updated if `full_name` changed, with `source_synced_at` refreshed
- **Unchanged athletes**: No update (but `source_synced_at` is still refreshed on conflict)

## Scheduling

### Linux/macOS (cron)

Add to your crontab (`crontab -e`):

```bash
# Sync athletes daily at 2 AM
0 2 * * * /usr/bin/env -S bash -lc 'cd /path/to/UAIS && /usr/bin/python3 python/scripts/sync_athletes_from_app.py >> logs/sync_athletes.log 2>&1'
```

**Note:** Adjust paths and Python executable location as needed. The `-S` flag allows environment variable parsing.

### Windows Task Scheduler

#### Method 1: GUI Setup

1. Open **Task Scheduler** (search for it in Start menu)
2. Click **Create Basic Task**
3. Name: "Sync Athletes from App"
4. Trigger: Daily at 2:00 AM (or your preferred time)
5. Action: **Start a program**
   - Program: `C:\Python312\python.exe` (or your Python path)
   - Arguments: `python\scripts\sync_athletes_from_app.py`
   - Start in: `C:\Users\Joey\PycharmProjects\UAIS`
6. Check **Open the Properties dialog** and click Finish
7. In Properties:
   - Check **Run whether user is logged on or not**
   - Check **Run with highest privileges** (if needed for DB access)
   - In **Conditions**, uncheck "Start the task only if the computer is on AC power" (if you want it to run on battery)
8. Click OK (enter your password if prompted)

#### Method 2: PowerShell Script

Create `run_sync_athletes.ps1`:

```powershell
# Set working directory
Set-Location "C:\Users\Joey\PycharmProjects\UAIS"

# Load environment variables from .env
Get-Content .env | ForEach-Object {
    if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
        $name = $matches[1].Trim()
        $value = $matches[2].Trim()
        [Environment]::SetEnvironmentVariable($name, $value, "Process")
    }
}

# Run the sync script
python python/scripts/sync_athletes_from_app.py

# Log exit code
if ($LASTEXITCODE -ne 0) {
    Write-Error "Sync failed with exit code $LASTEXITCODE"
    exit $LASTEXITCODE
}
```

Then schedule this PowerShell script in Task Scheduler.

#### Method 3: XML Export (Advanced)

You can export a task as XML and import it on other machines. Here's a basic template:

```xml
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>2024-01-01T02:00:00</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByDay>
        <DaysInterval>1</DaysInterval>
      </ScheduleByDay>
    </CalendarTrigger>
  </Triggers>
  <Actions>
    <Exec>
      <Command>C:\Python312\python.exe</Command>
      <Arguments>python\scripts\sync_athletes_from_app.py</Arguments>
      <WorkingDirectory>C:\Users\Joey\PycharmProjects\UAIS</WorkingDirectory>
    </Exec>
  </Actions>
  <Principals>
    <Principal id="Author">
      <UserId>S-1-5-18</UserId>
      <RunLevel>HighestAvailable</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT1H</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
</Task>
```

Save as `sync_athletes_task.xml` and import via Task Scheduler → **Import Task**.

## Troubleshooting

### Permission Denied Errors

**Error:** `permission denied for table "User"`

**Solution:** Ensure the `app_readonly` role has `SELECT` permission:
```sql
GRANT SELECT ON TABLE public."User" TO app_readonly;
```

**Error:** `permission denied for schema analytics`

**Solution:** Grant usage on the analytics schema:
```sql
GRANT USAGE ON SCHEMA analytics TO warehouse_writer;
GRANT SELECT, INSERT, UPDATE ON TABLE analytics.athlete_dim TO warehouse_writer;
```

### Relation Does Not Exist

**Error:** `relation "public.User" does not exist`

**Possible causes:**
1. Table name is case-sensitive: use `public."User"` (quoted) not `public.user`
2. Wrong schema: verify the table is in the `public` schema
3. Wrong database: ensure you're connected to the correct app database

**Verify table exists:**
```sql
SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'User';
```

### SSL Connection Errors

**Error:** `SSL connection required` or `server does not support SSL`

**Solution:** Add SSL parameters to connection (modify `sync_athletes_from_app.py`):
```python
conn = psycopg2.connect(
    host=host,
    port=port,
    database=database,
    user=user,
    password=password,
    sslmode='require'  # or 'prefer', 'disable', etc.
)
```

Or set environment variable:
```env
APP_SSLMODE=require
WH_SSLMODE=require
```

### Connection Timeouts

**Error:** `timeout expired` or `could not connect to server`

**Solutions:**
1. Check network connectivity: `ping <host>`
2. Verify firewall rules allow connections on port 5432
3. Check PostgreSQL `pg_hba.conf` allows connections from your IP
4. Increase connection timeout in the script (default is 10 seconds)

### Encoding Issues

**Error:** Names with special characters appear corrupted

**Solution:** The script explicitly sets UTF-8 encoding. If issues persist:
1. Verify database encoding: `SHOW server_encoding;` (should be UTF8)
2. Check client encoding: `SHOW client_encoding;`
3. Ensure your terminal/shell supports UTF-8

### Empty Results

**Symptom:** Script runs successfully but no rows are synced

**Check:**
1. Verify source table has data: `SELECT COUNT(*) FROM public."User";`
2. Check for NULL values that might be filtered out
3. Review logs for warnings about empty DataFrames

## Monitoring

### Log Files

The script logs to stdout/stderr. Redirect to a file for monitoring:

```bash
python python/scripts/sync_athletes_from_app.py >> logs/sync_athletes.log 2>&1
```

### Database Monitoring

Check sync status in the warehouse:

```sql
-- Count total athletes
SELECT COUNT(*) FROM analytics.athlete_dim;

-- Find recently synced athletes
SELECT athlete_uuid, full_name, source_synced_at 
FROM analytics.athlete_dim 
ORDER BY source_synced_at DESC 
LIMIT 10;

-- Find athletes that haven't synced recently (potential issues)
SELECT athlete_uuid, full_name, source_synced_at 
FROM analytics.athlete_dim 
WHERE source_synced_at < NOW() - INTERVAL '2 days'
ORDER BY source_synced_at ASC;
```

### Exit Codes

The script returns specific exit codes for monitoring:

- `0`: Success
- `1`: Configuration error (missing env vars)
- `2`: Database connection error
- `3`: SQL execution error
- `4`: Unexpected error

Use these in monitoring scripts or alerting systems.

## Performance Considerations

- **Small datasets (< 10K rows)**: Sync completes in seconds
- **Medium datasets (10K-100K rows)**: Sync completes in under a minute
- **Large datasets (> 100K rows)**: Consider adding batching or incremental sync

For very large datasets, you might want to add:
- Incremental sync based on `source_synced_at`
- Parallel processing for multiple tables
- Monitoring and alerting for sync duration

## Security Best Practices

1. **Use read-only role** for app database (already implemented)
2. **Never commit `.env`** to version control
3. **Rotate passwords** regularly
4. **Use SSL/TLS** for production connections
5. **Limit network access** to database servers (firewall rules)
6. **Monitor access logs** for suspicious activity
7. **Use strong passwords** for database roles

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review logs for detailed error messages
3. Verify database permissions and connectivity
4. Consult PostgreSQL documentation for database-specific issues

