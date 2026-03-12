# Youth Pitch Design Analysis

This project analyzes pitch kinematics data and generates PDF reports.

## Project Structure

- **`main.py`** - Main entry point. Run this file to execute the full analysis pipeline.
- **`updateReferenceData.py`** - Script to add or update reference data in the database. Reference data is used for comparison in reports.
- **`config.py`** - Configuration file containing all file paths and database settings.
- **`database.py`** - Database initialization and data ingestion functions.
- **`parsers.py`** - Functions for parsing events, link model based, and acceleration data files.
- **`utils.py`** - Utility functions including stability score computation and file info parsing.
- **`reports.py`** - Report generation functions for creating PDF reports with graphs and tables.

## Usage

### Normal Analysis Workflow

Simply run:
```bash
python main.py
```

This will:
1. Initialize the database tables (if they don't exist)
2. Process regular pitch data from the configured input files
3. Generate a PDF report comparing your data to existing reference data

**Important:** The `main.py` script does NOT modify reference data. Reference data remains untouched and is only used for comparison in reports.

### Updating Reference Data

To add or update reference data (baseline data used for comparison), run:
```bash
python updateReferenceData.py
```

This script will:
1. Show you current reference data in the database
2. Ask for confirmation before proceeding
3. Read reference data from the files specified in `config.py`
4. Add new reference pitches or update existing ones

**Note:** Make sure to update the reference file paths in `config.py` before running this script.

## File Paths

All file paths are configured in `config.py`. They are currently set to:
- Input files: `D:\Youth Pitch Design\Exports\`
- Reference files: `D:\Youth Pitch Design\Exports\reference_*.txt`
- Output reports: `D:\Youth Pitch Design\Reports\`
- Database: `pitch_kinematics.db` (in the current directory)

## Reference Data

Reference data serves as a baseline for comparison in reports. It is:
- **Never modified** by the main analysis script (`main.py`)
- **Only updated** through the dedicated `updateReferenceData.py` script
- **Only read** during report generation for comparison purposes

## Dependencies

- pandas
- numpy
- sqlite3 (built-in)
- plotly
- reportlab

