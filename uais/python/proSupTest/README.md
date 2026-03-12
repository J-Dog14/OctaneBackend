# Pro-Sup Test Module Structure

This module has been refactored from a single monolithic `process_raw.py` file into an organized, modular structure.

## Module Organization

### Core Modules

- **`main.py`** - Main orchestration script. Run this to process all data.
- **`database.py`** - Database operations and table management
- **`file_parsers.py`** - XML and ASCII file parsing utilities
- **`score_calculation.py`** - Fatigue indices, consistency penalties, and total score calculation
- **`report_generation.py`** - PDF report generation with charts and visualizations

### Legacy Support

- **`process_raw.py`** - Deprecated, but maintained for backward compatibility
  - Imports from new modules
  - Redirects to `main.py` when run directly

## Usage

### Basic Processing

```python
from proSupTest.main import main

# Run full processing pipeline
main()
```

### Individual Module Usage

```python
# Parse XML file
from proSupTest.file_parsers import parse_xml_file, find_session_xml
xml_path = find_session_xml("path/to/folder")
data = parse_xml_file(xml_path, "2024-08-13")

# Parse ASCII file
from proSupTest.file_parsers import parse_ascii_file
ascii_data = parse_ascii_file("path/to/ascii.txt")

# Calculate scores
from proSupTest.score_calculation import calculate_all_scores
df_with_scores = calculate_all_scores(df)

# Generate report
from proSupTest.report_generation import generate_pdf_report
pdf_path = generate_pdf_report(
    athlete_name="John Doe",
    test_date="2024-08-13",
    db_path="path/to/db.sqlite",
    output_dir="path/to/reports"
)
```

## Migration Notes

The original `process_raw.py` (487 lines) has been split into:

1. **XML parsing and database insertion** (lines 1-111) → `file_parsers.py` + `database.py`
2. **ASCII parsing and database update** (lines 113-182) → `file_parsers.py` + `database.py`
3. **Score calculation** (lines 184-236) → `score_calculation.py`
4. **PDF report generation** (lines 238-487) → `report_generation.py`
5. **Main orchestration** → `main.py` (new)

## Processing Workflow

1. **XML Processing**: Parse Session XML file, extract athlete info, insert into database
2. **ASCII Processing**: Parse ASCII data file, update database with metrics
3. **Score Calculation**: Calculate fatigue indices, consistency penalties, and total scores
4. **Report Generation** (optional): Generate PDF report with charts and analysis

## Configuration

Update paths in `main.py`:
- `base_dir`: Base directory for Pro-Sup Test data
- `db_path`: Database file path
- `ascii_file_path`: ASCII data file path
- `report_dir`: Output directory for reports
- `logo_path`: Path to logo image (optional)

## Functionality

All original functionality is preserved:
- XML file parsing and database insertion
- ASCII file parsing and database updates
- Fatigue index calculation
- Total score computation
- PDF report generation with charts

