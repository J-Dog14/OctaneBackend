@echo off
REM Daily automated run of mobility assessment processing
REM This script should be scheduled to run daily via Windows Task Scheduler
REM Uses venv python directly (no activation needed) for better Task Scheduler reliability

setlocal EnableExtensions

REM Get absolute path to repo root
set "ROOT=%~dp0\..\.."
for %%I in ("%ROOT%") do set "ROOT=%%~fI"

REM Set log file path
set "LOG=%ROOT%\python\mobility\daily_run.log"

REM Set Python and script paths
set "PY=%ROOT%\venv\Scripts\python.exe"
set "MAIN=%ROOT%\python\mobility\main.py"

REM Log start time
echo %date% %time% - Mobility processing started >> "%LOG%"

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

REM Set environment variable to indicate automated run (skips interactive prompts)
set AUTOMATED_RUN=1

REM Change to repo root and run Python script
REM Redirect both stdout and stderr to log so we see real Python tracebacks
pushd "%ROOT%"
"%PY%" "%MAIN%" >> "%LOG%" 2>&1
set "RC=%ERRORLEVEL%"
popd

REM Log completion time and exit code
if "%RC%"=="0" (
    echo %date% %time% - Mobility processing completed successfully >> "%LOG%"
) else (
    echo %date% %time% - Mobility processing FAILED with error code %RC% >> "%LOG%"
)

exit /b %RC%
