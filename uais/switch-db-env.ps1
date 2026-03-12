# Switch Database Environment Script
# Usage: .\switch-db-env.ps1 -Environment main|dev

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("main", "dev")]
    [string]$Environment
)

$envFile = ".env"

if (-not (Test-Path $envFile)) {
    Write-Host "Error: .env file not found!" -ForegroundColor Red
    Write-Host "Please create a .env file first." -ForegroundColor Yellow
    exit 1
}

# Read current .env file
$lines = Get-Content $envFile
$newLines = @()

foreach ($line in $lines) {
    # Skip empty lines and comments
    if ($line -match '^\s*$' -or $line -match '^\s*#') {
        $newLines += $line
        continue
    }
    
    # Update ENVIRONMENT variable
    if ($line -match '^ENVIRONMENT=') {
        $newLines += "ENVIRONMENT=$Environment"
        continue
    }
    
    # Update APP_DATABASE_URL (active one)
    if ($line -match '^APP_DATABASE_URL=' -and $line -notmatch '_MAIN|_DEV') {
        if ($Environment -eq "main") {
            # Check if we have a main URL defined
            $mainUrl = $lines | Where-Object { $_ -match '^APP_DATABASE_URL_MAIN=' } | ForEach-Object { $_ -replace '^APP_DATABASE_URL_MAIN=', '' }
            if ($mainUrl) {
                $newLines += "APP_DATABASE_URL=$mainUrl"
            } else {
                $newLines += $line  # Keep original if no main URL defined
            }
        } else {
            # Use dev URL
            $devUrl = $lines | Where-Object { $_ -match '^APP_DATABASE_URL_DEV=' } | ForEach-Object { $_ -replace '^APP_DATABASE_URL_DEV=', '' }
            if ($devUrl) {
                $newLines += "APP_DATABASE_URL=$devUrl"
            } else {
                $newLines += $line  # Keep original if no dev URL defined
            }
        }
        continue
    }
    
    # Update WAREHOUSE_DATABASE_URL (active one)
    if ($line -match '^WAREHOUSE_DATABASE_URL=' -and $line -notmatch '_MAIN|_DEV') {
        if ($Environment -eq "main") {
            $mainUrl = $lines | Where-Object { $_ -match '^WAREHOUSE_DATABASE_URL_MAIN=' } | ForEach-Object { $_ -replace '^WAREHOUSE_DATABASE_URL_MAIN=', '' }
            if ($mainUrl) {
                $newLines += "WAREHOUSE_DATABASE_URL=$mainUrl"
            } else {
                $newLines += $line
            }
        } else {
            $devUrl = $lines | Where-Object { $_ -match '^WAREHOUSE_DATABASE_URL_DEV=' } | ForEach-Object { $_ -replace '^WAREHOUSE_DATABASE_URL_DEV=', '' }
            if ($devUrl) {
                $newLines += "WAREHOUSE_DATABASE_URL=$devUrl"
            } else {
                $newLines += $line
            }
        }
        continue
    }
    
    # Keep all other lines as-is
    $newLines += $line
}

# Write updated content
Set-Content -Path $envFile -Value $newLines

Write-Host "✓ Switched to '$Environment' environment" -ForegroundColor Green
Write-Host ""
Write-Host "Current active databases:" -ForegroundColor Cyan
$activeApp = $newLines | Where-Object { $_ -match '^APP_DATABASE_URL=' -and $_ -notmatch '_MAIN|_DEV' } | ForEach-Object { $_ -replace '^APP_DATABASE_URL=', '' }
$activeWarehouse = $newLines | Where-Object { $_ -match '^WAREHOUSE_DATABASE_URL=' -and $_ -notmatch '_MAIN|_DEV' } | ForEach-Object { $_ -replace '^WAREHOUSE_DATABASE_URL=', '' }

if ($activeApp) {
    $appHost = if ($activeApp -match '@([^/]+)') { $matches[1] } else { "unknown" }
    Write-Host "  APP: $appHost" -ForegroundColor Gray
}
if ($activeWarehouse) {
    $warehouseHost = if ($activeWarehouse -match '@([^/]+)') { $matches[1] } else { "unknown" }
    Write-Host "  WAREHOUSE: $warehouseHost" -ForegroundColor Gray
}
