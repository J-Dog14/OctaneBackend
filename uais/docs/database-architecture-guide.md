# Database Architecture Recommendations

## Current Architecture

You have three types of databases:

1. **App Database** (Beekeeper)
   - `athletes` table (source of truth for athlete_uuid)
   - `source_athlete_map` table (maps legacy IDs to UUIDs)
   - Small, frequently accessed for identity lookups

2. **Warehouse Database**
   - Fact tables: `f_athletic_screen`, `f_pro_sup`, `f_readiness_screen`, etc.
   - Large tables with all measurement data
   - Used for analytics and reporting

3. **Domain-Specific Databases** (Legacy)
   - `movement_database_v2.db` (Athletic Screen)
   - `pro-sup_data.sqlite` (Pro-Sup Test)
   - `Readiness_Screen_Data_v2.db` (Readiness Screen)
   - Original source databases

## Should You Store Everything in the App Database?

### ❌ **Recommendation: Keep Separate**

**Reasons to keep separate:**

1. **Performance**
   - App database is for identity lookups (fast, indexed)
   - Fact tables can have millions of rows
   - Mixing them slows down athlete lookups

2. **Separation of Concerns**
   - App DB = Identity & metadata (small, fast)
   - Warehouse DB = Analytics & measurements (large, optimized for queries)

3. **Scalability**
   - Can move warehouse to separate server/Postgres instance
   - Can archive old warehouse data independently
   - Can optimize each database for its purpose

4. **Beekeeper Studio**
   - Can easily connect to multiple databases
   - View identity in app DB, analytics in warehouse DB
   - No performance impact from large tables

5. **Cost** (if using Postgres)
   - Separate databases can share same Postgres instance
   - Or use SQLite for warehouse (free, unlimited size)

### ✅ **When to Consolidate:**

Only consider consolidating if:
- You have < 100K total rows across all fact tables
- You always query identity + measurements together
- You want simpler deployment (single database file)
- You're using SQLite and don't care about performance

## Recommended Architecture

### Option 1: Current Setup (Recommended) ✓

```
App Database (SQLite/Postgres)
├── athletes
└── source_athlete_map

Warehouse Database (SQLite/Postgres)
├── f_athletic_screen
├── f_pro_sup
├── f_readiness_screen
├── f_mobility
├── f_proteus
├── f_kinematics_pitching
└── f_kinematics_hitting
```

**Benefits:**
- Fast athlete lookups
- Optimized for analytics queries
- Easy to scale warehouse independently
- Clear separation of concerns

### Option 2: Single Database with Schemas (Postgres Only)

If using Postgres, you can use schemas:

```sql
-- App schema (identity)
CREATE SCHEMA app;
CREATE TABLE app.athletes (...);
CREATE TABLE app.source_athlete_map (...);

-- Warehouse schema (analytics)
CREATE SCHEMA warehouse;
CREATE TABLE warehouse.f_athletic_screen (...);
CREATE TABLE warehouse.f_pro_sup (...);
```

**Benefits:**
- Single database connection
- Logical separation via schemas
- Can still optimize separately
- Works well with Beekeeper

**Drawbacks:**
- Requires Postgres (not SQLite)
- Still one database to backup/manage

## Implementation Guide

### Current Setup (Recommended)

Your current setup is already optimal! Just ensure:

1. **App Database** stays small:
   - Only `athletes` and `source_athlete_map`
   - Keep in Beekeeper for easy access

2. **Warehouse Database** handles all fact tables:
   - All `f_*` tables go here
   - Can grow large without affecting app DB

3. **Beekeeper Configuration:**
   - Connect to both databases
   - Use app DB for athlete management
   - Use warehouse DB for data exploration

### Beekeeper Setup

1. **Add App Database Connection:**
   ```
   Name: UAIS App (Identity)
   Type: SQLite
   Path: path/to/app_database.db
   ```

2. **Add Warehouse Database Connection:**
   ```
   Name: UAIS Warehouse (Analytics)
   Type: SQLite
   Path: path/to/warehouse_database.db
   ```

3. **Query Across Databases** (if needed):
   ```sql
   -- In Beekeeper, you can't JOIN across databases directly
   -- But you can:
   -- 1. Export from one, import to other
   -- 2. Use your Python/R scripts to join
   -- 3. Create views/materialized views if using Postgres
   ```

### If You Want to Consolidate (Not Recommended)

If you still want everything in app database:

1. **Add warehouse tables to app database:**
   ```python
   # In your ETL scripts, change:
   warehouse_engine = get_warehouse_engine()
   # To:
   warehouse_engine = get_app_engine()  # Use app DB for everything
   ```

2. **Update config:**
   ```yaml
   databases:
     app:
       sqlite: "path/to/unified_database.db"
     warehouse:
       sqlite: "path/to/unified_database.db"  # Same file
   ```

3. **Consider performance:**
   - Add indexes on athlete_uuid in all fact tables
   - Consider partitioning large tables by date
   - Monitor query performance

## Storage Recommendations

### SQLite Files (Current)

**Pros:**
- Free, unlimited size
- Easy to backup (copy file)
- Works great for < 100GB databases
- Perfect for single-user or small team

**Cons:**
- Slower with very large tables (> 10M rows)
- Single writer limitation
- Not ideal for high concurrency

**Best Practices:**
- Keep app DB small (< 100MB)
- Warehouse DB can be larger (up to ~50GB)
- Use WAL mode (already configured)
- Regular backups (copy .db files)

### Postgres (If Scaling)

**When to switch:**
- Warehouse DB > 50GB
- Need concurrent writes from multiple users
- Need advanced features (partitioning, replication)

**Setup:**
```yaml
databases:
  app:
    postgres:
      host: "localhost"
      port: 5432
      database: "uais_app"
      user: "uais_user"
      password: "your_password"
  
  warehouse:
    postgres:
      host: "localhost"
      port: 5432
      database: "uais_warehouse"  # Separate database
      user: "uais_user"
      password: "your_password"
```

**Or use schemas:**
```yaml
databases:
  app:
    postgres:
      database: "uais"  # Same database
      schema: "app"     # Different schema
  
  warehouse:
    postgres:
      database: "uais"  # Same database
      schema: "warehouse"  # Different schema
```

## Final Recommendation

**Keep your current architecture:**
- ✅ App DB in Beekeeper for athlete management
- ✅ Warehouse DB separate for analytics
- ✅ Both can be SQLite (free, simple)
- ✅ Upgrade to Postgres only if needed

**Why this works:**
1. Fast athlete lookups (small app DB)
2. Optimized analytics (large warehouse DB)
3. Easy to manage in Beekeeper (connect to both)
4. Scalable (can move warehouse to Postgres later)
5. Simple backups (copy .db files)

**Action Items:**
1. Keep app DB small (only identity tables)
2. Use warehouse DB for all fact tables
3. Connect both to Beekeeper
4. Monitor warehouse DB size
5. Consider Postgres if warehouse > 50GB

Your current setup is already optimal! No changes needed.

