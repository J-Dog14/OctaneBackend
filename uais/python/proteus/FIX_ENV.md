# Fixing .env File Issues

## The Problem

The log shows "✓ Loaded environment variables from .env" but then says the variables are missing. This means the `.env` file format is incorrect.

## Common Issues and Fixes

### Issue 1: Spaces Around = Sign

**Wrong:**
```
PROTEUS_EMAIL = jimmy@8ctanebaseball.com
PROTEUS_PASSWORD = DerekCarr4
```

**Correct:**
```
PROTEUS_EMAIL=jimmy@8ctanebaseball.com
PROTEUS_PASSWORD=DerekCarr4
```

### Issue 2: Quotes Around Values

**Wrong:**
```
PROTEUS_EMAIL="jimmy@8ctanebaseball.com"
PROTEUS_PASSWORD="DerekCarr4"
```

**Correct:**
```
PROTEUS_EMAIL=jimmy@8ctanebaseball.com
PROTEUS_PASSWORD=DerekCarr4
```

### Issue 3: BOM (Byte Order Mark)

If your file was saved with a BOM, it won't work. Re-save the file as UTF-8 without BOM.

### Issue 4: Extra Whitespace

**Wrong:**
```
 PROTEUS_EMAIL=jimmy@8ctanebaseball.com
PROTEUS_PASSWORD =DerekCarr4
```

**Correct:**
```
PROTEUS_EMAIL=jimmy@8ctanebaseball.com
PROTEUS_PASSWORD=DerekCarr4
```

## How to Fix

1. **Open your `.env` file** in a text editor (Notepad++, VS Code, etc.)

2. **Make sure it looks exactly like this** (no spaces, no quotes):
   ```
   PROTEUS_EMAIL=jimmy@8ctanebaseball.com
   PROTEUS_PASSWORD=DerekCarr4
   PROTEUS_LOCATION=byoungphysicaltherapy
   ```

3. **Save the file** as UTF-8 (without BOM if your editor asks)

4. **Run the debug script** to verify:
   ```powershell
   python python\proteus\debug_env.py
   ```

5. **If it still doesn't work**, try recreating the file:
   - Delete the existing `.env` file
   - Create a new one with the exact format above
   - Make sure there are no blank lines at the top
   - Make sure each line ends with a newline (no trailing spaces)

## Quick Test

After fixing, run:
```powershell
python python\proteus\main.py
```

You should see in the log:
```
✓ Loaded environment variables from C:\Users\Joey\PycharmProjects\UAIS\.env
  PROTEUS_EMAIL: jimmy@8ctanebaseball.com
  PROTEUS_PASSWORD: ******** (set)
```

## Alternative: Use Environment Variables Directly

If the .env file keeps causing issues, you can set the variables directly in PowerShell:

```powershell
$env:PROTEUS_EMAIL = "jimmy@8ctanebaseball.com"
$env:PROTEUS_PASSWORD = "DerekCarr4"
$env:PROTEUS_LOCATION = "byoungphysicaltherapy"
python python\proteus\main.py
```
