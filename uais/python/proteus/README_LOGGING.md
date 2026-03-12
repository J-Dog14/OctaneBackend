# Proteus Processing Logs

## Log Files Location

Logs are stored in: `python/proteus/logs/`

### Daily Log Files
- Format: `proteus_YYYYMMDD.log` (one file per day)
- Contains: Detailed processing information including:
  - Browser automation steps
  - Login status
  - CSV download status
  - ETL processing details
  - Errors and warnings
- Example: `proteus_20250115.log`

### Summary Log File
- File: `python/proteus/daily_run.log`
- Contains: Simple timestamps of when processing started/completed
- Format: `YYYY-MM-DD HH:MM:SS - Proteus processing started/completed`

## Viewing Logs

### Check if script ran today:
```powershell
# View today's detailed log
Get-Content python\proteus\logs\proteus_$(Get-Date -Format 'yyyyMMdd').log

# View summary log (last 10 entries)
Get-Content python\proteus\daily_run.log -Tail 10
```

### Check last run status:
```powershell
# Last entry in summary log
Get-Content python\proteus\daily_run.log -Tail 1
```

## Log Contents

The detailed log files include:
- Browser launch and login status
- CSV download progress
- Files processed
- Athletes created/updated
- Records inserted/updated
- Any errors encountered
- Processing summary

## Troubleshooting

If you see "FAILED" in `daily_run.log`:
1. Check the detailed log file for that date
2. Look for error messages
3. Common issues:
   - Login failures (check credentials)
   - Browser automation errors
   - CSV download failures
   - Database connection errors
   - Data parsing errors

## Task Scheduler Logs

You can also check Windows Task Scheduler:
1. Open Task Scheduler (`taskschd.msc`)
2. Find "UAIS Proteus Processing"
3. Right-click → History
4. View task execution history and errors
