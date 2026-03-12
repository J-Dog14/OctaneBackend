# Interactive Athlete Creation - Implementation Summary

## What Was Added

A safeguard system that **interrupts** ETL processing when new athletes are detected and prompts you to enter demographic information before creating a UUID.

## Files Created

1. **`python/common/athlete_creation.py`**
   - `prompt_for_athlete_info()` - Interactive prompts for demographic data
   - `create_athlete_in_app_db()` - Creates athlete record with UUID
   - `create_source_mapping()` - Creates source_athlete_map entry
   - `handle_unmapped_athletes_interactive()` - Main handler function

2. **`R/common/athlete_creation.R`**
   - R equivalents of all Python functions
   - Same interactive prompting functionality

3. **`docs/athlete_creation_guide.md`**
   - Complete user guide

## Files Modified

1. **`python/common/id_utils.py`**
   - Added `interactive` parameter to `attach_athlete_uuid()`
   - Integrates with athlete creation when `interactive=True`

2. **`python/proSupTest/etl_pro_sup.py`**
   - Enabled interactive mode: `interactive=True`

3. **`R/pitching/kinematics_prep.R`**
   - Added interactive athlete creation after UUID attachment

4. **`R/hitting/kinematics_prep.R`**
   - Added interactive athlete creation after UUID attachment

## How It Works

### When New Athlete is Detected

1. **Detection**: ETL finds athlete not in `source_athlete_map`
2. **Interruption**: Processing stops, prompts appear
3. **Data Collection**: User enters demographic info
4. **Athlete Creation**: System creates:
   - New UUID (automatically generated)
   - Athlete record in `athletes` table
   - Mapping in `source_athlete_map`
5. **Resume**: ETL continues with UUID attached

### Example Prompt

```
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
Created athlete in app database: John Doe (a1b2c3d4-...)
Created mapping: pro_sup/John Doe -> a1b2c3d4-...
```

## Configuration

### Currently Enabled (Interactive Mode)

- **Pro-Sup Test** (`python/proSupTest/etl_pro_sup.py`)
- **Pitching** (`R/pitching/kinematics_prep.R`)
- **Hitting** (`R/hitting/kinematics_prep.R`)

### Other Pipelines

Other ETL pipelines use `interactive=False` by default (just warnings, no prompts).

## Database Tables

The system automatically creates these tables if they don't exist:

### `athletes` Table
- Stores all athlete demographic information
- Primary key: `athlete_uuid` (UUID string)
- Auto-created on first use

### `source_athlete_map` Table  
- Maps source IDs to athlete_uuid
- Composite primary key: (source_system, source_athlete_id)
- Auto-created on first use

## Usage

### Enable Interactive Mode

**Python:**
```python
from common.id_utils import attach_athlete_uuid

df = attach_athlete_uuid(
    df,
    source_system='pro_sup',
    interactive=True  # Enable prompts
)
```

**R:**
```r
source("../common/athlete_creation.R")

clean_df <- handle_unmapped_athletes_interactive(
    clean_df,
    source_system = "pitching",
    interactive = TRUE  # Enable prompts
)
```

### Disable Interactive Mode (Batch)

Set `interactive=False` to skip prompts:
- Unmapped athletes will have `NULL` athlete_uuid
- Warnings will be logged
- Processing continues without interruption

## Benefits

1. **Data Quality**: Ensures demographic info is captured immediately
2. **No Manual Mapping**: Creates UUID and mapping automatically
3. **Flexible**: Can skip athletes or cancel creation
4. **Safe**: Checks for duplicates before creating
5. **Configurable**: Can enable/disable per pipeline

## Next Steps

1. Test with sample data to see prompts in action
2. Adjust prompts if you need different fields
3. Consider adding validation for date formats, etc.
4. Optionally enable for other pipelines (mobility, proteus, etc.)

