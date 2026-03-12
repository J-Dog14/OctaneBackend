# PowerShell wrapper for database backup script
# This makes it easy to run backups and schedule them with Windows Task Scheduler

param(
    [switch]$Compress,
    [int]$Keep = 0,
    [string]$OutputDir = ""
)

$scriptPath = Join-Path $PSScriptRoot "python\scripts\backup_databases.py"
$pythonExe = "python"

# Check if Python is available
try {
    $pythonVersion = & $pythonExe --version 2>&1
    Write-Host "Using Python: $pythonVersion" -ForegroundColor Green
} catch {
    Write-Host "Error: Python not found. Please install Python or add it to PATH." -ForegroundColor Red
    exit 1
}

# Build command arguments
$args = @()
if ($Compress) {
    $args += "--compress"
}
if ($Keep -gt 0) {
    $args += "--keep"
    $args += $Keep.ToString()
}
if ($OutputDir) {
    $args += "--output-dir"
    $args += $OutputDir
}

# Run backup script
Write-Host "Starting database backup..." -ForegroundColor Cyan
Write-Host "Command: $pythonExe $scriptPath $($args -join ' ')" -ForegroundColor Gray
Write-Host ""

& $pythonExe $scriptPath $args

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "Backup completed successfully!" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "Backup failed with exit code: $LASTEXITCODE" -ForegroundColor Red
    exit $LASTEXITCODE
}



