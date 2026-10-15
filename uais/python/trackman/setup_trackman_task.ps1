# Windows Task Scheduler setup for the TrackMan portal pull. No admin needed.
# Paths are worked out from this file's location, so run it from anywhere:
#
#   $s = "C:\Users\Joey\PycharmProjects\OctaneBiomechBackend\uais\python\trackman\setup_trackman_task.ps1"
#   powershell -ExecutionPolicy Bypass -File $s -Year 2026      # backfill one year, in the background, starting now
#   powershell -ExecutionPolicy Bypass -File $s -Year 2025      # next year (re-registers the backfill task)
#   powershell -ExecutionPolicy Bypass -File $s -Nightly        # daily 3:15 AM pull of new sessions
#   powershell -ExecutionPolicy Bypass -File $s -Nightly -At 4:00am
#
# Tasks run as you while you're signed in to Windows (a locked screen is fine), with no
# browser window, and wake the PC from sleep to start (needs "Allow wake timers" on in
# Power Options). While running, the script keeps the PC from going back to sleep.
# Why not "run whether signed in or not" (like Proteus)? Proteus types a password each
# run; TrackMan reuses the browser's saved sign-in, which Windows only unlocks for a
# signed-in user. After a reboot the task runs as soon as you sign in.
param([switch]$Nightly, [int]$Year = 0, [string]$From = "", [string]$To = "", [string]$At = "3:15am")

$vbs = Join-Path $PSScriptRoot "run_hidden.vbs"   # runs run_nightly.bat with no console window
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

if (-not $Nightly -and $Year -eq 0 -and $From -eq "") {
    Write-Host "Nothing to do. Use -Year 2026 (backfill a year), -From/-To (backfill a range) or -Nightly." -ForegroundColor Yellow
    exit 1
}

function Register-TrackmanTask($name, $argsText, $trigger, $hours, $description) {
    if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $name -Confirm:$false
    }
    $action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$vbs`" $argsText" -WorkingDirectory $root
    $settings = New-ScheduledTaskSettingsSet `
        -WakeToRun `
        -StartWhenAvailable `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -MultipleInstances IgnoreNew `
        -ExecutionTimeLimit (New-TimeSpan -Hours $hours) `
        -RestartCount 2 `
        -RestartInterval (New-TimeSpan -Minutes 15)
    Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description $description | Out-Null
    Write-Host "[OK] $name  ->  run_trackman.py $argsText" -ForegroundColor Green
}

if ($Year -ne 0 -or $From -ne "") {
    if ($Year -ne 0) { $bfArgs = "backfill --year $Year" } else { $bfArgs = "backfill --from $From" + $(if ($To) { " --to $To" } else { "" }) }
    Register-TrackmanTask "UAIS TrackMan Backfill" $bfArgs (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1)) 72 `
        "TrackMan history backfill, month by month (resumable): $bfArgs"
    Start-ScheduledTask -TaskName "UAIS TrackMan Backfill"
    Write-Host "     Started in the background. Progress:" -ForegroundColor Cyan
    Write-Host "       & `"$root\uais\venv\Scripts\python.exe`" `"$root\uais\python\trackman\run_trackman.py`" status" -ForegroundColor Yellow
    Write-Host "       Get-Content `"$root\trackman_out\logs\trackman_$(Get-Date -Format yyyy-MM-dd).log`" -Wait -Tail 30" -ForegroundColor Yellow
    Write-Host "     If it stops (reboot, sign-in expired), run this same command again: it resumes." -ForegroundColor Cyan
}

if ($Nightly) {
    Register-TrackmanTask "UAIS TrackMan Nightly" "nightly" (New-ScheduledTaskTrigger -Daily -At $At) 6 `
        "Pull new TrackMan portal pitching sessions (headless) and load them into the warehouse."
    Write-Host "     Daily at $At (after Mobility 2:00 and Proteus 2:30). Skips a night if a backfill is still running;" -ForegroundColor Cyan
    Write-Host "     the next run reaches back to the last good one, so nothing is missed." -ForegroundColor Cyan
    Write-Host "     Test now: Start-ScheduledTask -TaskName 'UAIS TrackMan Nightly'" -ForegroundColor Yellow
}
