@echo off
REM Builds and opens the morning nightly-status page. Run by Task Scheduler ("8ctane Morning Status").
setlocal EnableExtensions
set "PYTHONUTF8=1"
set "ROOT=%~dp0..\..\.."
for %%I in ("%ROOT%") do set "ROOT=%%~fI"
set "PY=%ROOT%\uais\venv\Scripts\python.exe"
if not exist "%ROOT%\uais\data\nightly_status" mkdir "%ROOT%\uais\data\nightly_status"
"%PY%" "%~dp0morning_status.py" --once %* >> "%ROOT%\uais\data\nightly_status\morning_status.log" 2>&1
exit /b %ERRORLEVEL%
