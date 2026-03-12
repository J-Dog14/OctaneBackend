# PowerShell script to set up Windows Task Scheduler for daily mobility processing
# Run this script as Administrator to set up the daily task

$taskName = "UAIS Mobility Assessment Processing"
$scriptPath = Join-Path $PSScriptRoot "run_daily.bat"
$workingDir = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent

# Check if running as administrator
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "ERROR: This script must be run as Administrator" -ForegroundColor Red
    Write-Host "Right-click PowerShell and select 'Run as Administrator'" -ForegroundColor Yellow
    exit 1
}

# Remove existing task if it exists
$existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existingTask) {
    Write-Host "Removing existing task..." -ForegroundColor Yellow
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

# Create the action (run the batch file via cmd.exe for more reliable execution)
# Using cmd.exe /c ensures proper quoting and environment handling in Task Scheduler
$action = New-ScheduledTaskAction `
    -Execute "cmd.exe" `
    -Argument "/c `"$scriptPath`"" `
    -WorkingDirectory $workingDir

# Create the trigger (daily at 2 AM)
$trigger = New-ScheduledTaskTrigger -Daily -At 2am

# Create settings
# Key settings for running when locked:
# - AllowStartIfOnBatteries: Run even on battery power
# - DontStopIfGoingOnBatteries: Don't stop if unplugged
# - StartWhenAvailable: Start even if start time was missed
# - RunOnlyIfNetworkAvailable: Optional - only run if network is available
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1)

# Create the principal
# IMPORTANT: Use "ServiceAccount" or "S4U" logon type to run when locked
# "Interactive" requires user to be logged in
# "S4U" (Service for User) allows running when locked but uses user's credentials
$principal = New-ScheduledTaskPrincipal `
    -UserId $env:USERNAME `
    -LogonType S4U `
    -RunLevel Highest

# Register the task
try {
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "Daily processing of mobility assessment files from Google Drive"
    Write-Host "[OK] Task scheduled successfully!" -ForegroundColor Green
    Write-Host "Task Name: $taskName" -ForegroundColor Cyan
    Write-Host "Schedule: Daily at 2:00 AM" -ForegroundColor Cyan
    Write-Host "Run When Locked: YES (configured with S4U logon)" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "IMPORTANT: This task will run even when:" -ForegroundColor Yellow
    Write-Host "  - Your computer is locked" -ForegroundColor Yellow
    Write-Host "  - You are logged out" -ForegroundColor Yellow
    Write-Host "  - The computer is sleeping (if wake timers are enabled)" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "To view or modify the task:" -ForegroundColor Yellow
    Write-Host "  - Open Task Scheduler (taskschd.msc)" -ForegroundColor Yellow
    Write-Host "  - Look for '$taskName' in the task list" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "To test the task immediately:" -ForegroundColor Yellow
    Write-Host "  Start-ScheduledTask -TaskName '$taskName'" -ForegroundColor Yellow
    Write-Host ""
    Write-Host 'Note: If the task fails to run when locked, check:' -ForegroundColor Yellow
    Write-Host '  1. Task Scheduler -> Task -> Properties -> General' -ForegroundColor Yellow
    Write-Host '     - Run whether user is logged on or not should be checked' -ForegroundColor Yellow
    Write-Host '  2. Task Scheduler -> Task -> Properties -> Conditions' -ForegroundColor Yellow
    Write-Host '     - Wake the computer to run this task (optional, for sleep mode)' -ForegroundColor Yellow
} catch {
    Write-Host 'ERROR: Failed to create scheduled task:' -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
