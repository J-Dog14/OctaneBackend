# GitHub Push Instructions

## Step 1: Create Repository on GitHub

1. Go to https://github.com/new
2. Repository name: `UAIS` (or your preferred name)
3. Description: "Unified Athlete Identity System"
4. Choose Private or Public
5. **DO NOT** check "Initialize with README" (we already have files)
6. Click "Create repository"

## Step 2: Copy the Repository URL

After creating, GitHub will show you a page with setup instructions. You'll see a URL like:

**HTTPS:**
```
https://github.com/YOUR_USERNAME/UAIS.git
```

**OR SSH (if you have SSH keys set up):**
```
git@github.com:YOUR_USERNAME/UAIS.git
```

## Step 3: Add Remote and Push

Once you have the URL, run these commands in PowerShell:

```powershell
# Make sure you're in the project directory
cd C:\Users\Joey\PycharmProjects\UAIS

# Add the GitHub repository as remote (paste your URL here)
git remote add origin https://github.com/YOUR_USERNAME/UAIS.git

# Verify it was added correctly
git remote -v

# Push your code to GitHub
git push -u origin main
```

## What You'll See

After `git push -u origin main`, you should see:
- Uploading files
- "Writing objects" progress
- "To https://github.com/..." confirmation

Then refresh your GitHub repository page and you'll see all your files!

## Troubleshooting

**"remote origin already exists"**
- Run: `git remote remove origin`
- Then add it again with the correct URL

**"Authentication failed"**
- GitHub may prompt for username/password
- Or use a Personal Access Token instead of password
- Or set up SSH keys for easier authentication

**"Branch 'main' has no upstream branch"**
- The `-u` flag in `git push -u origin main` sets this up
- After first push, you can just use `git push`

