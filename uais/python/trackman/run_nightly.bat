@echo off
REM TrackMan portal pull + warehouse load, run by Windows Task Scheduler.
REM   run_nightly.bat                      -> run_trackman.py nightly
REM   run_nightly.bat backfill --year 2025 -> run_trackman.py backfill --year 2025
REM Paths are worked out from this file's location, so it runs from anywhere.
REM Full log: trackman_out\logs\trackman_YYYY-MM-DD.log
setlocal EnableExtensions
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"

REM repo root = three levels up from uais\python\trackman
set "ROOT=%~dp0..\..\.."
for %%I in ("%ROOT%") do set "ROOT=%%~fI"
set "PY=%ROOT%\uais\venv\Scripts\python.exe"
set "ARGS=%*"
if "%~1"=="" set "ARGS=nightly"

if not exist "%ROOT%\trackman_out\logs" mkdir "%ROOT%\trackman_out\logs"
set "CONSOLE=%ROOT%\trackman_out\logs\task_console.log"

if not exist "%PY%" (
    echo %date% %time% - FAILED: venv python not found at "%PY%" >> "%CONSOLE%"
    exit /b 9
)

pushd "%ROOT%"
echo %date% %time% - TrackMan %ARGS% started >> "%CONSOLE%"
"%PY%" -u "%ROOT%\uais\python\trackman\run_trackman.py" %ARGS% >> "%CONSOLE%" 2>&1
set "RC=%ERRORLEVEL%"
echo %date% %time% - TrackMan %ARGS% finished, exit code %RC% >> "%CONSOLE%"
popd
exit /b %RC%
