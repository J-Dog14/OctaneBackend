# Testing Proteus Processing

## Quick Test Steps

### Option 1: Test with Existing CSV Files

If you have CSV files already downloaded:

1. **Place CSV files in the inbox directory:**
   ```
   D:\Proteus Data\inbox\
   ```
   (This directory will be created automatically if it doesn't exist)

2. **Run the ETL test:**
   ```powershell
   cd c:\Users\Joey\PycharmProjects\UAIS
   .\venv\Scripts\activate
   python python\proteus\test_etl.py
   ```

### Option 2: Test Full Download + ETL

To test the complete flow (download from portal + ETL):

1. **Set environment variables** (if not already set):
   ```powershell
   $env:PROTEUS_EMAIL = "jimmy@8ctanebaseball.com"
   $env:PROTEUS_PASSWORD = "DerekCarr4"
   $env:PROTEUS_LOCATION = "byoungphysicaltherapy"
   $env:PROTEUS_HEADLESS = "false"  # Set to false to see browser
   ```

2. **Run the main script:**
   ```powershell
   cd c:\Users\Joey\PycharmProjects\UAIS
   .\venv\Scripts\activate
   python python\proteus\main.py
   ```

   Or use the batch file:
   ```cmd
   python\proteus\test_now.bat
   ```

### Option 3: Use .env File

Create a `.env` file in the project root:
```
PROTEUS_EMAIL=jimmy@8ctanebaseball.com
PROTEUS_PASSWORD=DerekCarr4
PROTEUS_LOCATION=byoungphysicaltherapy
PROTEUS_HEADLESS=false
```

Then run:
```powershell
python python\proteus\main.py
```

## Check Results

After running, check:

1. **Log files:**
   - `python\proteus\logs\proteus_YYYYMMDD.log` - Detailed log
   - `python\proteus\daily_run.log` - Summary log

2. **Database:**
   ```sql
   SELECT COUNT(*) FROM f_proteus;
   SELECT * FROM f_proteus LIMIT 10;
   ```

3. **Files:**
   - Inbox: `D:\Proteus Data\inbox\` (should be empty after processing)
   - Archive: `D:\Proteus Data\archive\` (processed files moved here)

## Troubleshooting

### "Missing environment variables"
- Set them in PowerShell: `$env:PROTEUS_EMAIL = "..."` 
- Or create a `.env` file in project root
- Or they're set in `run_daily.bat` (for scheduled tasks)

### "No CSV files found"
- Place CSV files in `D:\Proteus Data\inbox\`
- Or run the full script to download from portal

### "Login failed"
- Check credentials are correct
- Run with `PROTEUS_HEADLESS=false` to see what's happening
- Check if the portal URL has changed

### "ETL errors"
- Check the detailed log file
- Verify CSV file format matches expected structure
- Check database connection
