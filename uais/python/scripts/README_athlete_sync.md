# Athlete Sync ETL - Quick Reference

ETL script to sync canonical athlete identity from app Postgres (`public."User"`) to warehouse Postgres (`analytics.athlete_dim`).

## Quickstart

### 1. Create Database Roles

**App DB (read-only role):**
```bash
psql -h <app_host> -U postgres -d <app_db> -f ../../sql/app_readonly.sql
# Remember to change the password!
```

**Warehouse DB (schema & table):**
```bash
psql -h <warehouse_host> -U postgres -d <warehouse_db> -f ../../sql/warehouse_setup.sql
```

### 2. Set Environment Variables

Copy `.env.example` to `.env` in project root and fill in credentials:

```bash
cp ../../.env.example ../../.env
# Edit ../../.env with your actual values
```

### 3. Install & Run

```bash
# Install dependencies
make install
# or: pip install -r ../../python/requirements.txt

# Run sync
make sync
# or: python sync_athletes_from_app.py
```

## Notes on Quoted "User" Table Name

The source table `public."User"` uses quoted identifiers because `User` is a SQL reserved word. The script handles this correctly:

- Uses `public."User"` (quoted) in all SQL queries
- Aliases columns: `uuid AS athlete_uuid`, `name AS full_name`
- Properly escapes identifiers in psycopg2

**Why alias columns?** For clarity and to match warehouse naming conventions (`athlete_uuid` vs `uuid`).

## Scheduling

### Linux/macOS (cron)

```bash
# Edit crontab
crontab -e

# Add this line (syncs daily at 2 AM)
0 2 * * * /usr/bin/env -S bash -lc 'cd /path/to/UAIS && /usr/bin/python3 python/scripts/sync_athletes_from_app.py >> logs/sync_athletes.log 2>&1'
```

**Adjust paths** to match your environment.

### Windows Task Scheduler

#### Step-by-Step:

1. Open **Task Scheduler** (search in Start menu)
2. Click **Create Basic Task**
3. **Name:** "Sync Athletes from App"
4. **Trigger:** Daily at 2:00 AM
5. **Action:** Start a program
   - **Program:** `C:\Python312\python.exe` (your Python path)
   - **Arguments:** `python\scripts\sync_athletes_from_app.py`
   - **Start in:** `C:\Users\Joey\PycharmProjects\UAIS`
6. **Properties:**
   - Check **Run whether user is logged on or not**
   - Check **Run with highest privileges** (if needed)
   - **Conditions:** Uncheck "Start only on AC power" (optional)
7. Click **OK**

#### PowerShell Script Alternative

Create `run_sync_athletes.ps1`:

```powershell
Set-Location "C:\Users\Joey\PycharmProjects\UAIS"
Get-Content .env | ForEach-Object {
    if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
        [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), "Process")
    }
}
python python/scripts/sync_athletes_from_app.py
```

Schedule this `.ps1` file in Task Scheduler instead.

## Troubleshooting

### Permission Denied

**Error:** `permission denied for table "User"`

**Fix:**
```sql
-- On app DB, as superuser:
GRANT SELECT ON TABLE public."User" TO app_readonly;
```

**Error:** `permission denied for schema analytics`

**Fix:**
```sql
-- On warehouse DB, as superuser:
GRANT USAGE ON SCHEMA analytics TO warehouse_writer;
GRANT SELECT, INSERT, UPDATE ON TABLE analytics.athlete_dim TO warehouse_writer;
```

### Relation Does Not Exist

**Error:** `relation "public.User" does not exist`

**Causes:**
- Wrong case: use `public."User"` (quoted), not `public.user`
- Wrong schema: verify table is in `public` schema
- Wrong database: check you're connected to correct app DB

**Verify:**
```sql
SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'User';
```

### SSL Connection Errors

**Error:** `SSL connection required`

**Fix:** Add SSL mode to connection (modify script or use env var):
```python
# In sync_athletes_from_app.py, add:
sslmode='require'  # to psycopg2.connect()
```

Or set environment variable:
```env
APP_SSLMODE=require
WH_SSLMODE=require
```

### Connection Timeouts

**Error:** `timeout expired` or `could not connect to server`

**Check:**
1. Network: `ping <host>`
2. Firewall: port 5432 open?
3. PostgreSQL `pg_hba.conf`: allows your IP?
4. Increase timeout in script (default 10 seconds)

### Encoding Issues

**Symptom:** Special characters in names appear corrupted

**Fix:** Script sets UTF-8 explicitly. Verify DB encoding:
```sql
SHOW server_encoding;  -- Should be UTF8
SHOW client_encoding;  -- Should be UTF8
```

## Exit Codes

- `0`: Success
- `1`: Configuration error (missing env vars)
- `2`: Database connection error
- `3`: SQL execution error
- `4`: Unexpected error

Use these for monitoring/alerting.

## Performance

- **< 10K rows:** Seconds
- **10K-100K rows:** Under a minute
- **> 100K rows:** Consider batching or incremental sync

Uses bulk COPY + staging table for fast loads.

## Security

- ✅ Read-only role for app DB
- ✅ Never commit `.env` to git
- ✅ Rotate passwords regularly
- ✅ Use SSL in production
- ✅ Limit network access (firewalls)

## Full Documentation

See `docs/athlete-sync-etl-guide.md` for comprehensive guide with:
- Detailed setup instructions
- Advanced troubleshooting
- Monitoring queries
- Performance tuning
- Security best practices

