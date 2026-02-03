# 🚀 Dynamic Version Management System

## Overview

The BoostMon project now has a **fully automated, dynamic version management system** that eliminates the need to manually update version numbers. Versions are incremented automatically and tracked in `version.json`.

---

## 📁 System Files

### Core Files
- **`version.json`** - Central version source of truth
  ```json
  {
    "major": 2,
    "minor": 1,
    "patch": 4,
    "version": "2.1.4",
    "lastUpdated": "2026-02-03T00:00:00Z",
    "description": "Description of changes"
  }
  ```

- **`scripts/version-bump.js`** - Version bumping utility script

- **`.githooks/pre-commit`** - Automatic version bumping on every commit

### Integration Points
- **`app.js`** - Loads version.json on startup and serves via API
- **`public/dashboard.html`** - Fetches version dynamically from API
- **`package.json`** - Contains npm scripts for manual version management

---

## 🎯 How It Works

### Automatic (Git Hook)
1. **Before each commit**, the `.githooks/pre-commit` hook runs
2. **Automatically bumps** the patch version (e.g., 2.1.3 → 2.1.4)
3. **Updates** `version.json` with timestamp
4. **Stages** the updated file in git
5. **Continues** with your commit

**You don't need to do anything!** Just commit normally:
```bash
git commit -m "Your commit message"
# Version auto-bumps to next patch version
```

### Manual (NPM Scripts)
If you want manual control, use these commands:

```bash
# Bump patch version: 2.1.4 → 2.1.5
npm run bump-patch

# Bump minor version: 2.1.4 → 2.2.0
npm run bump-minor

# Bump major version: 2.1.4 → 3.0.0
npm run bump-major
```

---

## 🔄 Version Propagation

### Backend
- `app.js` loads `version.json` on startup
- Exposes `/api/version` endpoint

### Frontend
- `dashboard.html` fetches version from `/api/version` on page load
- Displays in footer as "BoostMon Dashboard • v2.1.4"
- Always shows current version - no hardcoding needed

### Database/Git
- `version.json` committed with each code change
- Provides version history in git

---

## 📊 Versioning Scheme

We use **Semantic Versioning (SemVer)**: `MAJOR.MINOR.PATCH`

### When to increment:
- **MAJOR** (e.g., 2.0.0): Breaking changes, major redesigns
- **MINOR** (e.g., 2.1.0): New features, substantial improvements
- **PATCH** (e.g., 2.1.4): Bug fixes, minor tweaks (auto-incremented)

---

## 🧪 Testing the System

### Test 1: Verify API Endpoint
```bash
curl http://localhost:3000/api/version
```
Expected output:
```json
{
  "major": 2,
  "minor": 1,
  "patch": 4,
  "version": "2.1.4",
  "lastUpdated": "2026-02-03T12:34:56.789Z",
  "description": "..."
}
```

### Test 2: Check Dashboard Display
1. Open dashboard: `http://localhost:3000/dashboard`
2. Check footer - should show current version
3. Open browser dev tools → Console
4. Look for: `[Version] Dashboard v2.1.4`

### Test 3: Auto-Bump on Commit
```bash
# Make a small change to a file
echo "# test" >> README.md

# Stage and commit
git add README.md
git commit -m "Test version bump"

# Check version.json was updated
cat version.json
# Should show patch version incremented
```

---

## 📝 Implementation Details

### Git Hook Mechanism
The `.githooks/pre-commit` script:
1. Checks if `version.json` exists
2. Calls `node scripts/version-bump.js patch`
3. Git stages the updated `version.json`
4. Your commit proceeds normally

**Why pre-commit?** 
- Runs before commit message is asked
- If it fails, commit is prevented (safety)
- Automatic and transparent to developer

### Version Loading in app.js
```javascript
// Load version info
let VERSION = { version: '2.0.0', major: 2, minor: 0, patch: 0 };
try {
  VERSION = require('./version.json');
} catch (err) {
  console.warn('Warning: Could not load version.json, using default');
}
```

