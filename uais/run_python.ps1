# PowerShell script to activate venv and run Python scripts
# Usage: .\run_python.ps1 python/scripts/init_warehouse_db.py

param(
    [Parameter(Mandatory=$true)]
    [string]$ScriptPath
)

# Create venv if it doesn't exist
if (-not (Test-Path "venv\Scripts\Activate.ps1")) {
    Write-Host "Creating virtual environment..." -ForegroundColor Yellow
    python -m venv venv
    
    Write-Host "Activating venv and installing dependencies..." -ForegroundColor Yellow
    & "venv\Scripts\Activate.ps1"
    pip install -r python/requirements.txt
} else {
    # Activate venv
    & "venv\Scripts\Activate.ps1"
}

# Run the script
Write-Host "Running: $ScriptPath" -ForegroundColor Green
python $ScriptPath

