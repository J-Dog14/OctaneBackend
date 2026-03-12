# Readiness Screen Module Structure

This module has been refactored from a single monolithic `process_raw.py` file into an organized, modular structure.

## Module Organization

### Core Modules

- **`main.py`** - Main orchestration script. Run this to process all data.
- **`database.py`** - Database setup, schema definitions, and table operations
- **`file_parsers.py`** - XML and ASCII file parsing utilities
- **`database_utils.py`** - Database reordering and maintenance utilities
- **`dashboard.py`** - Dash dashboard application for interactive visualization

### Legacy Support

- **`process_raw.py`** - Deprecated, but maintained for backward compatibility
  - Imports from new modules
  - Redirects to `main.py` when run directly

## Usage

### Basic Processing

```python
from readinessScreen.main import process_xml_and_ascii

# Process XML and ASCII files
name, participant_id = process_xml_and_ascii(
    folder_path="D:/Readiness Screen 3/Data/",
    db_path="D:/Readiness Screen 3/Readiness_Screen_Data_v2.db",
    output_path="D:/Readiness Screen 3/Output Files/",
    use_dialog=True
)
```

### Run Main Script

```bash
python python/readinessScreen/main.py
```

### Launch Dashboard

```python
from readinessScreen.dashboard import run_dashboard

# Launch interactive dashboard
run_dashboard(
    db_path="D:/Readiness Screen 3/Readiness_Screen_Data_v2.db",
    port=8051
)
```

Or run directly:
```bash
python python/readinessScreen/dashboard.py
```

### Individual Module Usage

```python
# Parse XML file
from readinessScreen.file_parsers import parse_xml_file
xml_data = parse_xml_file("path/to/session.xml")

# Parse ASCII file
from readinessScreen.file_parsers import parse_ascii_file
df = parse_ascii_file("path/to/cmj_data.txt", "CMJ")

# Database operations
from readinessScreen.database import initialize_database, insert_participant
conn = initialize_database("path/to/db.db")
participant_id = insert_participant(conn, name, height, weight, plyo_day, date)
```

## Migration Notes

The original `process_raw.py` (640 lines) has been split into:

1. **Database setup** (lines 1-125) → `database.py`
2. **XML parsing and participant insertion** (lines 127-184) → `file_parsers.py` + `database.py`
3. **ASCII file processing** (lines 186-250) → `file_parsers.py` + `database.py`
4. **Database reordering** (lines 252-305) → `database_utils.py`
5. **Dash dashboard** (lines 307-640) → `dashboard.py`
6. **Main orchestration** → `main.py` (new)

## Processing Workflow

1. **XML Processing**: Parse Session XML file, extract participant info, insert into database
2. **ASCII Processing**: Parse ASCII data files (I, Y, T, IR90, CMJ, PPU), insert trial data
3. **Database Reordering** (optional): Reorder all tables alphabetically by Name
4. **Dashboard** (optional): Launch interactive web dashboard for visualization

## Configuration

Update paths in `main.py`:
- `base_dir`: Base directory for Readiness Screen data
- `db_path`: Database file path
- `output_path`: Directory containing ASCII output files

## Functionality

All original functionality is preserved:
- XML file parsing and participant insertion
- ASCII file parsing and trial data insertion
- Database table creation and schema management
- Database reordering
- Interactive Dash dashboard with time-series and scatter plots

## Dashboard Features

The dashboard provides:
- Athlete selection dropdown
- Avg Force time-series plots (I, T, Y, IR90)
- CMJ and PPU jump height time-series
- Force-vs-Velocity scatter plots with reference data
- Statistical summary boxes showing latest, previous, and delta values

