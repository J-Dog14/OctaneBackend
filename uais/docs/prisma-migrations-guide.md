# Prisma Migrations Guide

## How Prisma Migrations Work

**Important:** Changes to `schema.prisma` do NOT automatically apply to your database. You must create and apply migrations.

**Using the warehouse DB (Neon / production)?** Use **only** `migrate deploy` when applying to that database—never `migrate dev`, or you risk a reset that deletes data. See [Warehouse Prisma: migrate dev vs deploy](warehouse-prisma-dev-vs-deploy.md) for the full rule and the difference between the two commands.

## Workflow for Making Changes

### Step 1: Edit the Schema File

Edit `prisma/warehouse/schema.prisma` (or `prisma/app/schema.prisma`):

```prisma
model DAthletes {
  // ... existing fields ...
  
  // Add new field
  newField String? @map("new_field") @db.Text
}
```

### Step 2: Create a Migration

Run the migrate command:

```bash
npm run prisma:warehouse:migrate
```

This will:
1. **Detect changes** between your schema and the database
2. **Generate SQL migration** files in `prisma/warehouse/migrations/`
3. **Ask you to name the migration** (e.g., "add_new_field_to_athletes")
4. **Apply the migration** to your database
5. **Regenerate the Prisma Client** with new types

### Step 3: Review the Migration

The migration SQL is saved in:
```
prisma/warehouse/migrations/YYYYMMDDHHMMSS_migration_name/migration.sql
```

You can review this file to see exactly what SQL will run.

## Example: Adding a Column

### 1. Edit Schema

```prisma
model DAthletes {
  // ... existing fields ...
  favoriteSport String? @map("favorite_sport") @db.Text
}
```

### 2. Create Migration

```bash
npm run prisma:warehouse:migrate
```

When prompted, name it: `add_favorite_sport_to_athletes`

### 3. Prisma Generates SQL

Prisma will generate:
```sql
-- AlterTable
ALTER TABLE "analytics"."d_athletes" ADD COLUMN "favorite_sport" TEXT;
```

### 4. Migration Applied

The column is now in your database!

## Example: Removing a Column

### 1. Edit Schema

Remove the field from the model:
```prisma
model DAthletes {
  // ... other fields ...
  // favoriteSport removed
}
```

### 2. Create Migration

```bash
npm run prisma:warehouse:migrate
```

Name it: `remove_favorite_sport_from_athletes`

### 3. Prisma Generates SQL

```sql
-- AlterTable
ALTER TABLE "analytics"."d_athletes" DROP COLUMN "favorite_sport";
```

**Warning:** This will delete data! Prisma will warn you.

## Example: Changing a Column Type

### 1. Edit Schema

```prisma
model DAthletes {
  // Change from String? to Int?
  age Int? @db.Integer  // Was: Decimal?
}
```

### 2. Create Migration

```bash
npm run prisma:warehouse:migrate
```

**Note:** Prisma may need to:
- Create a new column
- Copy data (if possible)
- Drop old column
- Rename new column

## Migration Commands

### Development (Interactive)

```bash
# Warehouse database
npm run prisma:warehouse:migrate

# App database
npm run prisma:app:migrate
```

This creates a new migration and applies it immediately.

### Production (Deploy Existing Migrations)

```bash
npm run prisma:migrate:deploy
```

This applies pending migrations without creating new ones (for production deployments).

### Reset Database (⚠️ DANGEROUS)

```bash
npx prisma migrate reset --schema=prisma/warehouse/schema.prisma
```

**WARNING:** This deletes all data and recreates the database from migrations!

## Best Practices

1. **Always review migration SQL** before applying in production
2. **Test migrations** on a development database first
3. **Commit migration files** to version control (they're in `prisma/*/migrations/`)
4. **Never edit migration files** after they've been applied
5. **Use descriptive migration names** (e.g., "add_email_to_athletes")

## Common Scenarios

### Adding a New Table

1. Add model to schema.prisma
2. Run `npm run prisma:warehouse:migrate`
3. Name migration (e.g., "create_f_new_table")

### Adding an Index

```prisma
model DAthletes {
  // ... fields ...
  
  @@index([email], map: "idx_athletes_email")
}
```

Then migrate.

### Adding a Foreign Key

Relations in Prisma automatically create foreign keys:

```prisma
model FNewTable {
  athleteUuid String @map("athlete_uuid")
  athlete     DAthletes @relation(fields: [athleteUuid], references: [id])
}
```

## Troubleshooting

### "Migration failed" Error

1. Check the error message
2. Fix the schema or database manually
3. Mark migration as applied: `npx prisma migrate resolve --applied <migration_name>`

### Schema Out of Sync

If your database has changes not in the schema:

```bash
# Pull current database structure into schema
npx prisma db pull --schema=prisma/warehouse/schema.prisma
```

**Warning:** This overwrites your schema file! Commit first.

### Undo a Migration

Prisma doesn't have a built-in "undo", but you can:

1. Create a new migration that reverses the changes
2. Or manually edit the database and mark migration as rolled back

## Summary

**Workflow:**
1. Edit `schema.prisma`
2. Run `npm run prisma:warehouse:migrate`
3. Review generated SQL
4. Migration applies automatically
5. Prisma Client regenerates

**Remember:** Schema changes are NOT automatic - you must create migrations!

