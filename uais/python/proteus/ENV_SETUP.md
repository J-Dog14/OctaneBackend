# Setting Environment Variables for Proteus

You have several options for setting environment variables. Choose the one that works best for you.

## Option 1: .env File (Recommended - Easiest)

Create a `.env` file in the project root (`C:\Users\Joey\PycharmProjects\UAIS\.env`):

```env
PROTEUS_EMAIL=jimmy@8ctanebaseball.com
PROTEUS_PASSWORD=DerekCarr4
PROTEUS_LOCATION=byoungphysicaltherapy
```

**Note**: You need to install `python-dotenv` first:
```bash
pip install python-dotenv
```

The script will automatically load variables from this file.

## Option 2: Windows System Environment Variables (Permanent)

Set them permanently in Windows:

1. **Open System Properties**:
   - Press `Win + X` → System
   - Or: Right-click "This PC" → Properties → Advanced system settings

2. **Go to Environment Variables**:
   - Click "Environment Variables" button
   - Under "User variables" (or "System variables"), click "New"

3. **Add each variable**:
   - Variable name: `PROTEUS_EMAIL`
   - Variable value: `jimmy@8ctanebaseball.com`
   - Click OK
   - Repeat for `PROTEUS_PASSWORD` and `PROTEUS_LOCATION`

4. **Restart your terminal/IDE** for changes to take effect

## Option 3: PowerShell (Temporary - Current Session Only)

```powershell
$env:PROTEUS_EMAIL="jimmy@8ctanebaseball.com"
$env:PROTEUS_PASSWORD="DerekCarr4"
$env:PROTEUS_LOCATION="byoungphysicaltherapy"
```

## Option 4: Command Prompt (Temporary - Current Session Only)

```cmd
set PROTEUS_EMAIL=jimmy@8ctanebaseball.com
set PROTEUS_PASSWORD=DerekCarr4
set PROTEUS_LOCATION=byoungphysicaltherapy
```

## Option 5: Batch File (Already Configured)

The `run_daily.bat` file already has the credentials as fallbacks, so if you don't set environment variables, it will use those values. However, for security, it's better to use one of the options above.

## For Scheduled Tasks

When running via Windows Task Scheduler, the batch file (`run_daily.bat`) sets the variables automatically, so you don't need to do anything extra.

## Recommended Approach

**For development/testing**: Use Option 1 (.env file) - it's easy and keeps credentials out of code

**For production/automation**: The batch file already has fallbacks, but you can also use Option 2 (System Environment Variables) for better security

## Verify Your Settings

To check if variables are set:

**PowerShell**:
```powershell
$env:PROTEUS_EMAIL
$env:PROTEUS_PASSWORD
```

**Command Prompt**:
```cmd
echo %PROTEUS_EMAIL%
echo %PROTEUS_PASSWORD%
```

**Python**:
```python
import os
print(os.getenv('PROTEUS_EMAIL'))
```
