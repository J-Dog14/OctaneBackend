# Athlete Data Flags Update Guide

## Overview

The `d_athletes` table includes boolean flags and session counts that indicate which athletes have data in each fact table. These flags are automatically updated via database triggers, but can also be updated manually.

## Automatic Updates (Recommended)

Database triggers automatically update flags when data is inserted, updated, or deleted in fact tables. To set up the triggers, run:

```bash
psql -U postgres -d uais_warehouse -f sql/update_athlete_data_flags.sql
```

This creates:
- `update_athlete_data_flags()` function - updates all athletes
- `trigger_update_athlete_flags()` function - updates specific athlete when their data changes
- Triggers on all fact tables to call the trigger function

## Manual Updates

### In R Scripts

After bulk data inserts, call the update function:

```r
# At the end of your upload script
if (use_warehouse) {
  update_result <- update_athlete_flags(con, verbose = TRUE)
  if (update_result$success) {
    cat("Flags updated successfully\n")
  }
}
```

The function is available from `R/common/db_utils.R` (automatically loaded).

### In Python Scripts

```python
from python.common.athlete_manager import update_athlete_flags

# At the end of your upload script
result = update_athlete_flags(conn=your_connection, verbose=True)
if result['success']:
    print("Flags updated successfully")
```

### Direct SQL

```sql
-- Update all athletes
SELECT update_athlete_data_flags();

-- Or update a specific athlete (via trigger function)
-- This happens automatically when data changes
```

### Standalone Scripts

**Python:**
```bash
python python/scripts/update_athlete_data_flags.py
```

**R:**
```r
source("R/common/db_utils.R")
conn <- get_warehouse_connection()
update_athlete_flags(conn)
```

## What Gets Updated

For each athlete, the following flags and counts are updated:

- `has_pitching_data` / `pitching_session_count`
- `has_athletic_screen_data` / `athletic_screen_session_count`
- `has_pro_sup_data` / `pro_sup_session_count`
- `has_readiness_screen_data` / `readiness_screen_session_count`
- `has_mobility_data` / `mobility_session_count`
- `has_proteus_data` / `proteus_session_count`
- `has_hitting_data` / `hitting_session_count`

## Best Practices

1. **After Bulk Inserts**: Always call `update_athlete_flags()` after bulk data inserts to ensure accuracy
2. **After Data Deletions**: Flags are updated automatically via triggers, but you can manually refresh if needed
3. **Scheduled Updates**: Consider running the standalone script periodically to catch any inconsistencies
4. **Performance**: The trigger function only updates the affected athlete, so it's efficient for individual changes

## Troubleshooting

**Flags not updating:**
- Check if triggers are installed: `\df trigger_update_athlete_flags` in psql
- Check if function exists: `\df update_athlete_data_flags` in psql
- Manually run: `SELECT update_athlete_data_flags();`

**Function not found in R:**
- Ensure `R/common/db_utils.R` is sourced (should happen automatically)
- Check that `find_and_source_common()` is called in your script

**Function not found in Python:**
- Ensure `python/common/athlete_manager.py` is in your Python path
- Import: `from python.common.athlete_manager import update_athlete_flags`

