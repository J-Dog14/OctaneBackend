# Neon Branch Rotation (Weekly Backup) Guide

This guide explains how to run **automated weekly backups** by rotating data between your Neon branches: **prod → dev → backup → backup 2**, and optionally **prod → prod_alt**. You keep about a month of snapshots (one per week) and can roll back by pointing your app at an older branch.

## How it works

- You work on **prod** (production).
- Every week, a single rotation runs:
  1. **backup → backup 2** (oldest snapshot moves one step)
  2. **dev → backup**
  3. **prod → dev** (dev gets a fresh copy of prod)
  4. **prod → prod_alt** (if `WAREHOUSE_DATABASE_URL_PROD_ALT` is set; same as dev)

After each run:

| Branch    | Contains (approx.)        |
|-----------|---------------------------|
| prod      | Current production        |
| dev       | Prod from last run        |
| prod_alt  | Prod from last run (optional branch) |
| backup    | Prod from 2 runs ago      |
| backup 2  | Prod from 3 runs ago     |

So you always have **four points in time** (current + 3 previous weeks), plus an optional **prod_alt** mirror of dev. If you need to roll back, switch your app’s connection string to dev, prod_alt, backup, or backup 2.

## One-time setup

### 1. Create branches in Neon

In the [Neon Console](https://console.neon.tech):

1. Open your project.
2. **Branches** → create branches: **dev**, **backup**, **backup 2** (from your main/prod branch so they start as copies).
3. Copy the **connection string** for each branch (Connection details → connection string).

### 2. Add connection strings to `.env`

Do **not** commit real credentials. Add these only to your local `.env` (and keep `.env` in `.gitignore`).

For **warehouse** (required for the default rotation):

```env
# Prod is your existing URL (no need to duplicate)
# WAREHOUSE_DATABASE_URL="postgresql://...prod branch..."   ← you already have this

# Neon branch rotation: dev, backup, backup 2; optional prod_alt
WAREHOUSE_DATABASE_URL_DEV="postgresql://user:pass@ep-DEV-BRANCH-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require"
WAREHOUSE_DATABASE_URL_BACKUP="postgresql://user:pass@ep-BACKUP-BRANCH-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require"
WAREHOUSE_DATABASE_URL_BACKUP2="postgresql://user:pass@ep-BACKUP2-BRANCH-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require"
# Optional: prod also copies here (like dev)
# WAREHOUSE_DATABASE_URL_PROD_ALT="postgresql://..."
```

- **Prod**: The script uses `WAREHOUSE_DATABASE_URL` as prod (no need for `WAREHOUSE_DATABASE_URL_PROD`).
- **Connection string**: In the Neon dashboard, when you click Connect you may see `psql 'postgresql://...'`. Use only the URL part (the part inside the quotes), without `psql` or the quotes.

Replace the URLs above with the real connection strings for each branch from the Neon dashboard.

If you also use Neon for the **app** database and want it rotated the same way, use `APP_DATABASE_URL` as prod and add:

```env
APP_DATABASE_URL_DEV="..."
APP_DATABASE_URL_BACKUP="..."
APP_DATABASE_URL_BACKUP2="..."
# APP_DATABASE_URL_PROD_ALT="..."   # optional
```

### 3. Dependencies

- **PostgreSQL client**: `pg_dump` and `psql` must be on your PATH (e.g. from a local PostgreSQL install).
- **Python**: The script uses the same Python/env as the rest of the project; `python-dotenv` is recommended so `.env` is loaded automatically.

## Running the rotation

### Manual run

From the project root:

```powershell
# Rotate warehouse branches (default)
.\rotate_neon_branches.ps1

# Dry run (show what would be copied, no changes)
.\rotate_neon_branches.ps1 -DryRun
```

Or with Python directly:

```powershell
python python/scripts/rotate_neon_branches.py
python python/scripts/rotate_neon_branches.py --dry-run
python python/scripts/rotate_neon_branches.py --db app    # rotate app only
python python/scripts/rotate_neon_branches.py --db all    # rotate warehouse and app
```

### Automated weekly run (Windows Task Scheduler)

1. Open **Task Scheduler** (e.g. search “Task Scheduler” in Windows).
2. **Create Basic Task**:
   - Name: e.g. **UAIS Neon branch rotation**
   - Trigger: **Weekly** (e.g. Sunday 2:00 AM).
   - Action: **Start a program**.
   - Program: `powershell.exe`
   - Arguments: `-NoProfile -ExecutionPolicy Bypass -File "C:\Users\Joey\PycharmProjects\UAIS\rotate_neon_branches.ps1"`
   - Start in: `C:\Users\Joey\PycharmProjects\UAIS`
3. Under **Settings**:
   - Enable “Run whether user is logged on or not” if you want it to run when no one is logged in (the task will use the system account unless you change it; see note below about `.env`).
4. Save.

**Important**: Task Scheduler runs tasks with a different user environment. The script loads `.env` from the project folder, so it will only see the rotation URLs if:

- The “Start in” directory is your project root (so `project_root / ".env"` is correct), and  
- The `.env` file is in that project root.

If you run the task as your own user and “Start in” is `C:\Users\Joey\PycharmProjects\UAIS`, the script will find `.env` there. If you run as a different account, either put a copy of the needed vars in a location that account can read or set the `WAREHOUSE_DATABASE_URL_*` (and optional `APP_DATABASE_URL_*`) as system or user environment variables for that account.

### Alternative: run weekly via GitHub Actions

If you prefer not to use Task Scheduler:

1. Store the connection strings as **repository secrets** (e.g. `NEON_WAREHOUSE_PROD`, `NEON_WAREHOUSE_DEV`, `NEON_WAREHOUSE_BACKUP`, `NEON_WAREHOUSE_BACKUP2`).
2. Add a workflow that runs on a `schedule` (e.g. `0 2 * * 0` for 2 AM Sunday UTC), checks out the repo, sets `WAREHOUSE_DATABASE_URL` (prod) and `WAREHOUSE_DATABASE_URL_DEV`, `_BACKUP`, `_BACKUP2` from secrets, and runs `python python/scripts/rotate_neon_branches.py`.

## Rollback

If you need to undo a bad change:

1. In Neon, identify which branch has the last good state (e.g. **dev** = last week, **backup** = 2 weeks ago).
2. Point your app at that branch:
   - Update `WAREHOUSE_DATABASE_URL` (and `APP_DATABASE_URL` if applicable) in your deployment or `.env` to that branch’s connection string.
3. Redeploy or restart the app so it uses the new URL.

You can also use `.\switch-db-env.ps1` if you’ve wired it to use one of these branches as “dev”; otherwise, just set the URL manually for rollback.

## Troubleshooting

- **“Missing env vars” / “[SKIP] warehouse”**  
  Ensure `WAREHOUSE_DATABASE_URL` is set (prod), and add `_DEV`, `_BACKUP`, `_BACKUP2`. Restart your shell or re-run so the script reloads `.env`.

- **“pg_dump not found”**  
  Install PostgreSQL (or the PostgreSQL client tools) and add its `bin` folder to PATH, or fix the paths in `migrate_to_cloud.py` if you use a custom install location.

- **Rotation fails on a step**  
  Check Neon dashboard and network; confirm the source and target connection strings. Run with `--dry-run` to see the planned steps. Fix any connection or permission issues, then re-run.

- **Task Scheduler runs but nothing happens**  
  Check Task Scheduler history for the task. Ensure “Start in” is the project root and that the account running the task can read `.env` (or has the URLs in its environment).

## Summary

- **One-time**: Create dev, backup, backup 2 in Neon; keep `WAREHOUSE_DATABASE_URL` as prod and add `_DEV`, `_BACKUP`, `_BACKUP2` (and optionally `APP_DATABASE_URL_*` for app) to `.env`.
- **Weekly**: Run `.\rotate_neon_branches.ps1` manually or on a schedule (e.g. Task Scheduler or GitHub Actions).
- **Rollback**: Point `WAREHOUSE_DATABASE_URL` (and `APP_DATABASE_URL` if needed) at the branch with the desired snapshot (dev, backup, or backup 2).