### API Endpoint
```javascript
// Version endpoint - available to all
app.get('/api/version', (req, res) => {
  res.json(VERSION);
});
```

### Frontend Fetching
```javascript
async function loadVersion() {
  const response = await fetch('/api/version');
  const versionData = await response.json();
  document.getElementById('versionDisplay').textContent = versionData.version;
}
```

---

## ⚙️ Configuration & Customization

### Disable Auto-Bumping
If you want to disable automatic version bumping:
```bash
git config core.hooksPath ""
```

### Re-enable Auto-Bumping
```bash
git config core.hooksPath .githooks
```

### Change Hook Behavior
Edit `.githooks/pre-commit` to:
- Bump minor instead of patch: `node scripts/version-bump.js minor`
- Skip versioning: Remove the version-bump line
- Add custom logic: Add your own scripts

### Manual Version Lock
To temporarily prevent auto-bumps:
```bash
# Rename the hook (disables it)
mv .githooks/pre-commit .githooks/pre-commit.disabled

# Rename back to enable
mv .githooks/pre-commit.disabled .githooks/pre-commit
```

---

## 🐛 Troubleshooting

### Issue: Version not updating in dashboard
**Solution**: 
- Hard refresh browser (Ctrl+Shift+R or Cmd+Shift+R)
- Check browser console for errors
- Verify `/api/version` endpoint works: `curl http://localhost:3000/api/version`

### Issue: Git hook not executing
**Solution**:
- Verify hook is executable: `ls -la .githooks/pre-commit`
- If not: `chmod +x .githooks/pre-commit`
- Check git config: `git config core.hooksPath`
- Should show: `.githooks`

### Issue: Version.json not in git
**Solution**:
- It should be committed automatically by the hook
- If not, manually stage it: `git add version.json`
- Check git status: `git status`

### Issue: Auto-bump is too aggressive
**Solution**: 
- Manually set version: Edit `version.json` directly
- Or use manual scripts to bump minor/major on feature/release commits

---

## 📋 Checklists

### First-Time Setup Verification
- [x] `version.json` exists in project root
- [x] `scripts/version-bump.js` exists
- [x] `.githooks/pre-commit` exists and is executable
- [x] `git config core.hooksPath` returns `.githooks`
- [x] `app.js` loads `version.json`
- [x] `app.js` has `/api/version` endpoint
- [x] `dashboard.html` has `loadVersion()` function
- [x] `package.json` has version bump scripts

### Before Deployment
- [x] Test `/api/version` endpoint
- [x] Verify dashboard shows correct version
- [x] Check `version.json` is committed
- [x] Verify git hooks are configured

### After Making Changes
- Just commit normally! 
- Auto-bump happens automatically
- Version will appear in dashboard on next page load

---

## 🎓 Best Practices

1. **Let the hook do its job** - Don't manually edit `version.json` unless necessary
2. **Commit regularly** - Each logical change gets a version bump
3. **Use meaningful messages** - Commit messages help explain what changed
4. **For releases** - Use `npm run bump-minor` on feature milestones
5. **For hotfixes** - Patch bumps happen automatically
6. **For breaking changes** - Use `npm run bump-major` for major releases

---

## 📚 Related Files

- `version.json` - Current version source
- `scripts/version-bump.js` - Version bumping utility
- `.githooks/pre-commit` - Git pre-commit hook
- `app.js` - Lines with VERSION loading and `/api/version` endpoint
- `public/dashboard.html` - `loadVersion()` function and `#versionDisplay` element
- `package.json` - npm scripts for version management

---

## ✅ Summary

You now have:
1. ✅ **Automatic version bumping** on every commit
2. ✅ **Dynamic version display** in dashboard (no hardcoding)
3. ✅ **Version API** for any service to query
4. ✅ **Manual controls** if you need them (npm scripts)
5. ✅ **Git history** of all version changes

**No more manual version updates needed!** 🎉
