# Registers the two missing pieces of the nightly chain. No admin needed.
#
#   powershell -ExecutionPolicy Bypass -File "C:\Users\Joey\PycharmProjects\OctaneBiomechBackend\uais\python\nightly_status\setup_nightly_tasks.ps1"
#
#   8ctane App DB Sync      daily 3:45 AM  OctaneAiLayer\scripts\run_app_db_sync.bat  (Octane program data snapshot)
#   8ctane Morning Status   daily 7:45 AM  + at sign-in   -> opens the summary page in your browser
#
# Options:  -SyncAt 4:00am   -StatusAt 8:30am
param([string]$SyncAt = "3:45am", [string]$StatusAt = "7:45am")

$backend = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$aiLayer = Join-Path (Split-Path $backend -Parent) "OctaneAiLayer"
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
New-Item -ItemType Directory -Force -Path (Join-Path $backend "uais\data\nightly_status") | Out-Null

function Register-Task($name, $exe, $argText, $workDir, $triggers, $hours, $desc, [switch]$Wake) {
    if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $name -Confirm:$false
    }
    $action = New-ScheduledTaskAction -Execute $exe -Argument $argText -WorkingDirectory $workDir
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
        -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours $hours)
    if ($Wake) { $settings.WakeToRun = $true }
    Register-ScheduledTask -TaskName $name -Action $action -Trigger $triggers -Settings $settings -Principal $principal -Description $desc | Out-Null
    Write-Host "[OK] $name" -ForegroundColor Green
}

# 1) Octane program data (App DB snapshot) - after TrackMan (3:15), before the morning page
$syncBat = Join-Path $aiLayer "scripts\run_app_db_sync.bat"
if (Test-Path $syncBat) {
    $t = New-ScheduledTaskTrigger -Daily -At $SyncAt
    Register-Task "8ctane App DB Sync" "cmd.exe" "/c `"$syncBat`"" $aiLayer $t 2 `
        "Snapshot Octane App DB (users, programs, exercises, workout logs) into the backend's app_db_snapshot schema." -Wake
    Write-Host "     Daily at $SyncAt. Log: $aiLayer\outputs\app_db_sync.log" -ForegroundColor Cyan
} else {
    Write-Host "[SKIP] $syncBat not found" -ForegroundColor Yellow
}

# 2) Morning status pop-up - daily, and at sign-in (it only rebuilds; safe to run any number of times)
$statusBat = Join-Path $PSScriptRoot "run_morning_status.bat"
$daily = New-ScheduledTaskTrigger -Daily -At $StatusAt
$logon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$logon.Delay = "PT2M"
Register-Task "8ctane Morning Status" "cmd.exe" "/c `"$statusBat`"" $backend @($daily, $logon) 1 `
    "Open a one-page summary of last night's Proteus, Mobility, TrackMan, 3D pairing, xArsenal and program-data jobs."
Write-Host "     Daily at $StatusAt and 2 min after sign-in." -ForegroundColor Cyan

Write-Host ""
Write-Host "Test now:  Start-ScheduledTask -TaskName '8ctane Morning Status'" -ForegroundColor Yellow
Write-Host "           Start-ScheduledTask -TaskName '8ctane App DB Sync'" -ForegroundColor Yellow
