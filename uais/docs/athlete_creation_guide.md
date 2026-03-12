# Interactive Athlete Creation Guide

## Overview

When processing data from pitching, hitting, or pro_sup systems, if an athlete is not found in the app database, the system will now **interrupt** and prompt you to enter demographic information to create a new athlete record.

## How It Works

### Python ETL Pipelines

When `interactive=True` is set in `attach_athlete_uuid()`, the system will:

1. **Detect unmapped athletes** - Athletes not found in `source_athlete_map`
2. **Interrupt processing** - Stop and prompt for each new athlete
3. **Collect demographic info** - Ask for name, DOB, gender, height, weight, etc.
4. **Create athlete record** - Insert into `athletes` table with new UUID
5. **Create mapping** - Add entry to `source_athlete_map`
6. **Continue processing** - Resume ETL with UUID attached

### Example Flow

```
Starting Pro-Sup Test ETL...
Loading raw data...
Cleaning data...
Attaching athlete_uuid...

Found 2 unmapped athletes for pro_sup.

============================================================
NEW ATHLETE DETECTED
============================================================
Source System: pro_sup
Source Athlete ID: John Doe

Please provide demographic information for this athlete.
(Press Enter to skip optional fields, type 'cancel' to skip this athlete)

Full Name (required): John Doe
Date of Birth (YYYY-MM-DD, optional): 1995-06-15
Gender (M/F/Other, optional): M
Height (inches or cm, optional): 72
Weight (lbs or kg, optional): 180
Email (optional): john.doe@example.com
Phone (optional): 
Notes (optional): 

Athlete information collected for: John Doe
Create this athlete? (y/n): y
Created athlete in app database: John Doe (a1b2c3d4-e5f6-7890-abcd-ef1234567890)
Created mapping: pro_sup/John Doe -> a1b2c3d4-e5f6-7890-abcd-ef1234567890

[Process continues for next athlete...]
```

## Configuration

### Enable Interactive Mode

**Python:**
```python
from common.id_utils import attach_athlete_uuid

# Enable interactive athlete creation
df = attach_athlete_uuid(
    df,
    source_system='pro_sup',
    source_id_column='source_athlete_id',
    interactive=True  # Set to True to enable prompts
)
```

**R:**
```r
source("../common/athlete_creation.R")

clean_df <- handle_unmapped_athletes_interactive(
    clean_df,
    source_system = "pitching",
    source_id_column = "source_athlete_id",
    interactive = TRUE  # Set to TRUE to enable prompts
)
```

### Disable Interactive Mode (Batch Processing)

Set `interactive=False` to skip prompts and just flag unmapped athletes:

```python
df = attach_athlete_uuid(
    df,
    source_system='pro_sup',
    interactive=False  # Will just warn, not prompt
)
```

## Current Configuration

The following ETL pipelines have interactive mode **enabled**:

-  **Pro-Sup Test** (`python/proSupTest/etl_pro_sup.py`)
-  **Pitching** (`R/pitching/kinematics_prep.R`)
-  **Hitting** (`R/hitting/kinematics_prep.R`)

Other pipelines use `interactive=False` by default (just warnings).

## Required vs Optional Fields

### Required
- **Full Name** - Must be provided

### Optional (can skip with Enter)
- Date of Birth (YYYY-MM-DD format)
- Gender (M/F/Other)
- Height (numeric)
- Weight (numeric)
- Email
- Phone
- Notes

## Skipping Athletes

- Type `cancel` when prompted for name to skip that athlete
- Type `n` when asked to confirm creation
- Athlete will be skipped and data will have `NULL` athlete_uuid

## Database Tables Created

The system automatically creates these tables if they don't exist:

### `athletes` table
```sql
CREATE TABLE athletes (
    athlete_uuid TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    date_of_birth TEXT,
    gender TEXT,
    height REAL,
    weight REAL,
    email TEXT,
    phone TEXT,
    notes TEXT,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
)
```

### `source_athlete_map` table
```sql
CREATE TABLE source_athlete_map (
    source_system TEXT NOT NULL,
    source_athlete_id TEXT NOT NULL,
    athlete_uuid TEXT NOT NULL,
    created_at TIMESTAMP,
    PRIMARY KEY (source_system, source_athlete_id)
)
```

## Best Practices

1. **Run interactively** when first importing new data sources
2. **Use batch mode** (`interactive=False`) for scheduled/automated runs
3. **Review unmapped athletes** periodically and create them manually in Beekeeper if preferred
4. **Keep demographic info consistent** - Use same format for dates, units, etc.

## Troubleshooting

**"No athletes table found"**
- The system will create it automatically
- If you see this error, check database permissions

**"Duplicate athlete UUID"**
- Shouldn't happen (UUIDs are unique)
- System will skip creation if UUID already exists

**"Mapping already exists"**
- Athlete was already mapped
- System will skip creating duplicate mapping

**Want to update athlete info later?**
- Use Beekeeper Studio to edit the `athletes` table directly
- Or create a script to update specific athletes
