# VercelDB UUID Management

This document describes the UUID management system that uses verceldb as the master source of truth for athlete UUIDs.

## Overview

The system follows a hierarchical order:
1. **verceldb/User** - Master source of truth (read-only)
2. **uais_warehouse/d_athletes** - Warehouse athlete dimension table
3. **f_ tables** - All fact tables (f_athletic_screen, f_pro_sup, etc.)

## How It Works

### When Creating Athletes

When an athlete is created in `d_athletes`:
1. The system first checks if the athlete's name exists in `verceldb.User`
2. If a match is found, the UUID from verceldb is used
3. If no match is found, a new UUID is generated
4. The UUID is then used consistently across all tables

### Name Matching

The system uses normalized name matching:
- Names are normalized to "FIRST LAST" format (uppercase, no dates)
- Handles "LAST, FIRST" format conversion
- Removes dates and other suffixes
- Performs fuzzy matching if exact match fails

### Backfilling UUIDs

Since athletes may be added to verceldb after they were created in the warehouse, there's a backfill function that:
1. Checks all athletes in `d_athletes` without `app_db_uuid`
2. Searches verceldb for name matches
3. Updates UUIDs across all tables when matches are found

## Configuration

Add verceldb configuration to `config/db_connections.yaml`:

```yaml
databases:
  verceldb:
    postgres:
      host: "localhost"
      port: 5432
      database: "verceldb"
      user: "postgres"
      password: "your_password"
```

## Functions

### `check_verceldb_for_uuid(normalized_name: str) -> Optional[str]`

Checks verceldb User table for a name match and returns the UUID if found.

### `update_uuid_from_verceldb(athlete_uuid: str, normalized_name: str, conn=None) -> bool`

Updates a single athlete's UUID from verceldb if a match is found.

### `update_uuid_across_tables(old_uuid: str, new_uuid: str, conn=None) -> bool`

Updates athlete UUID across all tables:
- Updates `d_athletes` first
- Then updates all `f_` tables
- Includes conflict checking to prevent UUID collisions

### `backfill_uuids_from_verceldb(conn=None, dry_run: bool = False) -> Dict[str, Any]`

Backfills UUIDs for all athletes without `app_db_uuid`:
- Checks verceldb for name matches
- Updates UUIDs across all tables
- Returns summary statistics

## Usage

### Automatic UUID Assignment

UUIDs are automatically checked from verceldb when using:
- `get_or_create_athlete()` - Main function for ETL scripts
- `create_athlete_in_warehouse()` - Direct athlete creation

### Manual Backfill

Run the backfill script to update existing athletes:

```bash
# Dry run (see what would be updated)
python python/scripts/backfill_uuids_from_verceldb.py --dry-run

# Apply updates
python python/scripts/backfill_uuids_from_verceldb.py
```

### Programmatic Usage

```python
from python.common.athlete_manager import (
    backfill_uuids_from_verceldb,
    update_uuid_from_verceldb,
    get_or_create_athlete
)

# Backfill all athletes
result = backfill_uuids_from_verceldb(dry_run=False)
print(f"Updated {result['updated']} athletes")

# Update single athlete
updated = update_uuid_from_verceldb(
    athlete_uuid="existing-uuid",
    normalized_name="JOHN DOE"
)

# Create/get athlete (automatically checks verceldb)
uuid = get_or_create_athlete(
    name="Doe, John",
    source_system="pitching"
)
```

## Fact Tables Updated

The following fact tables are updated when UUIDs change:
- `f_athletic_screen`
- `f_athletic_screen_cmj`
- `f_athletic_screen_dj`
- `f_athletic_screen_slv`
- `f_athletic_screen_nmt`
- `f_athletic_screen_ppu`
- `f_pro_sup`
- `f_readiness_screen`
- `f_readiness_screen_i`
- `f_readiness_screen_y`
- `f_readiness_screen_t`
- `f_readiness_screen_ir90`
- `f_readiness_screen_cmj`
- `f_readiness_screen_ppu`
- `f_mobility`
- `f_proteus`
- `f_kinematics_pitching`
- `f_kinematics_hitting`

## Notes

- verceldb is treated as **read-only** - never write to it from warehouse code
- UUID conflicts are detected and prevented (if new UUID already exists for different athlete)
- All updates are transactional - if any table update fails, the transaction is rolled back
- The system logs all UUID updates for audit purposes

