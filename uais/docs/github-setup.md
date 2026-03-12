# GitHub Setup Instructions

## Step 1: Create GitHub Repository

1. Go to https://github.com/new
2. Repository name: `UAIS` (or your preferred name)
3. Description: "Unified Athlete Identity System - Unifying athlete data across systems"
4. Visibility: Choose Private or Public
5. **DO NOT** initialize with README, .gitignore, or license (we already have these)
6. Click "Create repository"

## Step 2: Add Remote and Push

After creating the repository, GitHub will show you commands. Use these:

```bash
cd C:\Users\Joey\PycharmProjects\UAIS

# Add your GitHub repository as remote (replace YOUR_USERNAME with your GitHub username)
git remote add origin https://github.com/YOUR_USERNAME/UAIS.git

# Verify remote was added
git remote -v

# Push to GitHub (main branch)
git push -u origin main
```

## Step 3: Verify

1. Go to your GitHub repository page
2. You should see all files uploaded
3. Default branch should be `main` (not `master`)

## Alternative: Using SSH

If you prefer SSH (and have SSH keys set up):

```bash
git remote add origin git@github.com:YOUR_USERNAME/UAIS.git
git push -u origin main
```

## Future Updates

After making changes:

```bash
git add .
git commit -m "Your commit message"
git push
```

## Notes

- `config/db_connections.yaml` is in `.gitignore` (contains sensitive paths)
- Database files (*.db, *.sqlite) are ignored
- Log files are ignored
- Only code and documentation are tracked

