# Athletic Screen Module Structure

This module has been refactored from a single monolithic `process_raw.py` file into an organized, modular structure.

## Module Organization

### Core Modules

- **`main.py`** - Main orchestration script. Run this to process all data.
- **`database.py`** - Database setup, schema definitions, and table operations
- **`file_parsers.py`** - File parsing utilities for extracting data from .txt files
- **`power_analysis.py`** - Power curve analysis and metrics computation
- **`database_replication.py`** - Database replication and synchronization utilities

### Report Generation (Placeholder)

- **`report_generation.py`** - Placeholder for report generation functionality
  - **Note**: The full report generation code (lines 513-1751 from original `process_raw.py`) needs to be refactored into this module
  - Suggested sub-modules:
    - `report_plots.py` - All plotting functions
    - `report_document.py` - Document assembly
    - `report_data.py` - Data loading for reports

### Legacy Support

- **`process_raw.py`** - Deprecated, but maintained for backward compatibility
  - Imports from new modules
  - Redirects to `main.py` when run directly

## Usage

### Basic Processing

```python
from athleticScreen.main import process_raw_files

# Process all files and create database
process_raw_files(
    folder_path="D:/Athletic Screen 2.0/Output Files/",
    db_path="D:/Athletic Screen 2.0/Output Files/movement_database_v2.db",
    reset_db=False
)
```

### Run Main Script

```bash
python python/athleticScreen/main.py
```

### Individual Module Usage

```python
# Parse a single file
from athleticScreen.file_parsers import parse_movement_file
data = parse_movement_file("path/to/file.txt", "path/to/folder")

# Analyze power curve
from athleticScreen.power_analysis import analyze_power_curve_advanced
metrics = analyze_power_curve_advanced(power_array, fs_hz=1000.0)

# Database operations
from athleticScreen.database import create_database, create_tables
conn = create_database("path/to/db.db", reset=False)
create_tables(conn)
```

## Migration Notes

The original `process_raw.py` (1974 lines) has been split into:

1. **Database setup** (lines 1-87) → `database.py`
2. **File parsing** (lines 88-264) → `file_parsers.py`
3. **Power analysis** (lines 266-511) → `power_analysis.py`
4. **Report generation** (lines 513-1751) → `report_generation.py` (TODO: needs refactoring)
5. **Database replication** (lines 1766-1973) → `database_replication.py`
6. **Main orchestration** → `main.py` (new)

## Next Steps

1. Core processing modules created
2. Report generation needs to be refactored from original code
3. Database replication modularized
4. Main orchestration script created

## Functionality

All original functionality is preserved:
- File parsing and data extraction
- Database creation and population
- Power curve analysis
- Database replication
- Report generation (structure created, needs implementation)

