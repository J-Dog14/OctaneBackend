# Database Architecture Clarification

This document clarifies the correct database setup for UAIS.

## Your Database Architecture

### APP_DATABASE_URL - Other App's Database (Read-Only)

**Purpose:** This is the OTHER application's database where you get UUIDs from.

**Important:**
- You DON'T control this database
- You only READ from it (to get athlete UUIDs)
- You periodically dump/load it to get updated UUIDs
- You should NOT change this to point to Vercel

**Current Setup:**
- Points to localhost (local dump of other app's database)
- OR points to the other app's production database
- This is CORRECT - keep it as-is

**What to do:**
- Keep `APP_DATABASE_URL` pointing to wherever the other app's database is
- Don't change it to Vercel
- This is your source of truth for UUIDs (read-only)

### WAREHOUSE_DATABASE_URL - Your UAIS Warehouse

**Purpose:** This is YOUR analytics/warehouse database.

**Important:**
- This is YOUR database that you control
- This is where all your UAIS data goes (fact tables, analytics)
- This is what should go to Neon (cloud)

**Current Setup:**
- Points to localhost (`uais_warehouse`)
- This is fine for now

**What to do:**
- Keep it local for now, OR
- Migrate it to Neon when ready
- This is the database you want to backup and put in the cloud

### Vercel Prisma Postgres Database

**Purpose:** You created this, but you might not need it.

**Options:**
1. **Use it as a local copy** of the other app's database (if you want a cloud backup)
2. **Don't use it** - delete it or leave it for later
3. **Use it for something else** - up to you

**Important:**
- This is NOT the same as `APP_DATABASE_URL`
- `APP_DATABASE_URL` should point to the OTHER app's database
- You don't need to change `APP_DATABASE_URL` to use this Vercel database

## Correct Configuration

### For APP_DATABASE_URL

Keep it pointing to the other app's database:

```bash
# If using local dump:
APP_DATABASE_URL="postgresql://postgres:password@localhost:5432/local?schema=public"

# OR if connecting to other app's production:
APP_DATABASE_URL="postgresql://user:pass@other-app-host:5432/other-app-db?schema=public"
```

**DO NOT** change this to:
- Vercel's POSTGRES_URL
- Neon
- Any other database

### For WAREHOUSE_DATABASE_URL

This is what should go to cloud:

```bash
# Current (local):
WAREHOUSE_DATABASE_URL="postgresql://postgres:password@localhost:5432/uais_warehouse?schema=public"

# Future (Neon):
WAREHOUSE_DATABASE_URL="postgres://user:pass@ep-xxx.region.aws.neon.tech/neondb?sslmode=require"
```

## Summary

| Database | What It Is | Where It Should Point | Cloud? |
|----------|------------|----------------------|--------|
| `APP_DATABASE_URL` | Other app's database (read-only) | Other app's database (local dump or production) | No - keep as-is |
| `WAREHOUSE_DATABASE_URL` | Your UAIS warehouse | Your warehouse database | Yes - migrate to Neon |
| Vercel Postgres | Optional - you created it | Use for something else or delete | Optional |

## What You Should Do

1. **Keep `APP_DATABASE_URL` as-is** - it's correct
2. **Keep `WAREHOUSE_DATABASE_URL` local for now** - or migrate to Neon when ready
3. **Vercel database** - use it for something else, or don't use it

## Verification

Run the verification script:
```powershell
python python/scripts/verify_env_setup.py
```

It will now correctly identify that:
- `APP_DATABASE_URL` pointing to localhost is CORRECT (other app's database)
- `WAREHOUSE_DATABASE_URL` can stay local or go to Neon
- Vercel variables are optional

