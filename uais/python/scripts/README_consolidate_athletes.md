# Athlete Consolidation Script

## Purpose

This script consolidates duplicate athletes in the `analytics.d_athletes` table. Duplicates can occur when:
- The same athlete has multiple folders with dates in the name (e.g., "Ryan Weiss 11-25", "Ryan Weiss 10-24")
- Athletes were created before the UNIQUE constraint was enforced
- Normalized names have slight variations

## How It Works

1. **Finds Duplicates**: Groups athletes by `normalized_name`
2. **Selects Canonical UUID**: Chooses the best UUID to keep:
   - Prefers athletes with `app_db_uuid` (most authoritative)
   - Otherwise uses oldest `created_at` (first created)
3. **Merges Metadata**: Combines data from duplicates into canonical record (non-destructive)
4. **Updates Fact Tables**: Updates all fact tables (e.g., `f_kinematics_pitching`) to use canonical UUID
5. **Deletes Duplicates**: Removes duplicate athlete records

## Usage

### Dry Run (Recommended First)

See what would be changed without making any modifications:

```bash
python python/scripts/consolidate_duplicate_athletes.py --dry-run --verbose
```

### Apply Changes

Once you've reviewed the dry run output:

```bash
python python/scripts/consolidate_duplicate_athletes.py --verbose
```

### Options

- `--dry-run`: Show what would be done without making changes
- `--verbose`: Show detailed information about each duplicate group

## Example Output

```
================================================================================
ATHLETE CONSOLIDATION SCRIPT
================================================================================

Step 1: Finding duplicate athletes...
Found 3 groups of duplicate athletes

Step 2: Finding fact tables to update...
Found 1 fact tables: public.f_kinematics_pitching

Step 3: Processing duplicate groups...
--------------------------------------------------------------------------------

RYAN WEISS:
  Keeping: Weiss, Ryan 11-25 (bb20d60f-861e-4d0d-81b3-2e24ca224455)
  Merging: 2 duplicates
    - Weiss, Ryan 10-24 (8cff506e-ccc8-4f25-bfd6-d914ba6847ff)
    - Weiss, Ryan 09-23 (ccd3a51e-b24d-4910-a8f8-16718d1a7b46)
  Updated 15234 rows in public.f_kinematics_pitching
  Deleted 2 duplicate athlete records

================================================================================
CONSOLIDATION SUMMARY
================================================================================
Total duplicate groups processed: 3
Total duplicate records merged: 5

Fact table updates:
  public.f_kinematics_pitching: 45234 rows
```

## Safeguards

The script includes several safeguards:

1. **Dry Run Mode**: Always test first with `--dry-run`
2. **Transaction Safety**: All updates are committed together
3. **Metadata Preservation**: Merges data non-destructively (only fills NULLs)
4. **Fact Table Updates**: Updates all references before deleting duplicates

## Prevention

To prevent future duplicates:

1. **Always use `get_or_create_athlete()`** in ETL scripts (not `create_athlete_in_warehouse()` directly)
2. The `get_or_create_athlete()` function:
   - Normalizes names (removes dates)
   - Checks for existing athletes before creating
   - Uses DOB matching when available
3. The UNIQUE constraint on `normalized_name` prevents duplicates at the database level

## Related Files

- `python/common/athlete_manager.py`: Core athlete management functions
- `sql/create_warehouse_athletes_table.sql`: Database schema with UNIQUE constraint
- `R/common/athlete_manager.R`: R wrapper for athlete management

