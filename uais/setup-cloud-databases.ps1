# Setup Cloud Databases for UAIS
# This script helps you set up Neon and Vercel databases

Write-Host "UAIS Cloud Database Setup" -ForegroundColor Cyan
Write-Host "=" * 70
Write-Host ""

# Check if .env exists
$envFile = Join-Path $PSScriptRoot ".env"
if (Test-Path $envFile) {
    Write-Host "[OK] .env file found" -ForegroundColor Green
    Write-Host ""
    Write-Host "Your existing .env file will be used." -ForegroundColor Yellow
    Write-Host "You just need to update APP_DATABASE_URL and WAREHOUSE_DATABASE_URL" -ForegroundColor Yellow
    Write-Host "with your cloud connection strings." -ForegroundColor Yellow
} else {
    Write-Host "[WARNING] .env file not found!" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "You should already have a .env file from Prisma setup." -ForegroundColor Yellow
    Write-Host "If you need to create one, copy from config/env.example" -ForegroundColor Yellow
    Write-Host ""
    $create = Read-Host "Create .env from template? (y/n)"
    if ($create -eq 'y') {
        if (Test-Path (Join-Path $PSScriptRoot "config\env.example")) {
            Copy-Item (Join-Path $PSScriptRoot "config\env.example") $envFile
            Write-Host "[OK] .env file created. Please edit it with your connection strings." -ForegroundColor Green
        } else {
            Write-Host "[ERROR] config/env.example not found" -ForegroundColor Red
        }
    }
}

Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. Create Vercel/Prisma Postgres database:" -ForegroundColor White
Write-Host "   - Go to https://vercel.com/dashboard" -ForegroundColor Gray
Write-Host "   - Select your project (or create one)" -ForegroundColor Gray
Write-Host "   - Click 'Storage' tab in left sidebar" -ForegroundColor Gray
Write-Host "   - Click 'Create Database' → Select 'Prisma Postgres'" -ForegroundColor Gray
Write-Host "   - Choose region and plan, name your database" -ForegroundColor Gray
Write-Host "   - After creation, click database → 'Connect' tab" -ForegroundColor Gray
Write-Host "   - Copy POSTGRES_URL or connection string" -ForegroundColor Gray
Write-Host "   - Update APP_DATABASE_URL in your .env file" -ForegroundColor Gray
Write-Host ""
Write-Host "   OR use Neon for app database:" -ForegroundColor White
Write-Host "   - Go to https://neon.tech" -ForegroundColor Gray
Write-Host "   - Create account and new project" -ForegroundColor Gray
Write-Host "   - Copy connection string to APP_DATABASE_URL in .env" -ForegroundColor Gray
Write-Host ""
Write-Host "2. Create Neon database (for warehouse):" -ForegroundColor White
Write-Host "   - Go to https://neon.tech" -ForegroundColor Gray
Write-Host "   - Create new project (or use existing)" -ForegroundColor Gray
Write-Host "   - Copy connection string to WAREHOUSE_DATABASE_URL in .env" -ForegroundColor Gray
Write-Host ""
Write-Host "3. Test connections:" -ForegroundColor White
Write-Host "   python python/scripts/check_database_sizes.py" -ForegroundColor Gray
Write-Host ""
Write-Host "4. Migrate data:" -ForegroundColor White
Write-Host "   python python/scripts/migrate_to_cloud.py --source local --target vercel --db app" -ForegroundColor Gray
Write-Host "   python python/scripts/migrate_to_cloud.py --source local --target neon --db warehouse" -ForegroundColor Gray
Write-Host ""
Write-Host "5. Set up daily backups:" -ForegroundColor White
Write-Host "   See docs/cloud-database-migration-guide.md for details" -ForegroundColor Gray
Write-Host ""

