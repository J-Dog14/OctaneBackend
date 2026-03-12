# Warehouse Prisma: migrate dev vs migrate deploy

Use this when working with the **warehouse** Prisma schema and Neon (or any shared/production) database.

## Rule for the warehouse DB (Neon / production)

- **Use only `prisma migrate deploy`** when applying migrations to the **real warehouse database** (Neon, production, or any DB you care about).
- **Do not run `prisma migrate dev`** against that database. If you do, Prisma may detect "drift" (the DB was changed by Python, R, or scripts) and offer to **reset** the database, which **deletes all data**.

## Difference between the two commands

| | `prisma migrate deploy` | `prisma migrate dev` |
|---|-------------------------|----------------------|
| **Purpose** | Apply pending migrations to a database. | Development: apply migrations and create new ones from schema changes. |
| **Resets database?** | **No.** Only runs migrations that haven’t been applied yet. Never drops or resets. | **Can yes.** If it detects drift (DB doesn’t match migration history), it may offer to reset the DB (wipe and re-run all migrations). |
| **Creates new migrations?** | No. | Yes (e.g. `prisma migrate dev --name add_foo`). |
| **Use on Neon / production?** | **Yes.** Safe for shared or production DBs. | **No.** Risk of data loss if you accept a reset. |
| **Use on local dev DB?** | Yes, if you only want to apply existing migrations. | Yes, when you’re developing and creating new migrations (local DB can be reset if needed). |

## When to use which

- **Applying migrations to Neon (or any real warehouse DB):**  
  From `prisma/warehouse`:
  ```bash
  npx prisma migrate deploy
  ```
  Use this every time you have new migration files to apply. No reset, no drift “fix.”

- **Creating a new migration (schema change):**  
  1. Edit `prisma/warehouse/schema.prisma`.  
  2. Run migrate dev **against a local or throwaway DB** (not Neon):
     ```bash
     # Point DATABASE_URL at a local/dev copy of the DB, then:
     npx prisma migrate dev --name describe_your_change
     ```
  3. Commit the new migration file under `prisma/warehouse/migrations/`.  
  4. Apply it to Neon with:
     ```bash
     npx prisma migrate deploy
     ```

- **Regenerating the Prisma client (after schema or migration changes):**  
  ```bash
  npx prisma generate --schema=prisma/warehouse/schema.prisma
  ```

## Summary

- **Neon / production / shared warehouse DB:** only `migrate deploy`. Never run `migrate dev` against it.
- **Local dev DB:** you can use `migrate dev` to create and apply migrations; then use `migrate deploy` on the real DB to apply those same migrations safely.
