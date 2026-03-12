# Database Migration Strategy for UAIS

## Your Question

You used npm/npx migrations (likely Prisma or TypeORM) in your other app. Should you use the same approach here?

## Short Answer

**Probably not necessary** - but if you want migrations, use **Alembic** (Python-native) instead of npm tools.

## Comparison: npm Migrations vs Python Options

### What You Did Before (npm/npx)

**Likely Prisma or TypeORM:**
- Schema defined in code (TypeScript)
- `npx prisma migrate dev` or `npx typeorm migration:run`
- Automatic migration generation
- Version-controlled migration files
- Rollback support

**Pros:**
- Schema-as-code
- Automatic migration generation
- Great for TypeScript/Node.js projects

**Cons:**
- Requires Node.js/npm (extra dependency)
- Not Python-native
- Adds complexity to Python project

### Python Option: Alembic (Recommended if Needed)

**Alembic** is SQLAlchemy's migration tool:

```bash
# Install
pip install alembic

# Initialize
alembic init alembic

# Create migration
alembic revision --autogenerate -m "Add new column"

# Run migrations
alembic upgrade head

# Rollback
alembic downgrade -1
```

**Pros:**
- Python-native (no npm needed)
- Works seamlessly with SQLAlchemy
- Same workflow as Prisma/TypeORM
- Version-controlled migrations
- Rollback support

**Cons:**
- Another tool to learn (if you don't know it)
- Requires setup

### Current Approach: Manual SQL Files

**What you have now:**
- SQL files in `sql/` folder
- `create_warehouse_schema_postgres.sql`
- Run manually when needed

**Pros:**
- Simple
- No extra dependencies
- Full control
- Easy to understand

**Cons:**
- No automatic migration generation
- Manual version tracking
- No built-in rollback

## Recommendation

### For This Project: **Stick with SQL Files** (For Now)

**Why:**
1. **Early stage** - Schema is still evolving
2. **Simple** - No extra tooling needed
3. **Python-focused** - No need for npm/Node.js
4. **You control changes** - Manual SQL is fine for now

### When to Consider Alembic

Add Alembic if:
- ✅ Schema changes become frequent
- ✅ Multiple developers need coordinated migrations
- ✅ You need automatic rollback
- ✅ You want schema-as-code
- ✅ Production deployments need strict versioning

### When npm Migrations Make Sense

Use npm/npx migrations if:
- ✅ You're already using Node.js/TypeScript
- ✅ You want to share migrations between Python and Node.js
- ✅ Your team already knows Prisma/TypeORM

**For a Python project, Alembic is the better choice.**

## Current Workflow (Keep This)

**What you have:**
```
sql/
├── create_warehouse_schema_postgres.sql  # Initial schema
├── schema.sql                            # Full schema reference
└── test_queries.sql                      # Test queries
```

**Workflow:**
1. Edit SQL files when schema changes
2. Run in Beekeeper or via Python script
3. Version control SQL files in Git

**This is fine!** No migrations needed yet.

## If You Want Migrations Later

### Option 1: Alembic (Recommended)

```bash
# Install
pip install alembic

# Setup
alembic init alembic

# Configure alembic.ini to use your config
# Then create migrations as needed
alembic revision --autogenerate -m "Add athlete_uuid index"
alembic upgrade head
```

### Option 2: Keep SQL Files + Versioning

```sql
-- sql/migrations/001_initial_schema.sql
-- sql/migrations/002_add_indexes.sql
-- sql/migrations/003_add_new_column.sql
```

Create a simple Python script to run migrations in order.

## Summary

**For now:** ✅ **Keep using SQL files** - Simple and works fine

**Later (if needed):** ✅ **Use Alembic** - Python-native, no npm required

**Don't use:** ❌ **npm/npx migrations** - Not necessary for Python project

Your current approach is perfectly fine! Migrations are a "nice to have" for complex projects, but not required for yours right now.

