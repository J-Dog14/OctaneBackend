@echo off
REM Quick test script for Proteus processing
cd /d "%~dp0\..\.."
call venv\Scripts\activate.bat

REM Set environment variables
set PROTEUS_EMAIL=jimmy@8ctanebaseball.com
set PROTEUS_PASSWORD=DerekCarr4
set PROTEUS_LOCATION=byoungphysicaltherapy
set PROTEUS_HEADLESS=false

echo ========================================
echo Testing Proteus Processing
echo ========================================
echo.

python python\proteus\quick_test.py

echo.
echo ========================================
echo Test complete - check output above
echo ========================================
pause
