# Database Type Recommendations for UAIS

## Current Setup: Mixed Database Types

Your UAIS system is designed to work with **mixed database types** - you can use PostgreSQL for one database and SQLite for another. This is perfectly fine and actually recommended!

## Recommended Configuration

### App Database: PostgreSQL ✓ (You're already using this!)

**Why PostgreSQL for App DB:**
- ✅ **Better concurrent access** - Multiple users/apps can read/write simultaneously
- ✅ **ACID compliance** - Better data integrity guarantees
- ✅ **Beekeeper Studio** - Works seamlessly with PostgreSQL
- ✅ **Production-ready** - Handles high concurrency well
- ✅ **No file locking issues** - Unlike SQLite, no WAL mode needed

**Your current setup:**
- App database is PostgreSQL (client info database)
- This is the **right choice** for identity/athlete data

### Warehouse Database: SQLite (Recommended) or PostgreSQL

**SQLite for Warehouse (Recommended for most cases):**
- ✅ **Simple** - Single file, easy to backup/move
- ✅ **Fast** - Excellent for read-heavy analytics workloads
- ✅ **Free** - No server setup needed
- ✅ **Beekeeper Studio** - Works great with SQLite files
- ✅ **Good for < 100GB** - Perfect for most analytics databases
- ⚠️ **Concurrent writes** - Can be slower with many simultaneous writes

**PostgreSQL for Warehouse (If you need scale):**
- ✅ **Better for large datasets** - Handles TBs of data efficiently
- ✅ **Better concurrent writes** - Multiple ETL pipelines can write simultaneously
- ✅ **Advanced features** - Partitioning, materialized views, etc.
- ⚠️ **More complex** - Requires server setup and management
- ⚠️ **Overkill** - Unless you have millions of rows or need multi-user writes

## Beekeeper Studio: Mixed Database Support

**Beekeeper Studio supports multiple database types simultaneously:**

1. **Add PostgreSQL Connection:**
   - Name: "UAIS App (PostgreSQL)"
   - Type: PostgreSQL
   - Host: localhost (or your server)
   - Port: 5432
   - Database: your_database_name
   - User/Password: your credentials

2. **Add SQLite Connection:**
   - Name: "UAIS Warehouse (SQLite)"
   - Type: SQLite
   - Path: path/to/warehouse_database.db

3. **Use Both:**
   - View athlete info in PostgreSQL connection
   - Query warehouse data in SQLite connection
   - Cross-reference data between connections

## Configuration Example

```yaml
databases:
  # App DB: PostgreSQL (your existing client database)
  app:
    postgres:
      host: "localhost"
      port: 5432
      database: "client_database"  # Your existing PostgreSQL DB
      user: "your_user"
      password: "your_password"
  
  # Warehouse DB: SQLite (simple file-based)
  warehouse:
    sqlite: "data/warehouse.db"
```

## Code Compatibility

**The UAIS codebase already handles both:**

- ✅ `python/common/config.py` - Detects SQLite vs PostgreSQL automatically
- ✅ `R/common/config.R` - Supports both database types
- ✅ `python/common/db_utils.py` - Works with any SQLAlchemy engine
- ✅ `R/common/db_utils.R` - Works with any DBI connection

**No code changes needed** - just configure your `db_connections.yaml`!

## When to Use Each

### Use PostgreSQL When:
- ✅ App database (identity/athletes) - **You're doing this!**
- ✅ Multiple users/apps accessing simultaneously
- ✅ Need ACID guarantees for critical data
- ✅ Warehouse > 100GB or need advanced features
- ✅ Need to scale horizontally

### Use SQLite When:
- ✅ Warehouse database (< 100GB)
- ✅ Single-user or low-concurrency writes
- ✅ Simple deployment (no server needed)
- ✅ Development/testing environments
- ✅ Read-heavy analytics workloads

## Migration Path

**If you start with SQLite and need to migrate to PostgreSQL later:**

1. Export SQLite data to CSV/SQL
2. Create PostgreSQL tables (use `sql/schema.sql`)
3. Import data
4. Update `db_connections.yaml`
5. Code continues to work (no changes needed!)

## Best Practice: Match Your Use Case

**Your current setup is optimal:**
- **PostgreSQL for App DB** ✓ (identity, concurrent access)
- **SQLite for Warehouse** ✓ (analytics, simple, fast)

**Don't change what's working!** The mixed approach gives you:
- Production-grade identity management (PostgreSQL)
- Simple analytics storage (SQLite)
- Best of both worlds

## Summary

**Answer: No, you don't need to stick with SQLite!**

✅ **Use PostgreSQL for app database** (you're already doing this)
✅ **Use SQLite for warehouse** (unless you need PostgreSQL features)
✅ **Beekeeper Studio handles both** seamlessly
✅ **Code supports both** automatically

Your current PostgreSQL app database is the right choice. Keep it!

