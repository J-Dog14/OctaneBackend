# Automated Daily Processing Setup

This guide explains how to set up automatic daily processing of mobility assessment files.

## Overview

The script will:
1. Download any new Google Sheets from Google Drive
2. Process only new Excel files (skips already processed files)
3. Run automatically every day at 2:00 AM

## Setup Instructions

### Option 1: PowerShell Script (Recommended)

1. **Open PowerShell as Administrator**
   - Right-click on PowerShell
   - Select "Run as Administrator"

2. **Navigate to the project directory**
   ```powershell
   cd C:\Users\Joey\PycharmProjects\UAIS\python\mobility
   ```

3. **Run the setup script**
   ```powershell
   .\setup_daily_task.ps1
   ```

4. **Verify the task was created**
   - Open Task Scheduler (`taskschd.msc`)
   - Look for "UAIS Mobility Assessment Processing"
   - The task will run daily at 2:00 AM

### Option 2: Manual Task Scheduler Setup

1. **Open Task Scheduler**
   - Press `Win + R`
   - Type `taskschd.msc` and press Enter

2. **Create Basic Task**
   - Click "Create Basic Task" in the right panel
   - Name: `UAIS Mobility Assessment Processing`
   - Description: `Daily processing of mobility assessment files`

3. **Set Trigger**
   - Trigger: Daily
   - Start: Choose a time (e.g., 2:00 AM)
   - Recur every: 1 days

4. **Set Action**
   - Action: Start a program
   - Program/script: `C:\Users\Joey\PycharmProjects\UAIS\python\mobility\run_daily.bat`
   - Start in: `C:\Users\Joey\PycharmProjects\UAIS`

5. **Finish**
   - Check "Open the Properties dialog for this task"
   - Click Finish

6. **Configure Settings**
   - In Properties, go to "General" tab
   - **IMPORTANT**: Check "Run whether user is logged on or not" (required for locked computer)
   - Check "Run with highest privileges" (if needed)
   - Go to "Conditions" tab
   - Check "Wake the computer to run this task" (optional - allows running from sleep)
   - Uncheck "Start the task only if the computer is on AC power" (if you want it to run on battery)
   - Go to "Settings" tab
   - Check "Allow task to be run on demand"
   - Check "Run task as soon as possible after a scheduled start is missed"
   - Check "If the task fails, restart every: 1 minute" (up to 3 times)

## Testing

### Test the batch file manually:
```cmd
cd C:\Users\Joey\PycharmProjects\UAIS
venv\Scripts\activate.bat
python python\mobility\main.py
```

### Test the scheduled task:
```powershell
Start-ScheduledTask -TaskName "UAIS Mobility Assessment Processing"
```

## Running When Computer is Locked

**YES, the task can run when your computer is locked!**

### Requirements:
1. **Task must be configured to "Run whether user is logged on or not"**
   - This is set automatically by the setup script
   - If setting up manually, this is critical

2. **Computer must be ON (not shut down)**
   - The task will NOT run if the computer is completely off
   - It WILL run if the computer is:
     - Locked (Windows + L)
     - Logged out
     - Sleeping (if wake timers are enabled)

3. **Power Settings**
   - For laptops: Task will run on battery power (configured)
   - For sleep mode: Enable "Wake the computer to run this task" in Conditions tab

### What Happens:
- Task runs in the background
- No user interaction required
- No need to unlock the computer
- Script output goes to log files

### Limitations:
- Computer must be powered on (not shut down)
- If computer is in hibernate mode, it may not wake (depends on BIOS settings)
- Network must be available (for Google Drive API and database access)

## Monitoring

- **Log file**: `python\mobility\daily_run.log` - Contains timestamps of each run
- **Task Scheduler**: View task history in Task Scheduler
- **Console output**: Check the script output for processing details

## Troubleshooting

### Task doesn't run
1. Check Task Scheduler for error messages
2. Verify the batch file path is correct
3. Ensure Python and virtual environment are accessible
4. Check that the user account has permissions

### Script errors
1. Check `daily_run.log` for timestamps
2. Run the script manually to see error messages
3. Verify Google API credentials are valid
4. Check database connection settings

### Files not processing
1. Verify files are in `D:\Mobility Assessments\`
2. Check that files haven't already been processed (tracked by `source_file` column)
3. Review error messages in the console output

## Modifying the Schedule

To change when the task runs:

1. Open Task Scheduler
2. Find "UAIS Mobility Assessment Processing"
3. Right-click → Properties
4. Go to "Triggers" tab
5. Edit the trigger to change the time/frequency

## Disabling/Removing

To temporarily disable:
- Task Scheduler → Right-click task → Disable

To remove completely:
```powershell
Unregister-ScheduledTask -TaskName "UAIS Mobility Assessment Processing" -Confirm:$false
```
