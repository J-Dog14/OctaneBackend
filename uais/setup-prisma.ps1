# Prisma Setup Script for Windows PowerShell
# Run this script to set up Prisma for the first time

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Prisma Setup for UAIS" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if Node.js is installed
Write-Host "Checking for Node.js..." -ForegroundColor Yellow
try {
    $nodeVersion = node --version
    Write-Host "✓ Node.js found: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "✗ Node.js not found!" -ForegroundColor Red
    Write-Host "Please install Node.js from https://nodejs.org/" -ForegroundColor Yellow
    exit 1
}

# Check if npm is installed
Write-Host "Checking for npm..." -ForegroundColor Yellow
try {
    $npmVersion = npm --version
    Write-Host "✓ npm found: $npmVersion" -ForegroundColor Green
} catch {
    Write-Host "✗ npm not found!" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Installing dependencies..." -ForegroundColor Yellow
npm install

if ($LASTEXITCODE -ne 0) {
    Write-Host "✗ Failed to install dependencies" -ForegroundColor Red
    exit 1
}

Write-Host "✓ Dependencies installed" -ForegroundColor Green
Write-Host ""

# Check for .env file
if (-not (Test-Path ".env")) {
    Write-Host "Creating .env file from .env.example..." -ForegroundColor Yellow
    if (Test-Path ".env.example") {
        Copy-Item ".env.example" ".env"
        Write-Host "✓ .env file created" -ForegroundColor Green
        Write-Host ""
        Write-Host "⚠ IMPORTANT: Please edit .env and update database credentials!" -ForegroundColor Yellow
    } else {
        Write-Host "✗ .env.example not found" -ForegroundColor Red
    }
} else {
    Write-Host "✓ .env file already exists" -ForegroundColor Green
}

Write-Host ""
Write-Host "Generating Prisma clients..." -ForegroundColor Yellow

# Generate warehouse client
Write-Host "  Generating warehouse client..." -ForegroundColor Cyan
npm run prisma:warehouse:generate

if ($LASTEXITCODE -ne 0) {
    Write-Host "✗ Failed to generate warehouse client" -ForegroundColor Red
    Write-Host "  Make sure WAREHOUSE_DATABASE_URL is set in .env" -ForegroundColor Yellow
} else {
    Write-Host "  ✓ Warehouse client generated" -ForegroundColor Green
}

# Generate app client
Write-Host "  Generating app client..." -ForegroundColor Cyan
npm run prisma:app:generate

if ($LASTEXITCODE -ne 0) {
    Write-Host "✗ Failed to generate app client" -ForegroundColor Red
    Write-Host "  Make sure APP_DATABASE_URL is set in .env" -ForegroundColor Yellow
} else {
    Write-Host "  ✓ App client generated" -ForegroundColor Green
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Setup Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Edit .env with your database credentials" -ForegroundColor White
Write-Host "  2. Run: npm run prisma:warehouse:studio" -ForegroundColor White
Write-Host "     (Opens Prisma Studio to view your database)" -ForegroundColor Gray
Write-Host "  3. Read docs/prisma-setup-guide.md for more info" -ForegroundColor White
Write-Host ""

