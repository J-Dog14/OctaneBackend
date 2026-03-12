@echo off
REM Quick script to activate venv and run Python scripts
REM Usage: run_python.bat python/scripts/init_warehouse_db.py

if not exist "venv\Scripts\activate.bat" (
    echo Creating virtual environment...
    python -m venv venv
    echo Installing dependencies...
    call venv\Scripts\activate.bat
    pip install -r python/requirements.txt
) else (
    call venv\Scripts\activate.bat
)

REM Run the script passed as argument
python %*

