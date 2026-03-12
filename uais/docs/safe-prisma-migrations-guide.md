# Safe Prisma Migrations Guide

This guide explains how to safely use Prisma migrations now that your data is in Neon, without losing data.

## The Problem You Had Before

Prisma migrations can delete data when:
1. **Schema and database get out of sync** - Prisma thinks it needs to recreate everything
2. **Using `migrate dev` on production** - This can reset the database
3. **Migration history mismatch** - Prisma doesn't know what's already applied

## The Solution: Sync First, Then Migrate

Now that your data is safely in Neon, you can fix the migration state properly.

### Step 1: Sync Schema from Neon Database

Since your Neon database has all your data and the correct structure, pull the schema FROM the database:

```powershell
# Make sure WAREHOUSE_DATABASE_URL points to Neon in your .env
npm run prisma:warehouse:db:pull
```

This will:
- Read your Neon database structure
- Update `prisma/warehouse/schema.prisma` to match what's actually in Neon
- Preserve all your data

**Important:** Commit your current schema first (in case you need to revert):
```powershell
git add prisma/warehouse/schema.prisma
git commit -m "Backup schema before syncing from Neon"
```

### Step 2: Mark Existing Migrations as Applied

Since your database already has the structure, mark the existing migrations as applied:

```powershell
# This tells Prisma "these migrations are already applied, don't run them again"
npx prisma migrate resolve --applied --schema=prisma/warehouse/schema.prisma
```

Or mark them individually:
```powershell
npx prisma migrate resolve --applied 20251114170352_true_false_addition_for_data_present_in_each_table --schema=prisma/warehouse/schema.prisma
npx prisma migrate resolve --applied 20251114210321_added_schema_details_for_athletic_screen_mobility_proteus_pro_sup_and_readiness_screen --schema=prisma/warehouse/schema.prisma
# ... etc for all migrations
```

### Step 3: Use `migrate deploy` Instead of `migrate dev`

**For production/Neon database:**
```powershell
# This applies pending migrations WITHOUT creating new ones
npm run prisma:warehouse:migrate:deploy
```

**For development (local database):**
```powershell
# This creates new migrations AND applies them
npm run prisma:warehouse:migrate
```

## Going Forward: Normal Migration Workflow

Now that everything is synced, you can use normal migrations:

### Adding a New Column

1. **Edit schema:**
   ```prisma
   model DAthletes {
     // ... existing fields
     newField String? @map("new_field") @db.Text
   }
   ```

2. **Create migration (on LOCAL database first):**
   ```powershell
   # Temporarily point to local database
   # Or use --schema flag
   npm run prisma:warehouse:migrate
   ```

3. **Review the migration SQL:**
   ```powershell
   # Check the generated SQL file
   cat prisma/warehouse/migrations/YYYYMMDDHHMMSS_migration_name/migration.sql
   ```

4. **Apply to Neon (production):**
   ```powershell
   # Make sure WAREHOUSE_DATABASE_URL points to Neon
   npm run prisma:warehouse:migrate:deploy
   ```

### The Key Difference

- **`migrate dev`** = Creates new migration + applies it (use on local/dev)
- **`migrate deploy`** = Only applies existing migrations (use on production/Neon)

## Safe Migration Strategy

### Option A: Two-Database Workflow (Recommended)

1. **Keep local database** for testing migrations
2. **Test migrations locally first:**
   ```powershell
   # Point to local database
   # Edit .env: WAREHOUSE_DATABASE_URL="postgresql://...localhost..."
   npm run prisma:warehouse:migrate
   ```
3. **Review the migration SQL**
4. **Apply to Neon:**
   ```powershell
   # Point to Neon
   # Edit .env: WAREHOUSE_DATABASE_URL="postgres://...neon.tech..."
   npm run prisma:warehouse:migrate:deploy
   ```

### Option B: Direct to Neon (If You're Confident)

1. **Backup Neon first:**
   ```powershell
   python python/scripts/backup_cloud_databases.py --compress
   ```

2. **Create migration:**
   ```powershell
   # Make sure WAREHOUSE_DATABASE_URL points to Neon
   npm run prisma:warehouse:migrate
   ```

3. **Review the SQL before confirming**

## What NOT to Do

**Never use these on production/Neon:**
- `prisma migrate reset` - Deletes everything!
- `prisma migrate dev` without reviewing SQL first
- `prisma db push` - Can cause data loss

**Always:**
- Review migration SQL before applying
- Backup before migrating
- Test on local database first if possible

## Checking Migration Status

See what migrations Prisma thinks are applied:

```powershell
npx prisma migrate status --schema=prisma/warehouse/schema.prisma
```

This shows:
- Which migrations are applied
- Which are pending
- If schema is in sync

## If Something Goes Wrong

### Migration Failed Mid-Way

1. **Check the error message**
2. **Fix the issue manually** (if needed)
3. **Mark migration as applied** (if it partially worked):
   ```powershell
   npx prisma migrate resolve --applied <migration_name> --schema=prisma/warehouse/schema.prisma
   ```

### Need to Rollback

Prisma doesn't have automatic rollback, but you can:

1. **Restore from backup:**
   ```powershell
   python python/scripts/restore_database.py --source backups/warehouse_YYYYMMDD.sql.gz --target neon
   ```

2. **Or create a reverse migration:**
   - Create a new migration that undoes the changes
   - Apply it

## Summary

**To fix your current situation:**
1. `npm run prisma:warehouse:db:pull` - Sync schema from Neon
2. Mark existing migrations as applied
3. Use `migrate deploy` for Neon going forward

**For future changes:**
1. Test migrations on local database first
2. Review SQL before applying
3. Backup before migrating
4. Use `migrate deploy` on Neon (not `migrate dev`)

Your data is safe in Neon, and now you can use normal migrations going forward!

