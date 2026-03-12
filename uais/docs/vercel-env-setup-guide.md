# Vercel Prisma Postgres Environment Variables Setup

This guide explains how to properly configure your `.env` file with Vercel Prisma Postgres connection strings.

## What Vercel Provides

When you create a Prisma Postgres database on Vercel, you get these environment variables:

1. **`PRISMA_DATABASE_URL`** - Connection string optimized for Prisma (with connection pooling)
2. **`POSTGRES_URL`** - Direct PostgreSQL connection string (with connection pooling)
3. **`POSTGRES_URL_NON_POOLING`** - Direct PostgreSQL connection string (without pooling, for migrations)

## What Your Code Needs

Your UAIS project uses these variables:

1. **`APP_DATABASE_URL`** - Used by:
   - Prisma app schema (`prisma/app/schema.prisma`)
   - Python code (`python/common/config.py`)

2. **`WAREHOUSE_DATABASE_URL`** - Used by:
   - Prisma warehouse schema (`prisma/warehouse/schema.prisma`)
   - Python code (`python/common/config.py`)

## How to Map Vercel Variables to Your Code

### For App Database (Vercel Prisma Postgres)

You have two options:

#### Option 1: Use PRISMA_DATABASE_URL (Recommended)

```bash
# Vercel Prisma Postgres (App Database)
APP_DATABASE_URL="${PRISMA_DATABASE_URL}"
```

Or directly copy the value:
```bash
# Vercel Prisma Postgres (App Database)
APP_DATABASE_URL="postgres://user:pass@host:5432/db?sslmode=require&pgbouncer=true"
```

#### Option 2: Use POSTGRES_URL_NON_POOLING (For migrations)

If you're running Prisma migrations, use the non-pooling URL:
```bash
APP_DATABASE_URL="${POSTGRES_URL_NON_POOLING}"
```

**Note:** For regular queries, use the pooled URL. For migrations, use non-pooling.

### For Warehouse Database (Neon)

You'll set this separately when you create your Neon database:
```bash
# Neon (Warehouse Database)
WAREHOUSE_DATABASE_URL="postgres://user:pass@ep-xxx.region.aws.neon.tech/neondb?sslmode=require"
```

## Complete .env File Structure

Here's what your `.env` file should look like:

```bash
# ============================================================================
# VERCEL PRISMA POSTGRES (App Database)
# ============================================================================
# These are provided by Vercel when you create the database
PRISMA_DATABASE_URL="postgres://user:pass@host:5432/db?sslmode=require&pgbouncer=true"
POSTGRES_URL="postgres://user:pass@host:5432/db?sslmode=require&pgbouncer=true"
POSTGRES_URL_NON_POOLING="postgres://user:pass@host:5432/db?sslmode=require"

# Map Vercel's variable to your code's expected variable
APP_DATABASE_URL="${PRISMA_DATABASE_URL}"

# OR use non-pooling for migrations (uncomment if needed):
# APP_DATABASE_URL="${POSTGRES_URL_NON_POOLING}"

# ============================================================================
# NEON (Warehouse Database)
# ============================================================================
# Set this when you create your Neon database
WAREHOUSE_DATABASE_URL="postgres://user:pass@ep-xxx.region.aws.neon.tech/neondb?sslmode=require"

# ============================================================================
# LOCAL DATABASES (Development - Optional)
# ============================================================================
# Uncomment these if you want to use local databases for development
# APP_DATABASE_URL="postgresql://postgres:Byoung15!@localhost:5432/local?schema=public"
# WAREHOUSE_DATABASE_URL="postgresql://postgres:Byoung15!@localhost:5432/uais_warehouse?schema=public"

# ============================================================================
# PROTEUS VARIABLES (Keep these as-is)
# ============================================================================
PROTEUS_EMAIL=jimmy@8ctanebaseball.com
PROTEUS_PASSWORD=*********
PROTEUS_LOCATION=**************

# ... any other existing variables ...
```

## About the "Dummy Variables" (Lines 8-21)

If you see variables at the top that look like placeholders or examples, they might be:

1. **Template/example variables** - Left over from a template file
2. **Commented examples** - Showing what variables should look like
3. **Old local database URLs** - From before you set up cloud

**What to do:**
- If they're commented out (start with `#`), they're fine - just documentation
- If they're actual variables with placeholder values, you can either:
  - Delete them if they're not used
  - Replace them with real values if they are used
  - Comment them out if you're not sure

## Verification Steps

1. **Check Prisma can connect:**
   ```powershell
   cd prisma/app
   npx prisma db pull
   ```
   This should connect to your Vercel database.

2. **Check Python can connect:**
   ```powershell
   python python/scripts/check_database_sizes.py --db app
   ```
   This should show your database size.

3. **Test the connection:**
   ```powershell
   python -c "from python.common.config import get_app_engine; print(get_app_engine())"
   ```
   Should print the engine URL without errors.

## Common Issues

### Issue: "Variable not found" errors

**Solution:** Make sure you're using the exact variable names:
- `APP_DATABASE_URL` (not `DATABASE_URL`)
- `WAREHOUSE_DATABASE_URL` (not `WH_DATABASE_URL`)

### Issue: Connection pooling errors during migrations

**Solution:** Use `POSTGRES_URL_NON_POOLING` for migrations:
```bash
# Temporarily for migrations
APP_DATABASE_URL="${POSTGRES_URL_NON_POOLING}"
```

Then switch back to pooled URL for regular use:
```bash
APP_DATABASE_URL="${PRISMA_DATABASE_URL}"
```

### Issue: SSL connection errors

**Solution:** Make sure connection strings include `?sslmode=require` at the end.

## Next Steps

1. Verify your `.env` has `APP_DATABASE_URL` set to Vercel's connection string
2. Keep `WAREHOUSE_DATABASE_URL` pointing to local (or set to Neon when ready)
3. Run Prisma migrations to create schema in Vercel database
4. Test connections with the verification steps above

## Important Notes

- **Don't commit `.env` to git** - It's already in `.gitignore`
- **Keep Vercel's original variables** - You might need them later
- **Use `APP_DATABASE_URL` for your code** - This is what Prisma and Python expect
- **For migrations, use non-pooling URL** - Connection pooling can cause migration issues

