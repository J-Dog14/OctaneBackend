# Setup Neon Database for UAIS Warehouse
# This script helps you set up Neon and migrate your warehouse database

Write-Host "Neon Database Setup for UAIS" -ForegroundColor Cyan
Write-Host "=" * 70
Write-Host ""

Write-Host "Step 1: Create Neon Account and Project" -ForegroundColor Yellow
Write-Host "  1. Go to https://neon.tech" -ForegroundColor White
Write-Host "  2. Sign up or log in" -ForegroundColor Gray
Write-Host "  3. Click 'Create Project'" -ForegroundColor Gray
Write-Host "  4. Name it (e.g., 'uais-warehouse')" -ForegroundColor Gray
Write-Host "  5. Select region (closest to you)" -ForegroundColor Gray
Write-Host "  6. Click 'Create Project'" -ForegroundColor Gray
Write-Host ""

$continue = Read-Host "Have you created the Neon project? (y/n)"
if ($continue -ne 'y') {
    Write-Host "Please create the Neon project first, then run this script again." -ForegroundColor Yellow
    exit
}

Write-Host ""
Write-Host "Step 2: Get Connection String" -ForegroundColor Yellow
Write-Host "  1. In Neon dashboard, find your project" -ForegroundColor White
Write-Host "  2. Look for 'Connection String' or 'Connection Details'" -ForegroundColor Gray
Write-Host "  3. Copy the connection string (looks like: postgres://user:pass@ep-xxx...)" -ForegroundColor Gray
Write-Host ""

$connString = Read-Host "Paste your Neon connection string here"

if ([string]::IsNullOrWhiteSpace($connString)) {
    Write-Host "[ERROR] Connection string is required!" -ForegroundColor Red
    exit 1
}

# Validate connection string format
if (-not $connString.StartsWith("postgres://")) {
    Write-Host "[WARNING] Connection string doesn't look right. Should start with 'postgres://'" -ForegroundColor Yellow
    $continue = Read-Host "Continue anyway? (y/n)"
    if ($continue -ne 'y') {
        exit
    }
}

# Check if sslmode=require is present
if ($connString -notmatch "sslmode=require") {
    Write-Host "[WARNING] Connection string should include ?sslmode=require" -ForegroundColor Yellow
    if ($connString -match "\?") {
        $connString = $connString + "&sslmode=require"
    } else {
        $connString = $connString + "?sslmode=require"
    }
    Write-Host "Updated connection string to include sslmode=require" -ForegroundColor Green
}

Write-Host ""
Write-Host "Step 3: Backup Local Database" -ForegroundColor Yellow
Write-Host "Backing up local warehouse database before migration..." -ForegroundColor White
Write-Host ""

$backup = Read-Host "Backup local database first? (y/n - recommended: y)"
if ($backup -eq 'y') {
    python python/scripts/backup_databases.py --compress --db warehouse
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[WARNING] Backup had issues, but continuing..." -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "Step 4: Update .env File" -ForegroundColor Yellow
Write-Host "Updating WAREHOUSE_DATABASE_URL in .env file..." -ForegroundColor White

$envFile = Join-Path $PSScriptRoot ".env"
if (-not (Test-Path $envFile)) {
    Write-Host "[ERROR] .env file not found at $envFile" -ForegroundColor Red
    exit 1
}

# Read current .env
$envContent = Get-Content $envFile -Raw

# Check if WAREHOUSE_DATABASE_URL exists
if ($envContent -match "WAREHOUSE_DATABASE_URL\s*=") {
    # Replace existing
    $envContent = $envContent -replace 'WAREHOUSE_DATABASE_URL\s*=.*', "WAREHOUSE_DATABASE_URL=`"$connString`""
    Write-Host "[OK] Updated existing WAREHOUSE_DATABASE_URL" -ForegroundColor Green
} else {
    # Add new
    $envContent = $envContent + "`nWAREHOUSE_DATABASE_URL=`"$connString`""
    Write-Host "[OK] Added WAREHOUSE_DATABASE_URL" -ForegroundColor Green
}

# Write back
Set-Content $envFile $envContent -NoNewline

Write-Host ""
Write-Host "Step 5: Test Connection" -ForegroundColor Yellow
Write-Host "Testing connection to Neon..." -ForegroundColor White
Write-Host ""

python python/scripts/check_database_sizes.py --db warehouse
if ($LASTEXITCODE -eq 0) {
    Write-Host "[OK] Connection successful!" -ForegroundColor Green
} else {
    Write-Host "[ERROR] Connection failed. Check your connection string." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Step 6: Migrate Data" -ForegroundColor Yellow
Write-Host ""
$migrate = Read-Host "Migrate data from local to Neon now? (y/n)"

if ($migrate -eq 'y') {
    Write-Host "Migrating data..." -ForegroundColor White
    Write-Host ""
    
    # Get local connection string from config
    $localConn = "postgresql://postgres:Byoung15!@localhost:5432/uais_warehouse"
    
    python python/scripts/migrate_to_cloud.py --source local --target neon --db warehouse --source-conn $localConn --target-conn $connString
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "[OK] Migration complete!" -ForegroundColor Green
    } else {
        Write-Host ""
        Write-Host "[ERROR] Migration failed. Check the error messages above." -ForegroundColor Red
        Write-Host "You can try manual migration with pg_dump/psql" -ForegroundColor Yellow
    }
} else {
    Write-Host "Skipping migration. You can run it later with:" -ForegroundColor Yellow
    Write-Host "  python python/scripts/migrate_to_cloud.py --source local --target neon --db warehouse --target-conn `"$connString`"" -ForegroundColor Gray
}

Write-Host ""
Write-Host "=" * 70
Write-Host "Setup Complete!" -ForegroundColor Green
Write-Host "=" * 70
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Verify data: python python/scripts/check_database_sizes.py --db warehouse --tables" -ForegroundColor White
Write-Host "  2. Set up backups: python python/scripts/backup_cloud_databases.py --compress" -ForegroundColor White
Write-Host "  3. Test your ETL scripts to make sure they write to Neon" -ForegroundColor White
Write-Host ""

