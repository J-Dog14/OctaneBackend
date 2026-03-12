# Lab Computer Setup Guide

This guide helps you set up the private configuration files needed on your lab computer after cloning the repository.

## Private Files to Copy

The following files are in `.gitignore` and need to be manually copied from your main computer to your lab computer:

### 1. Database Configuration
**File:** `config/db_connections.yaml`

**What it contains:**
- Database credentials (passwords, usernames, hosts, ports)
- File paths to raw data directories (these will need to be updated for lab computer)
- Source database paths (legacy databases)

**Setup steps:**
1. Copy `config/db_connections.yaml` from your main computer
2. Update the file paths in the `raw_data_paths` section to match your lab computer's directory structure
3. Update the `source_databases` paths if they differ on the lab computer
4. Database credentials (passwords, usernames) should be the same if databases are shared

**Example paths to update:**
```yaml
raw_data_paths:
  athletic_screen: "D:/Athletic Screen 2.0/Output Files/"  # Update if different drive/path
  mobility: "D:/Mobility Assessments/"  # Update if different drive/path
  pro_sup: "D:/Pro-Sup Test/Data/"  # Update if different drive/path
  proteus: "D:/Proteus Data/"  # Update if different drive/path
```

### 2. Google OAuth Credentials
**File:** `config/client_secret_414564039392-jrmaopurbrsv91gjffc59v8cndv3e58q.apps.googleusercontent.com.json`

**What it contains:**
- Google OAuth 2.0 client secret for accessing Google Sheets/Drive
- Used by the mobility assessment processing to download Google Sheets

**Setup steps:**
1. Copy the entire file from your main computer to `config/` directory on lab computer
2. The filename must match exactly (it's referenced in the code)

### 3. Google OAuth Token (Optional but Recommended)
**File:** `config/token.pickle`

**What it contains:**
- Saved Google OAuth authentication token
- Allows access to Google Sheets without re-authenticating

**Setup steps:**
1. **Option A (Easier):** Copy `config/token.pickle` from your main computer
   - This will allow immediate access without re-authentication
   - Token may expire and need refresh, but usually works across machines

2. **Option B (If token doesn't work):** Delete the token file and let the system regenerate it
   - The first time you run code that needs Google Sheets access, it will open a browser
   - You'll need to authenticate once, then it saves a new token

## How to Transfer Files

### Method 1: USB Drive / External Storage (Most Secure)
1. Copy the three files from your main computer:
   - `config/db_connections.yaml`
   - `config/client_secret_414564039392-jrmaopurbrsv91gjffc59v8cndv3e58q.apps.googleusercontent.com.json`
   - `config/token.pickle` (optional)
2. Transfer to lab computer via USB drive
3. Place files in the `config/` directory of your cloned repository

### Method 2: Secure File Transfer (SSH/SCP)
If both computers are on the same network:
```bash
# From main computer, copy files to lab computer
scp config/db_connections.yaml user@lab-computer:/path/to/UAIS/config/
scp config/client_secret_*.json user@lab-computer:/path/to/UAIS/config/
scp config/token.pickle user@lab-computer:/path/to/UAIS/config/
```

### Method 3: Cloud Storage (Encrypted)
1. Upload files to encrypted cloud storage (OneDrive, Google Drive with encryption, etc.)
2. Download on lab computer
3. Place in `config/` directory
4. **Important:** Delete files from cloud storage after transfer for security

### Method 4: Network Share (If on Same Network)
If both computers can access a shared network drive:
1. Copy files to network share
2. Copy from network share to lab computer
3. Delete from network share after transfer

## Verification Steps

After copying files, verify setup:

1. **Check database connection:**
   ```python
   # Run a simple database test
   python python/common/db_utils.py  # or similar test script
   ```

2. **Check Google OAuth (if using mobility features):**
   ```python
   # The first time you run mobility processing, it should authenticate
   # If token.pickle works, no browser popup needed
   ```

3. **Verify file paths:**
   - Check that all paths in `db_connections.yaml` exist on lab computer
   - Update any paths that differ (different drive letters, etc.)

## Security Notes

⚠️ **Important Security Considerations:**

1. **Never commit these files to git** - They're already in `.gitignore`, but double-check
2. **Use secure transfer methods** - Avoid emailing credentials
3. **Set proper file permissions** (on Linux/Mac):
   ```bash
   chmod 600 config/db_connections.yaml
   chmod 600 config/client_secret_*.json
   chmod 600 config/token.pickle
   ```
4. **Delete temporary copies** - After transfer, delete any temporary copies from USB drives or cloud storage

## Troubleshooting

### Database Connection Issues
- Verify database credentials are correct
- Check if databases are accessible from lab computer (network/firewall)
- Verify PostgreSQL is running if using Postgres

### Google OAuth Issues
- If `token.pickle` doesn't work, delete it and re-authenticate
- Make sure `client_secret_*.json` filename matches exactly
- Check that Google API libraries are installed: `pip install google-auth google-auth-oauthlib google-auth-httplib2 google-api-python-client`

### File Path Issues
- Update all paths in `db_connections.yaml` to match lab computer
- Use forward slashes `/` or double backslashes `\\` in Windows paths
- Verify directories exist before running scripts

## Summary Checklist

- [ ] Copy `config/db_connections.yaml` and update file paths
- [ ] Copy `config/client_secret_*.json` (Google OAuth credentials)
- [ ] Copy `config/token.pickle` (optional, for Google OAuth)
- [ ] Update all file paths in `db_connections.yaml` for lab computer
- [ ] Verify database connections work
- [ ] Test Google OAuth (if using mobility features)
- [ ] Verify all required directories exist on lab computer
- [ ] Delete any temporary copies of sensitive files









