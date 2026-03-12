# Mobility Processing Logs

## Log Files Location

Logs are stored in: `python/mobility/logs/`

### Daily Log Files
- Format: `mobility_YYYYMMDD.log` (one file per day)
- Contains: Detailed processing information, errors, and results
- Example: `mobility_20250115.log`

### Summary Log File
- File: `python/mobility/daily_run.log`
- Contains: Simple timestamps of when processing started/completed
- Format: `YYYY-MM-DD HH:MM:SS - Mobility processing started/completed`

## Viewing Logs

### Check if script ran today:
```powershell
# View today's detailed log
Get-Content python\mobility\logs\mobility_$(Get-Date -Format 'yyyyMMdd').log

# View summary log (last 10 entries)
Get-Content python\mobility\daily_run.log -Tail 10
```

### Check last run status:
```powershell
# Last entry in summary log
Get-Content python\mobility\daily_run.log -Tail 1
```

## Log Contents

The detailed log files include:
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
   - Database connection errors
   - Missing files
   - Data parsing errors
