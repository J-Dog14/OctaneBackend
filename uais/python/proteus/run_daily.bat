@echo off
REM Daily automated run of Proteus processing
REM This script should be scheduled to run daily via Windows Task Scheduler
REM Uses venv python directly (no activation needed) for better Task Scheduler reliability

setlocal EnableExtensions

REM Get absolute path to repo root
set "ROOT=%~dp0\..\.."
for %%I in ("%ROOT%") do set "ROOT=%%~fI"

REM Set log file path
set "LOG=%ROOT%\python\proteus\daily_run.log"

REM Set Python and script paths
set "PY=%ROOT%\venv\Scripts\python.exe"
set "MAIN=%ROOT%\python\proteus\main.py"

REM Set environment variables (if not already set)
if not defined PROTEUS_EMAIL set PROTEUS_EMAIL=jimmy@8ctanebaseball.com
if not defined PROTEUS_PASSWORD set PROTEUS_PASSWORD=DerekCarr4
if not defined PROTEUS_LOCATION set PROTEUS_LOCATION=byoungphysicaltherapy

REM Log start time
echo %date% %time% - Proteus processing started >> "%LOG%"

REM Check if venv python exists
if not exist "%PY%" (
    echo %date% %time% - FAILED: venv python not found at "%PY%" >> "%LOG%"
    exit /b 2
)

REM Check if main.py exists
if not exist "%MAIN%" (
    echo %date% %time% - FAILED: main.py not found at "%MAIN%" >> "%LOG%"
    exit /b 3
)

REM Set environment variables for automated run
set AUTOMATED_RUN=1
set PROTEUS_HEADLESS=true

REM Change to repo root and run Python script
REM Redirect both stdout and stderr to log so we see real Python tracebacks
pushd "%ROOT%"
"%PY%" "%MAIN%" >> "%LOG%" 2>&1
set "RC=%ERRORLEVEL%"
popd

REM Log completion time and exit code
if "%RC%"=="0" (
    echo %date% %time% - Proteus processing completed successfully >> "%LOG%"
) else (
    echo %date% %time% - Proteus processing FAILED with error code %RC% >> "%LOG%"
)

exit /b %RC%
