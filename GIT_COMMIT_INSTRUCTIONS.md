# Git Commit & Deployment Instructions

## Files Changed Summary

### Core Implementation Files (MUST COMMIT)
```
Modified:
- app.js              (~210 lines added)
- db.js               (~80 lines added)
```

### Documentation Files (Should Commit)
```
New Files:
- AUTOPURGE_IMPLEMENTATION.md    (API documentation)
- AUTOPURGE_TESTING.md           (Testing procedures)
- AUTOPURGE_DEPLOYMENT.md        (Deployment guide)
- AUTOPURGE_QUICK_REF.md         (Quick reference)
- AUTOPURGE_COMPLETE.md          (Implementation overview)
- README_AUTOPURGE.md            (This summary)
```

---

## Commit Instructions

### Step 1: Stage Files
```bash
cd /workspaces/nodejs

# Stage core files (required)
git add app.js db.js

# Stage documentation (optional but recommended)
git add AUTOPURGE_*.md README_AUTOPURGE.md
```

### Step 2: View Changes
```bash
git status

# Expected output:
# On branch main
# Changes to be committed:
#   modified:   app.js
#   modified:   db.js
#   new file:   AUTOPURGE_IMPLEMENTATION.md
#   new file:   AUTOPURGE_TESTING.md
#   ... etc
```

### Step 3: Commit with Message
```bash
git commit -m "feat: implement /autopurge command with PostgreSQL backend

- Add autopurge_settings table to PostgreSQL schema
- Create 6 database functions for CRUD operations
- Register /autopurge slash command with 3 subcommands:
  * set: Configure auto-purge for a channel
  * disable: Temporarily disable auto-purge
  * status: Show all active auto-purge settings
- Implement executeAutopurges() execution function
- Integrate autopurge into 30-second cleanup cycle
- Add safety features: pinned message protection, 14-day age limit
- Comprehensive error handling and validation
- Full documentation with testing and deployment guides"
```

### Step 4: Verify Commit
```bash
git log --oneline -3

# Expected output shows your new commit at top:
# abc1234 feat: implement /autopurge command...
# (previous commits below)
```

### Step 5: Push to GitHub
```bash
git push origin main

# Expected output:
# To https://github.com/ubegformercy/nodejs.git
#    xxxxxxx..abcdefg  main -> main
```

---

## Railway Deployment

Railway automatically deploys when you push to the `main` branch.

### Monitor Deployment

1. Go to: https://railway.app/dashboard
2. Select BoostMon project
3. Click "Deployments" tab
4. Watch for:
   - Build starting
   - Dependencies installing
   - Build completing
   - Bot starting
   - Bot connecting

Expected time: 2-5 minutes

### Verify Deployment Success

1. Check bot is online in Discord
2. Run `/autopurge` command
3. Verify all 3 subcommands appear
4. Check Railway logs for success messages

---

## Detailed Change Summary

### app.js Changes

**Location 1: Command Registration (lines ~229-279)**
```javascript
new SlashCommandBuilder()
  .setName("autopurge")
  .setDescription("Automatically purge bot or user messages...")
  .addSubcommand((s) => /* set subcommand */)
  .addSubcommand((s) => /* disable subcommand */)
  .addSubcommand((s) => /* status subcommand */)
```

**Location 2: Command Handler (lines ~1184-1308)**
```javascript
if (interaction.commandName === "autopurge") {
  // Handle set, disable, and status subcommands
  // Permission checks, database calls, embed responses
}
```

**Location 3: Execution Function (lines ~1441-1515)**
```javascript
async function executeAutopurges(guild, now) {
  // Fetch settings, filter messages, bulk delete
  // Update timestamps, log results
}
```

**Location 4: Integration (line ~1580)**
```javascript
await executeAutopurges(guild, now);
```

### db.js Changes

**Location 1: Table Schema (lines ~42-54)**
```javascript
CREATE TABLE IF NOT EXISTS autopurge_settings (
  id SERIAL PRIMARY KEY,
  guild_id VARCHAR(255) NOT NULL,
  channel_id VARCHAR(255) NOT NULL,
  type VARCHAR(50) NOT NULL,
  lines INTEGER NOT NULL,
  interval_seconds BIGINT NOT NULL,
  enabled BOOLEAN DEFAULT true,
  last_purge_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(guild_id, channel_id)
);
```

**Location 2: Performance Indexes (lines ~63-64)**
```javascript
'CREATE INDEX IF NOT EXISTS idx_autopurge_settings_guild_channel...',
'CREATE INDEX IF NOT EXISTS idx_autopurge_settings_enabled...',
```

**Location 3: Database Functions (lines ~340-420)**
```javascript
async function setAutopurgeSetting(...)
async function getAutopurgeSetting(...)
async function getAllAutopurgeSettings(...)
async function disableAutopurgeSetting(...)
async function deleteAutopurgeSetting(...)
async function updateAutopurgeLastPurge(...)
```

**Location 4: Module Exports (lines ~431-453)**
```javascript
module.exports = {
  // ... existing exports ...
  setAutopurgeSetting,
  getAutopurgeSetting,
  getAllAutopurgeSettings,
  disableAutopurgeSetting,
  deleteAutopurgeSetting,
  updateAutopurgeLastPurge,
  // ... rest of exports ...
};
```

---

## Pre-Push Checklist

Before pushing, verify:

- [ ] Syntax valid: `node -c app.js && node -c db.js`
- [ ] No uncommitted changes: `git status` (should be clean after add)
- [ ] Changes staged: `git status` (shows files in green)
- [ ] Commit message is descriptive
- [ ] Documentation files included
- [ ] No sensitive data in commits

---

## Post-Push Monitoring

### Watch for Success
- [ ] GitHub shows commit pushed
- [ ] Railway starts deployment
- [ ] Build log shows no errors
- [ ] Bot comes online in Discord
- [ ] Commands appear in autocomplete

### Watch for Issues
```
Common errors to watch for in Railway logs:
- Syntax errors: Fix locally, commit, push again
- Database errors: Check DATABASE_URL env var
- Discord errors: Check bot permissions and token
```

### Test Commands
After Railway deployment completes:

```bash
# In Discord server:
/autopurge set channel:#test type:bot lines:5 interval:1
/autopurge status
/autopurge disable channel:#test
```

---

## Rollback Procedure

If critical issues occur:

```bash
# View recent commits
git log --oneline -5

# Revert to commit before autopurge
git revert <commit-hash>
git push origin main

# Railway auto-redeploys from reverted commit
```

---

## Success Indicators

✅ Commit pushed successfully
✅ Railway deployment starts automatically
✅ Build completes without errors (2-5 minutes)
✅ Bot comes online in Discord
✅ `/autopurge` commands appear
✅ All 3 subcommands functional
✅ No errors in Railway logs

---

## Documentation References

After deployment, reference these files:

- **Quick Start:** `README_AUTOPURGE.md`
- **Deployment:** `AUTOPURGE_DEPLOYMENT.md`
- **Testing:** `AUTOPURGE_TESTING.md`
- **API Docs:** `AUTOPURGE_IMPLEMENTATION.md`
- **Quick Ref:** `AUTOPURGE_QUICK_REF.md`

---

## Questions?

See the comprehensive documentation files included:
- `AUTOPURGE_DEPLOYMENT.md` - Full deployment guide
- `AUTOPURGE_TESTING.md` - Testing procedures
- `AUTOPURGE_IMPLEMENTATION.md` - Technical documentation

---

**Ready to deploy? Follow the steps above!**
