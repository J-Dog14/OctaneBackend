# PostgreSQL Connection Troubleshooting Guide

## The Problem

You're getting "Connection refused" errors when trying to connect to PostgreSQL on port 5433. This means PostgreSQL either:
1. **Not running** - PostgreSQL service is stopped
2. **Wrong port** - PostgreSQL is running on a different port (usually 5432)
3. **Not configured** - PostgreSQL isn't listening on that port
4. **Firewall blocking** - Windows Firewall is blocking the connection

## Quick Checks

### 1. Check if PostgreSQL is Running

**Windows Services:**
- Press `Win + R`, type `services.msc`, press Enter
- Look for "PostgreSQL" services
- Common names: "postgresql-x64-XX" or "PostgreSQL Server XX"
- Status should be "Running"
- If stopped, right-click → Start

**Command Line:**
```powershell
Get-Service | Where-Object {$_.Name -like "*postgres*"}
```

### 2. Check What Port PostgreSQL is Actually Using

**Method 1: Check PostgreSQL Config File**
- Find your PostgreSQL data directory (usually `C:\Program Files\PostgreSQL\XX\data\`)
- Open `postgresql.conf`
- Look for `port = 5432` (or another number)
- **Most PostgreSQL installations use port 5432 by default, not 5433**

**Method 2: Check Listening Ports**
```powershell
netstat -an | findstr "543"
```

This will show what ports PostgreSQL is actually listening on.

**Method 3: Check PostgreSQL Logs**
- Look in `C:\Program Files\PostgreSQL\XX\data\log\` or
- Check Windows Event Viewer → Applications → PostgreSQL

### 3. Common Issue: Port Mismatch

**Your config says port 5433, but PostgreSQL might be on 5432!**

Try updating your config to use port 5432:

```yaml
warehouse:
  postgres:
    host: "localhost"
    port: 5432  # Try changing from 5433 to 5432
    database: "uais_warehouse"
    user: "Joey_Casa"
    password: "Gabagool1004!"
```

### 4. Test Connection Manually

**Using psql command line:**
```powershell
# Try port 5432 (default)
psql -h localhost -p 5432 -U Joey_Casa -d uais_warehouse

# Or try port 5433
psql -h localhost -p 5433 -U Joey_Casa -d uais_warehouse
```

**Using Python:**
```python
import psycopg2
try:
    conn = psycopg2.connect(
        host="localhost",
        port=5432,  # Try 5432 first
        database="uais_warehouse",
        user="Joey_Casa",
        password="Gabagool1004!"
    )
    print("Connection successful!")
    conn.close()
except Exception as e:
    print(f"Error: {e}")
```

## Solutions

### Solution 1: Use Default Port 5432

If PostgreSQL is running on port 5432 (most common), update your config:

```yaml
warehouse:
  postgres:
    host: "localhost"
    port: 5432  # Changed from 5433
    database: "uais_warehouse"
    user: "Joey_Casa"
    password: "Gabagool1004!"
```

### Solution 2: Configure PostgreSQL to Use Port 5433

If you specifically need port 5433:

1. **Stop PostgreSQL service**
2. **Edit `postgresql.conf`:**
   ```
   port = 5433
   ```
3. **Restart PostgreSQL service**

### Solution 3: Check PostgreSQL Authentication

Even if the port is correct, authentication might fail. Check `pg_hba.conf`:

- Location: `C:\Program Files\PostgreSQL\XX\data\pg_hba.conf`
- Should have a line like:
  ```
  host    all             all             127.0.0.1/32            md5
  ```
- This allows local connections with password authentication

### Solution 4: Check Windows Firewall

1. Windows Security → Firewall & network protection
2. Advanced settings
3. Inbound Rules → Look for PostgreSQL
4. If missing, create a rule allowing port 5432 (or 5433)

## Step-by-Step Troubleshooting

### Step 1: Verify PostgreSQL is Running
```powershell
Get-Service | Where-Object {$_.Name -like "*postgres*"}
```

### Step 2: Find PostgreSQL Port
```powershell
# Check what's listening
netstat -an | findstr "543"

# Or check config file
Get-Content "C:\Program Files\PostgreSQL\*\data\postgresql.conf" | Select-String "port"
```

### Step 3: Test Connection with psql
```powershell
# Try default port
psql -h localhost -p 5432 -U postgres

# If that works, try your database
psql -h localhost -p 5432 -U Joey_Casa -d uais_warehouse
```

### Step 4: Update Config File

Once you know the correct port, update `config/db_connections.yaml`:

```yaml
warehouse:
  postgres:
    host: "localhost"
    port: 5432  # Use the port that actually works
    database: "uais_warehouse"
    user: "Joey_Casa"
    password: "Gabagool1004!"
```

### Step 5: Test in Beekeeper

1. Open Beekeeper Studio
2. Edit your warehouse connection
3. Update port to match what works
4. Test connection

## Most Likely Fix

**99% chance:** PostgreSQL is running on port **5432** (default), not 5433.

**Quick fix:** Change port in config from 5433 → 5432

## Verify Database Exists

Even if connection works, make sure the database exists:

```powershell
psql -h localhost -p 5432 -U postgres
```

Then in psql:
```sql
\l  -- List all databases
CREATE DATABASE uais_warehouse;  -- Create if missing
\q  -- Quit
```

## Still Not Working?

1. **Check PostgreSQL logs** for detailed error messages
2. **Try connecting as 'postgres' superuser** first to verify PostgreSQL works
3. **Check if multiple PostgreSQL instances** are installed (might conflict)
4. **Restart PostgreSQL service** completely

