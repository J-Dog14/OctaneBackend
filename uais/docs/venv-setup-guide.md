# Virtual Environment Setup Guide

## How Virtual Environments Work

**Virtual environments do NOT activate automatically** when you run a Python file. You need to:

1. **Activate the venv first**, then run scripts, OR
2. **Use the venv's Python interpreter directly**, OR  
3. **Configure your IDE** (PyCharm) to use the venv automatically

## Option 1: PyCharm Configuration (Recommended)

PyCharm can automatically use a venv for your project:

### Setup Venv in PyCharm:

1. **Create/Select Venv:**
   - File → Settings → Project → Python Interpreter
   - Click gear icon → "Add..."
   - Select "Virtualenv Environment"
   - Choose "New environment"
   - Location: `C:\Users\Joey\PycharmProjects\UAIS\venv`
   - Base interpreter: Your Python version (e.g., Python 3.11)
   - Click "OK"

2. **Install Dependencies:**
   - In PyCharm's terminal (bottom panel), it should auto-activate venv
   - Or manually activate:
     ```powershell
     .\venv\Scripts\Activate.ps1
     ```
   - Install requirements:
     ```powershell
     pip install -r python/requirements.txt
     ```

3. **Run Scripts:**
   - Right-click any `.py` file → "Run"
   - PyCharm will use the venv automatically
   - Or use terminal: scripts will use venv if activated

### Verify Venv is Active:

In PyCharm terminal, you should see `(venv)` prefix:
```powershell
(venv) PS C:\Users\Joey\PycharmProjects\UAIS>
```

## Option 2: Manual Activation (Terminal)

If running scripts from terminal outside PyCharm:

### PowerShell:
```powershell
cd C:\Users\Joey\PycharmProjects\UAIS
.\venv\Scripts\Activate.ps1
python python/scripts/init_warehouse_db.py
```

### Command Prompt:
```cmd
cd C:\Users\Joey\PycharmProjects\UAIS
venv\Scripts\activate.bat
python python/scripts/init_warehouse_db.py
```

## Option 3: Use Venv Python Directly (No Activation Needed)

You can run scripts using the venv's Python directly:

```powershell
.\venv\Scripts\python.exe python/scripts/init_warehouse_db.py
```

## Check if Venv is Active

Look for `(venv)` in your terminal prompt:
```powershell
# Active venv:
(venv) PS C:\Users\Joey\PycharmProjects\UAIS>

# Not active:
PS C:\Users\Joey\PycharmProjects\UAIS>
```

## Troubleshooting

### "Module not found" errors:
- Venv not activated or not configured in PyCharm
- Dependencies not installed: `pip install -r python/requirements.txt`

### PyCharm not using venv:
- Check Settings → Project → Python Interpreter
- Make sure venv interpreter is selected
- Restart PyCharm if needed

### PowerShell execution policy error:
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

## Quick Setup Script

Run this once to set up venv:

```powershell
# Create venv
python -m venv venv

# Activate venv
.\venv\Scripts\Activate.ps1

# Install dependencies
pip install -r python/requirements.txt
```

## Summary

- **PyCharm:** Configure venv in Settings → Python Interpreter, then run scripts normally
- **Terminal:** Activate venv first (`.\venv\Scripts\Activate.ps1`), then run scripts
- **Direct:** Use `.\venv\Scripts\python.exe script.py` (no activation needed)

**The venv will NOT auto-activate** - you need to configure it in PyCharm or activate it manually!

