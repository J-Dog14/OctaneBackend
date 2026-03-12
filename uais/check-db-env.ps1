# Check Current Database Environment
# Usage: .\check-db-env.ps1

$envFile = ".env"

if (-not (Test-Path $envFile)) {
    Write-Host "Error: .env file not found!" -ForegroundColor Red
    exit 1
}

# Load .env file
$lines = Get-Content $envFile

# Find environment
$environment = $lines | Where-Object { $_ -match '^ENVIRONMENT=' } | ForEach-Object { $_ -replace '^ENVIRONMENT=', '' } | Select-Object -First 1

# Find active URLs
$appUrl = $lines | Where-Object { $_ -match '^APP_DATABASE_URL=' -and $_ -notmatch '_MAIN|_DEV' } | ForEach-Object { $_ -replace '^APP_DATABASE_URL=', '' } | Select-Object -First 1
$warehouseUrl = $lines | Where-Object { $_ -match '^WAREHOUSE_DATABASE_URL=' -and $_ -notmatch '_MAIN|_DEV' } | ForEach-Object { $_ -replace '^WAREHOUSE_DATABASE_URL=', '' } | Select-Object -First 1

Write-Host "Current Database Environment" -ForegroundColor Cyan
Write-Host "============================" -ForegroundColor Cyan
Write-Host ""

if ($environment) {
    Write-Host "Environment: " -NoNewline
    Write-Host $environment -ForegroundColor $(if ($environment -eq "main") { "Red" } else { "Yellow" })
} else {
    Write-Host "Environment: " -NoNewline
    Write-Host "not set" -ForegroundColor Gray
}

Write-Host ""

if ($appUrl) {
    $appHost = if ($appUrl -match '@([^/]+)') { $matches[1] } else { "unknown" }
    Write-Host "APP Database: " -NoNewline
    Write-Host $appHost -ForegroundColor Gray
} else {
    Write-Host "APP Database: " -NoNewline
    Write-Host "not configured" -ForegroundColor Gray
}

if ($warehouseUrl) {
    $warehouseHost = if ($warehouseUrl -match '@([^/]+)') { $matches[1] } else { "unknown" }
    Write-Host "WAREHOUSE Database: " -NoNewline
    Write-Host $warehouseHost -ForegroundColor Gray
} else {
    Write-Host "WAREHOUSE Database: " -NoNewline
    Write-Host "not configured" -ForegroundColor Gray
}

Write-Host ""
