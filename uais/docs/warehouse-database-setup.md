# Initializing PostgreSQL Warehouse Database

## The Problem

You created a PostgreSQL database `uais_warehouse` but when you try to connect in Beekeeper Studio, you get an error. This is likely because:

1. **The database exists but has no tables** - Beekeeper might show an error if the database is empty
2. **Connection credentials are wrong** - Check your config file
3. **The database doesn't exist** - You need to create it first

## Solution: Initialize the Database Schema

You have **two options** to create the warehouse tables:

### Option 1: Use Beekeeper Studio (Easiest)

1. **First, verify your connection works:**
   - In Beekeeper, try connecting to the warehouse database
   - If it connects but shows no tables, that's fine - proceed to step 2
   - If connection fails, check:
     - Database name: `uais_warehouse`
     - Port: `5433` (note: different from app DB port 5432)
     - User: `Joey_Casa`
     - Password: `Gabagool1004!`
     - Host: `localhost`

2. **Open SQL Editor in Beekeeper:**
   - Right-click on your warehouse connection → "New Query"
   - Or click the SQL Editor tab

3. **Copy and paste the schema:**
   - Open `sql/create_warehouse_schema_postgres.sql`
   - Copy all the SQL statements
   - Paste into Beekeeper's SQL editor
   - Click "Run" or press F5

4. **Verify tables were created:**
   - Refresh your connection in Beekeeper
   - You should see tables like `f_athletic_screen`, `f_pro_sup`, etc.

### Option 2: Use Python Script

1. **Run the initialization script:**
   ```powershell
   cd C:\Users\Joey\PycharmProjects\UAIS
   python python/scripts/init_warehouse_db.py
   ```

2. **The script will:**
   - Connect to your warehouse database using config
   - Create all fact tables (`f_*`)
   - Create indexes
   - Skip tables that already exist

## Troubleshooting Connection Errors

### Error: "There was a problem, Error"

**Possible causes:**

1. **Database doesn't exist:**
   ```sql
   -- Connect to PostgreSQL as superuser and create database
   CREATE DATABASE uais_warehouse;
   ```

2. **Wrong port:**
   - Your warehouse uses port `5433` (not 5432)
   - Make sure Beekeeper connection uses port 5433

3. **Wrong credentials:**
   - Check `config/db_connections.yaml`
   - Verify user `Joey_Casa` exists and has permissions

4. **PostgreSQL not running:**
   - Check if PostgreSQL service is running
   - Verify you can connect to port 5433

### Test Connection Manually

Try connecting with `psql` command line:
```powershell
psql -h localhost -p 5433 -U Joey_Casa -d uais_warehouse
```

If this works, Beekeeper should work too.

## After Initialization

Once tables are created:

1. **Beekeeper will connect successfully** - Empty databases sometimes cause connection issues
2. **Tables will be visible** - You'll see `f_athletic_screen`, `f_pro_sup`, etc.
3. **ETL pipelines can write data** - Your Python scripts can now insert data

## Next Steps

After initializing the warehouse:

1. Run your ETL pipelines to populate data
2. Tables will be created automatically by ETL if they don't exist
3. Additional columns will be added dynamically as needed

## Notes

- **Foreign keys removed:** Since app and warehouse databases are separate, foreign key constraints are not included
- **Tables are flexible:** ETL pipelines will add columns dynamically based on source data
- **Indexes created:** Common indexes on `athlete_uuid` and `session_date` for fast queries

