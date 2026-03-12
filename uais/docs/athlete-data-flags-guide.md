# Athlete Data Flags Guide

## Overview

The `d_athletes` table now includes boolean flags and session counts for each data system. This allows you to quickly see:
- Which athletes have data in each system (boolean flags)
- How many sessions each athlete has in each system (count columns)

## Columns Added

### Boolean Flags (has data?)
- `has_pitching_data` - TRUE if athlete has pitching data
- `has_athletic_screen_data` - TRUE if athlete has athletic screen data
- `has_pro_sup_data` - TRUE if athlete has pro-sup data
- `has_readiness_screen_data` - TRUE if athlete has readiness screen data
- `has_mobility_data` - TRUE if athlete has mobility data
- `has_proteus_data` - TRUE if athlete has proteus data
- `has_hitting_data` - TRUE if athlete has hitting data

### Session Counts (number of sessions)
- `pitching_session_count` - Number of distinct sessions (dates) in pitching
- `athletic_screen_session_count` - Number of distinct sessions in athletic screen
- `pro_sup_session_count` - Number of distinct sessions in pro-sup
- `readiness_screen_session_count` - Number of distinct sessions in readiness screen
- `mobility_session_count` - Number of distinct sessions in mobility
- `proteus_session_count` - Number of distinct sessions in proteus
- `hitting_session_count` - Number of distinct sessions in hitting

## Automatic Updates

**Triggers are set up** to automatically update these flags whenever data is inserted, updated, or deleted in any fact table. No manual intervention needed!

## Manual Updates

If you need to refresh all flags manually (e.g., after bulk imports):

### Option 1: SQL Function
```sql
SELECT update_athlete_data_flags();
```

### Option 2: Python Script
```bash
python python/scripts/update_athlete_data_flags.py
```

## Usage Examples

### Find athletes with pitching data
```sql
SELECT name, pitching_session_count 
FROM analytics.d_athletes 
WHERE has_pitching_data = TRUE
ORDER BY pitching_session_count DESC;
```

### Find athletes with data in multiple systems
```sql
SELECT 
    name,
    has_pitching_data,
    has_athletic_screen_data,
    has_pro_sup_data,
    (has_pitching_data::int + 
     has_athletic_screen_data::int + 
     has_pro_sup_data::int) as total_systems
FROM analytics.d_athletes
WHERE has_pitching_data = TRUE 
   OR has_athletic_screen_data = TRUE
   OR has_pro_sup_data = TRUE
ORDER BY total_systems DESC;
```

### Find athletes with multiple sessions
```sql
SELECT 
    name,
    pitching_session_count,
    athletic_screen_session_count,
    pro_sup_session_count
FROM analytics.d_athletes
WHERE pitching_session_count > 3
   OR athletic_screen_session_count > 3
ORDER BY pitching_session_count DESC;
```

## Setup

### 1. Apply the Migration

First, create the migration to add the columns:

```bash
npm run prisma:warehouse:migrate
```

Name it: `add_athlete_data_flags_and_counts`

### 2. Run the SQL Setup Script

This creates the functions and triggers:

```bash
# In Beekeeper Studio or psql
psql -U postgres -d uais_warehouse -f sql/update_athlete_data_flags.sql
```

Or execute the SQL file in Beekeeper Studio.

### 3. Initial Population

After setup, populate the flags for existing data:

```sql
SELECT update_athlete_data_flags();
```

Or run the Python script:
```bash
python python/scripts/update_athlete_data_flags.py
```

## How It Works

1. **Triggers**: When data is inserted/updated/deleted in any fact table, a trigger fires
2. **Update Function**: The trigger calls a function that updates flags for the affected athlete
3. **Count Calculation**: Counts are based on `COUNT(DISTINCT session_date)` for each table
4. **Boolean Flags**: Set to TRUE if any data exists, FALSE otherwise

## Performance

- Triggers update only the affected athlete (optimized)
- Initial population may take a few seconds for large datasets
- Flags are stored in the table (no runtime calculation needed)
- Indexes on fact tables ensure fast lookups

## Maintenance

The flags are automatically maintained by triggers. However, if you:
- Bulk import data outside of normal ETL processes
- Manually modify fact tables
- Need to refresh after data cleanup

Run the update function or Python script to refresh all flags.

