# Athlete Manager Guide

## Overview

The Athlete Manager is a centralized system for managing athlete identity across all UAIS ETL scripts. It provides a single source of truth for athlete UUIDs and demographic information in the warehouse database.

## Architecture

### Database Structure

- **Warehouse Database**: `analytics.d_athletes` table
  - Master athlete dimension table
  - Stores all athlete information
  - Acts as source of truth for UUIDs

- **App Database**: `public."User"` table
  - Source of truth for app UUIDs
  - Checked for existing UUIDs when creating new athletes

### Key Features

1. **Non-destructive updates**: Only fills in missing data, never overwrites existing data
2. **Automatic UUID matching**: Checks app database for existing UUIDs
3. **Name normalization**: Handles "LAST, FIRST" format and removes dates
4. **Multi-source support**: Can receive data from any ETL script (pitching, hitting, etc.)

## Setup

### 1. Initialize Warehouse Table

```bash
python python/scripts/init_warehouse_athletes.py
```

This creates the `analytics.d_athletes` table in your warehouse database.

### 2. Use in Python Scripts

```python
from python.common.athlete_manager import get_or_create_athlete

# Get or create athlete UUID
athlete_uuid = get_or_create_athlete(
    name="Weiss, Ryan 11-25",
    date_of_birth="1996-12-10",
    age=28,
    age_at_collection=27.5,
    height=1.96,
    weight=100.7,
    source_system="pitching",
    source_athlete_id="RW-001"
)
```

### 3. Use in R Scripts

```r
source("R/common/athlete_manager.R")

# Get or create athlete UUID
athlete_uuid <- get_or_create_athlete(
  name = "Weiss, Ryan 11-25",
  date_of_birth = "1996-12-10",
  age = 28,
  age_at_collection = 27.5,
  height = 1.96,
  weight = 100.7,
  source_system = "pitching",
  source_athlete_id = "RW-001"
)
```

## Workflow

### When Processing Data

1. **At the start of each ETL script**:
   - Call `get_or_create_athlete()` for each athlete found
   - This ensures all athletes are registered in the warehouse

2. **The function will**:
   - Normalize the name
   - Check warehouse for existing athlete
   - If found: Update with any new info (non-destructive)
   - If not found: Check app database for UUID
   - If found in app DB: Use that UUID
   - If not found: Generate new UUID
   - Create/update athlete in warehouse
   - Return UUID

3. **Use the returned UUID**:
   - Store in your fact tables
   - Link all data to this UUID

## Example: Updating Pitching Script

```r
# In R/pitching/pitching_processing.R

# At the start, after finding athletes:
source("R/common/athlete_manager.R")

# In extract_athlete_info or process_all_files:
athlete_uuid <- get_or_create_athlete(
  name = athlete_name,
  date_of_birth = dob,
  age = age,
  age_at_collection = age_at_collection,
  gender = gender,
  height = height,
  weight = weight,
  source_system = "pitching",
  source_athlete_id = athlete_id
)

# Use athlete_uuid instead of generating new UUIDs
```

## Best Practices

1. **Always call at script start**: Register all athletes before processing data
2. **Provide as much info as possible**: More data = better matching
3. **Use consistent source_system**: Helps track where data came from
4. **Don't worry about duplicates**: The system handles matching automatically
5. **Check app DB by default**: Set `check_app_db=TRUE` to match existing UUIDs

## Troubleshooting

### UUID not matching app database

- Check that name normalization is working correctly
- Verify app database connection in `db_connections.yaml`
- Check logs for normalization results

### Duplicate athletes

- The system should prevent duplicates by normalized name
- If you see duplicates, check the `normalized_name` column
- May need to manually merge if names are truly different

### Performance

- First run may be slow (checking app DB for all athletes)
- Subsequent runs are fast (uses warehouse cache)
- Consider batching if processing thousands of athletes

