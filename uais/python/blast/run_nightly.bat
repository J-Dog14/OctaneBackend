@echo off
REM Blast Motion nightly: pull the team-portal CSV, then load it. Run by Windows Task Scheduler
REM on the ThinkPad (same layout as trackman\run_nightly.bat).
REM   run_nightly.bat            -> pull yesterday..today, load every new CSV in blast_out\, re-attribute last 14 days
REM   run_nightly.bat --report   -> just list swings that have no hitter
REM One-time: uais\venv\Scripts\python.exe uais\python\blast\blast_pull.py --login   (sign in as Bobby)
REM Full log: blast_out\logs\task_console.log. Expired sign-in -> blast_out\NEEDS_LOGIN.txt
setlocal EnableExtensions
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"

REM repo root = three levels up from uais\python\blast
set "ROOT=%~dp0..\..\.."
for %%I in ("%ROOT%") do set "ROOT=%%~fI"
set "PY=%ROOT%\uais\venv\Scripts\python.exe"

if not exist "%ROOT%\blast_out\logs" mkdir "%ROOT%\blast_out\logs"
set "CONSOLE=%ROOT%\blast_out\logs\task_console.log"

if not exist "%PY%" (
    echo %date% %time% - FAILED: venv python not found at "%PY%" >> "%CONSOLE%"
    exit /b 9
)

pushd "%ROOT%"
if /I "%~1"=="--report" (
    "%PY%" -u "%ROOT%\uais\python\blast\load_blast_csv.py" --report
    popd
    exit /b %ERRORLEVEL%
)

echo %date% %time% - Blast pull started >> "%CONSOLE%"
"%PY%" -u "%ROOT%\uais\python\blast\blast_pull.py" --days 2 --headless >> "%CONSOLE%" 2>&1
set "PULL_RC=%ERRORLEVEL%"
echo %date% %time% - Blast pull finished, exit code %PULL_RC% >> "%CONSOLE%"

REM Load even if the pull failed: earlier files still get loaded and the last 14 days re-attributed
REM (picks up assignment fixes made in the coach portal).
echo %date% %time% - Blast load started >> "%CONSOLE%"
"%PY%" -u "%ROOT%\uais\python\blast\load_blast_csv.py" --dir "%ROOT%\blast_out" --move-loaded >> "%CONSOLE%" 2>&1
set "RC=%ERRORLEVEL%"
echo %date% %time% - Blast load finished, exit code %RC% >> "%CONSOLE%"
popd
if not "%PULL_RC%"=="0" exit /b %PULL_RC%
exit /b %RC%
