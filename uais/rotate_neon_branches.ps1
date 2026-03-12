# Run weekly Neon branch rotation: prod -> dev -> backup -> backup 2; optional prod -> prod_alt
# Uses WAREHOUSE_DATABASE_URL as prod; requires _DEV, _BACKUP, _BACKUP2; optional _PROD_ALT in .env
# Usage: .\rotate_neon_branches.ps1
#        .\rotate_neon_branches.ps1 -DryRun

param(
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$scriptPath = Join-Path $PSScriptRoot "python\scripts\rotate_neon_branches.py"

if (-not (Test-Path $scriptPath)) {
    Write-Host "Error: Script not found: $scriptPath" -ForegroundColor Red
    Write-Host "Run this from the project root: C:\Users\Joey\PycharmProjects\UAIS" -ForegroundColor Yellow
    exit 1
}

# Use python from PATH (or py launcher on Windows)
$pythonExe = "python"
try {
    $null = & $pythonExe --version 2>&1
} catch {
    $pythonExe = "py"
    try {
        $null = & $pythonExe --version 2>&1
    } catch {
        Write-Host "Error: Python not found. Install Python or add it to PATH." -ForegroundColor Red
        exit 1
    }
}

$pyArgs = @()
if ($DryRun) {
    $pyArgs += "--dry-run"
}

Write-Host "Neon branch rotation (prod -> dev -> backup -> backup 2)..." -ForegroundColor Cyan
& $pythonExe $scriptPath @pyArgs

if ($LASTEXITCODE -eq 0) {
    Write-Host "Rotation completed successfully." -ForegroundColor Green
} else {
    Write-Host "Rotation failed with exit code: $LASTEXITCODE" -ForegroundColor Red
    exit $LASTEXITCODE
}
