# Proteus Data Processing

Automated daily processing of Proteus Motion data with browser automation and ETL pipeline.

## Overview

This module:
1. **Web Automation**: Logs into Proteus web portal and downloads CSV files
2. **ETL Processing**: Parses CSV files and loads data into the warehouse database
3. **File Management**: Tracks processed files and archives them

## Features

- **Browser Automation**: Uses Playwright to automate login and CSV downloads
- **Date Range Selection**: Automatically downloads data for yesterday (configurable)
- **Inbox/Archive Pattern**: New files go to inbox, processed files move to archive
- **Duplicate Prevention**: Only processes files that haven't been processed before
- **Daily Automation**: Can run automatically via Windows Task Scheduler

## Setup

### 1. Install Dependencies

```bash
pip install playwright
playwright install chromium
```

### 2. Set Environment Variables

Create a `.env` file or set environment variables:

```bash
set PROTEUS_EMAIL=jimmy@8ctanebaseball.com
set PROTEUS_PASSWORD=DerekCarr4
set PROTEUS_LOCATION=byoungphysicaltherapy
```

Optional environment variables:
- `PROTEUS_BASE_URL` - Base URL (default: https://kiosk.proteusmotion.com)
- `PROTEUS_DOWNLOAD_DIR` - Where browser saves downloads (default: ~/Downloads)
- `PROTEUS_ETL_INBOX_DIR` - Inbox directory for CSVs (default: from config)
- `PROTEUS_ETL_ARCHIVE_DIR` - Archive directory (default: from config)
- `PROTEUS_DATE_RANGE_DAYS` - Days to download (default: 1 for yesterday)
- `PROTEUS_HEADLESS` - Run browser in headless mode (default: true)

### 3. Configure Directories

Update `config/db_connections.yaml`:

```yaml
raw_data_paths:
  proteus: "D:/Proteus Data/"
```

This will create:
- `D:/Proteus Data/inbox/` - For new CSV files
- `D:/Proteus Data/archive/` - For processed files

## Usage

### Manual Run

```bash
python python/proteus/main.py
```

Or using the module:

```bash
python -m proteus.web
```

### Daily Automation

Run the setup script as Administrator:

```powershell
cd python\proteus
.\setup_daily_task.ps1
```

This creates a Windows scheduled task that runs daily at 2:30 AM.

## How It Works

### Step 1: Download CSV

1. Launches browser (Chromium via Playwright)
2. Navigates to `https://kiosk.proteusmotion.com/login`
3. Logs in with credentials from environment variables
4. Navigates to export/download page
5. Sets date range (default: yesterday)
6. Downloads CSV file
7. Moves CSV to inbox directory

### Step 2: ETL Processing

1. Scans inbox directory for CSV files
2. Checks which files have already been processed
3. For each new file:
   - Loads and parses CSV
   - Cleans and normalizes data
   - Matches athletes using `athlete_manager`
   - Inserts data into `f_proteus` table
   - Updates athlete data flags
   - Moves file to archive directory

## File Structure

```
proteus/
├── web/                    # Browser automation package
│   ├── __init__.py
│   ├── config.py          # Configuration and environment variables
│   ├── login.py           # Login automation
│   ├── download.py        # CSV download automation
│   ├── runner.py          # Main orchestration
│   └── __main__.py        # Entry point (python -m proteus.web)
├── etl_proteus.py         # ETL pipeline (enhanced with inbox/archive)
├── process_raw.py         # CSV parsing and cleaning
├── main.py                # Main entry point
├── run_daily.bat          # Batch file for Task Scheduler
├── setup_daily_task.ps1   # Task Scheduler setup script
└── README.md              # This file
```

## Troubleshooting

### Login Fails

- Check credentials in environment variables
- Run with `PROTEUS_HEADLESS=false` to see browser
- Check if login page structure has changed

### Download Fails

- Verify export page URL hasn't changed
- Check date range selection UI
- Run with headless=false to debug

### ETL Errors

- Check CSV file format matches expected structure
- Verify database connection
- Check athlete matching logic

### Task Doesn't Run

- Verify Task Scheduler task is enabled
- Check task history for errors
- Ensure environment variables are set in the batch file

## Security Notes

- **Never commit credentials** to version control
- Use environment variables or secure credential storage
- The batch file has credentials as fallback - consider using Windows Credential Manager for production

## Integration

This module integrates with:
- `common.athlete_manager` - For athlete matching and creation
- `common.athlete_matcher` - For updating athlete data flags
- `common.config` - For database and path configuration
- `warehouse.f_proteus` - Target database table
