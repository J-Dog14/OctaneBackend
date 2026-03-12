#!/bin/bash
# Prisma Setup Script for Linux/Mac
# Run this script to set up Prisma for the first time

echo "========================================"
echo "Prisma Setup for UAIS"
echo "========================================"
echo ""

# Check if Node.js is installed
echo "Checking for Node.js..."
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    echo "✓ Node.js found: $NODE_VERSION"
else
    echo "✗ Node.js not found!"
    echo "Please install Node.js from https://nodejs.org/"
    exit 1
fi

# Check if npm is installed
echo "Checking for npm..."
if command -v npm &> /dev/null; then
    NPM_VERSION=$(npm --version)
    echo "✓ npm found: $NPM_VERSION"
else
    echo "✗ npm not found!"
    exit 1
fi

echo ""
echo "Installing dependencies..."
npm install

if [ $? -ne 0 ]; then
    echo "✗ Failed to install dependencies"
    exit 1
fi

echo "✓ Dependencies installed"
echo ""

# Check for .env file
if [ ! -f ".env" ]; then
    echo "Creating .env file from .env.example..."
    if [ -f ".env.example" ]; then
        cp .env.example .env
        echo "✓ .env file created"
        echo ""
        echo "⚠ IMPORTANT: Please edit .env and update database credentials!"
    else
        echo "✗ .env.example not found"
    fi
else
    echo "✓ .env file already exists"
fi

echo ""
echo "Generating Prisma clients..."

# Generate warehouse client
echo "  Generating warehouse client..."
npm run prisma:warehouse:generate

if [ $? -ne 0 ]; then
    echo "✗ Failed to generate warehouse client"
    echo "  Make sure WAREHOUSE_DATABASE_URL is set in .env"
else
    echo "  ✓ Warehouse client generated"
fi

# Generate app client
echo "  Generating app client..."
npm run prisma:app:generate

if [ $? -ne 0 ]; then
    echo "✗ Failed to generate app client"
    echo "  Make sure APP_DATABASE_URL is set in .env"
else
    echo "  ✓ App client generated"
fi

echo ""
echo "========================================"
echo "Setup Complete!"
echo "========================================"
echo ""
echo "Next steps:"
echo "  1. Edit .env with your database credentials"
echo "  2. Run: npm run prisma:warehouse:studio"
echo "     (Opens Prisma Studio to view your database)"
echo "  3. Read docs/prisma-setup-guide.md for more info"
echo ""

