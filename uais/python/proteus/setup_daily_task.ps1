# PowerShell script to set up Windows Task Scheduler for daily Proteus processing
# Run this script as Administrator to set up the daily task

$taskName = "UAIS Proteus Processing"
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

# Create the trigger (daily at 2:30 AM - 30 min after mobility)
$trigger = New-ScheduledTaskTrigger -Daily -At 2:30am

# Create settings
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1)

# Create the principal (S4U logon type allows running when locked)
$principal = New-ScheduledTaskPrincipal `
    -UserId $env:USERNAME `
    -LogonType S4U `
    -RunLevel Highest

# Register the task
try {
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "Daily processing of Proteus data: download CSV from portal and ingest into database"
    Write-Host "[OK] Task scheduled successfully!" -ForegroundColor Green
    Write-Host "Task Name: $taskName" -ForegroundColor Cyan
    Write-Host "Schedule: Daily at 2:30 AM" -ForegroundColor Cyan
    Write-Host "Run When Locked: YES" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "To test the task immediately:" -ForegroundColor Yellow
    Write-Host "  Start-ScheduledTask -TaskName '$taskName'" -ForegroundColor Yellow
} catch {
    Write-Host 'ERROR: Failed to create scheduled task:' -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
