# Mobility Assessment Processing

This module processes Google Sheets files containing mobility assessment data and loads them into the warehouse database.

## Overview

The script reads Excel files (Google Sheets downloaded as .xlsx) from `D:\Mobility Assessments` and extracts:

1. **Demographic Data** (from specific cells):
   - **A6**: Name (ignores "Name: " prefix)
   - **A7**: Birthday (ignores "Birthday: " prefix)
   - **B6**: Height (ignores "Height: " prefix)
   - **B7**: Weight (ignores "Weight: " prefix)
   - **C6**: Gmail/Email (ignores "Gmail: " prefix)
   - **C7**: Entire string value (stored as-is)

2. **Assessment Metrics** (from rows 10-54):
   - **Column A (A10:A54)**: Metric names (used as column names in database)
   - **Column B (B10:B54)**: Numerical values for each metric
   - **Column C (C10)**: Medical History (string)

## Features

- **Automatic athlete creation/updates**: Uses `athlete_manager.py` to handle athlete deduplication and merging
- **Dynamic column creation**: Automatically creates database columns based on metric names in A10:A54
- **File tracking**: Tracks processed files to avoid duplicates
- **Data flag updates**: Updates `has_mobility_data` flag in `d_athletes` table
- **Error handling**: Continues processing even if individual files fail

## Usage

### Basic Usage

```bash
python python/mobility/main.py
```

The script will:
1. Scan `D:\Mobility Assessments` for Excel files (.xlsx, .xls)
2. Skip files that have already been processed
3. Extract data from each file
4. Create/update athletes in `d_athletes` table
5. Insert/update records in `f_mobility` table
6. Update athlete data flags

### Configuration

The default path is `D:\Mobility Assessments`. To change it:

1. Update the path in `python/mobility/main.py` (in the `main()` function)
2. Or add it to your config file under the `mobility` key

## Database Schema

### Standard Columns in `f_mobility`

- `athlete_uuid`: UUID of the athlete
- `session_date`: Date of the assessment (uses file modification date)
- `source_system`: Always "mobility"
- `source_athlete_id`: Extracted from athlete name
- `source_file`: Path to the source Excel file (for tracking)
- `medical_history`: String from cell C10
- `c7_value`: String from cell C7
- `age_at_collection`: Calculated if DOB is available
- `age_group`: Calculated if DOB is available

### Dynamic Columns

Additional columns are created dynamically based on the metric names in cells A10:A54. Column names are sanitized for SQL compatibility:
- Spaces and special characters → underscores
- Converted to lowercase
- Leading/trailing underscores removed

Example: "Shoulder Flexion (Left)" → `shoulder_flexion_left`

## Prisma Schema

The Prisma schema includes:
- Standard columns (athlete_uuid, session_date, etc.)
- `sourceFile` and `medicalHistory` columns
- Note that dynamic metric columns are added at runtime and may not appear in the Prisma schema

To add new columns to the Prisma schema, run:
```bash
npm run prisma:warehouse:migrate
```

## Processing Flow

1. **File Discovery**: Finds all .xlsx/.xls files in the directory
2. **Duplicate Check**: Compares against already processed files (via `source_file` column)
3. **Data Extraction**:
   - Reads demographic data from cells A6, A7, B6, B7, C6, C7
   - Reads assessment metrics from A10:A54 (names) and B10:B54 (values)
   - Reads medical history from C10
4. **Athlete Management**:
   - Extracts source_athlete_id from name
   - Calls `get_or_create_athlete()` to handle deduplication
   - Updates athlete demographic data (height, weight, email, DOB)
5. **Database Operations**:
   - Ensures all required columns exist (creates them if needed)
   - Inserts new record or updates existing one
   - Updates athlete data flags

## Error Handling

- Files with missing names are skipped
- Files with no assessment metrics are skipped
- Individual file errors don't stop batch processing
- Errors are logged and reported in the summary

## Output

The script prints:
- Processing status for each file
- Number of files processed
- Number of records inserted/updated
- List of any errors encountered
- Athlete data flag update summary

## Integration with Athlete Manager

The script uses the standard `athlete_manager.py` functions:
- `get_or_create_athlete()`: Handles athlete creation and deduplication
- `update_athlete_data_flag()`: Updates `has_mobility_data` flag
- `update_athlete_flags()`: Updates all athlete flags after processing

This ensures consistency with other data processing scripts (pitching, hitting, athletic screen, etc.).
