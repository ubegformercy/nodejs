# Auto-Purge Deployment Guide

## Pre-Deployment Checklist

Before deploying to Railway, verify:

- [ ] Code syntax passes validation: `node -c app.js && node -c db.js`
- [ ] No TypeScript/ESLint errors
- [ ] All database functions exported in `module.exports`
- [ ] Tested locally with test Discord server
- [ ] Test executed all 3 subcommands
- [ ] Verified database table creation
- [ ] Tested purge execution with real messages
- [ ] Checked for appropriate logging output

---

## Deployment Steps

### Step 1: Verify Local Tests Pass

```bash
cd /workspaces/nodejs

# Syntax check
node -c app.js
node -c db.js

# If both pass, output should be:
# ✓ app.js syntax OK
# ✓ db.js syntax OK
```

### Step 2: Commit Changes

```bash
git status
# Should show:
#   modified: app.js
#   modified: db.js
#   new file: AUTOPURGE_*.md

git add app.js db.js AUTOPURGE_*.md

git commit -m "feat: implement /autopurge command with PostgreSQL backend

- Added autopurge_settings table to store channel configurations
- Implemented 3 subcommands: set, disable, status
- Added 6 database functions for CRUD operations
- Integrated autopurge execution into 30-second cleanup cycle
- Includes safety features: pinned message protection, 14-day age limit
- Full documentation and testing guides included"

git log --oneline -1
# Verify commit hash
```

### Step 3: Push to GitHub

```bash
git push origin main

# Verify push succeeded:
# main -> main
```

### Step 4: Monitor Railway Deployment

Railway auto-deploys on push to main branch:

1. Go to Railway dashboard: https://railway.app
2. Select your BoostMon project
3. View "Deployments" tab
4. Watch for:
   - Build starting
   - Dependencies installing
   - Bot connecting to Discord
   - Look for errors in build log

Expected deployment time: 2-5 minutes

### Step 5: Verify Bot Deployment

In your test Discord server:

1. Check bot is online (look for green status dot)
2. Type `/autopurge` and verify autocomplete works
3. Verify all 3 subcommands appear:
   - `/autopurge set`
   - `/autopurge disable`
   - `/autopurge status`

### Step 6: Test Commands in Production

#### Test: `/autopurge set`

```
/autopurge set channel:#test-channel type:bot lines:5 interval:1
```

Expected response:
- ✅ Green embed
- ✅ Shows channel, type, lines, interval
- ✅ Shows "Next Purge: In ~1 minute(s)"

#### Test: `/autopurge status`

```
/autopurge status
```

Expected response:
- ✅ Blue embed
- ✅ Lists the test-channel you just configured
- ✅ Shows type emoji (🤖), lines (5), interval (1m)

#### Test: Purge Execution

1. Post 5-10 messages from a bot in #test-channel
2. Wait 1-2 minutes for first purge cycle
3. Check bot logs in Railway dashboard for:
   ```
   [AUTOPURGE] Purged 5 bot message(s) from #test-channel
   ```
4. Verify messages were deleted in Discord

#### Test: `/autopurge disable`

```
/autopurge disable channel:#test-channel
```

Expected response:
- ✅ Red embed
- ✅ Shows "Auto-Purge Disabled"

Verify in `/autopurge status`:
- Channel should no longer appear

### Step 7: Database Verification

If you have Railway CLI access:

```bash
railway shell

# Connect to database and verify table
psql $DATABASE_URL

# Check table exists
\dt autopurge_settings

# Check indexes
\di idx_autopurge*

# View current settings
SELECT * FROM autopurge_settings;

# Exit
\q
```

Expected table columns:
```
 id | guild_id | channel_id | type | lines | interval_seconds | enabled | last_purge_at | created_at | updated_at
```

---

## Monitoring Deployment

### Logs to Watch

In Railway dashboard, watch for these in real-time logs:

**Successful startup:**
```
✓ Database schema initialized
✓ Indexes created/verified
Slash commands registered. Discord now has: settime, addtime, ... autopurge
```

**Successful test:**
```
[AUTOPURGE] Purged 5 bot message(s) from #test-channel
```

### Logs Indicating Issues

```
// Permission error
[AUTOPURGE] Failed to bulk delete: Missing Permissions

// Channel error
[AUTOPURGE] Error processing channel ...: Channel not found

// Database error
setAutopurgeSetting error: connection failed
```

If errors appear:
1. Check error details
2. Review corresponding section in this guide
3. Make fixes locally, commit, and push again

---

## Rollback Plan

If critical issues occur after deployment:

### Option 1: Revert Code (Git)

```bash
# See recent commits
git log --oneline -5

# Revert to commit before autopurge
git revert <commit-hash-of-autopurge>

# This creates a new commit that undoes the changes
git push origin main

# Railway auto-redeploys from reverted code
# Bot will restart automatically
```

### Option 2: Disable Without Revert

If you want to keep the code but disable auto-purge:

```bash
# Via Railway CLI
railway shell
psql $DATABASE_URL
UPDATE autopurge_settings SET enabled = false;
\q
```

This disables ALL auto-purge settings immediately without restarting the bot.

### Option 3: Delete Specific Setting

```bash
# Via Railway CLI
railway shell
psql $DATABASE_URL
DELETE FROM autopurge_settings WHERE guild_id = 'YOUR_GUILD_ID';
\q
```

---

## Post-Deployment Checklist

After deployment succeeds, verify:

- [ ] Bot connects to Discord (online status)
- [ ] `/autopurge` commands appear in Discord autocomplete
- [ ] All 3 subcommands work (`set`, `disable`, `status`)
- [ ] `set` creates database entries
- [ ] `status` displays configurations
- [ ] Purges execute (check logs for `[AUTOPURGE]` messages)
- [ ] Database table has correct schema
- [ ] No errors in Railway logs related to autopurge
- [ ] Existing commands still work (`/settime`, `/showtime`, etc.)
- [ ] No performance degradation

---

## Performance After Deployment

Monitor these metrics:

1. **Cleanup Cycle Time**
   - Should complete in < 10 seconds
   - With 5+ channels: < 15 seconds

2. **Message Purge**
   - < 2 seconds per channel
   - No Discord rate limit errors

3. **Database Connections**
   - Should stay under 10 connections (Railway auto-scales 2-10)
   - No "too many connections" errors

If any metric is poor:
1. Check Railway logs for errors
2. Verify database connection is healthy
3. Check for slow queries (should be indexed)

---

## Ongoing Maintenance

### Regular Checks

Daily:
- [ ] Check Railway dashboard for errors
- [ ] Verify autopurge logs in channels (optional)

Weekly:
- [ ] Review deployment logs for any issues
- [ ] Check database size growth (minimal)

Monthly:
- [ ] Archive or delete old autopurge settings if needed
- [ ] Review usage patterns

### Optional Monitoring Setup

For production monitoring, consider:
- Railway alerts for deployment failures
- Discord webhook to notify admins of errors
- Database backup automation (Railway handles this)

---

## Troubleshooting Common Issues

### Issue: Commands Not Appearing in Discord

**Symptoms:** `/autopurge` not in autocomplete

**Solution:**
1. Verify bot is online in Discord
2. Restart bot: redeploy in Railway
3. Check bot has `applications.commands` scope in OAuth2

**Prevention:** Ensure proper Discord bot setup before deployment

### Issue: Database Errors in Logs

**Symptoms:** `setAutopurgeSetting error` in logs

**Solution:**
1. Verify `DATABASE_URL` env var is set
2. Check Railway PostgreSQL addon is running
3. Verify database credentials are correct
4. Check connection isn't exhausted (Railway scales as needed)

**Prevention:** Test database connection before deploying

### Issue: Purge Not Running

**Symptoms:** Messages not being deleted, no `[AUTOPURGE]` logs

**Solution:**
1. Verify setting is enabled: `/autopurge status`
2. Check interval hasn't elapsed (e.g., "Next Purge: In 45 mins")
3. Wait for cleanup cycle (max 30 seconds)
4. Check bot has `Manage Messages` permission
5. Verify messages exist and aren't pinned/> 14 days old

**Prevention:** Review safety features section in AUTOPURGE_IMPLEMENTATION.md

### Issue: Wrong Messages Deleted

**Symptoms:** Bot deletes user messages when set to `type:bot`

**Solution:**
1. Verify setting with `/autopurge status`
2. Check `type` is correct (🤖 for bot, 👤 for user)
3. Note: Messages from bots vs users determined by Discord's `msg.author.bot` flag

**Prevention:** Always verify settings after creation

---

## Emergency Contact

If you encounter severe issues:

1. Check Railway status page: https://railway.app/status
2. Review AUTOPURGE_TESTING.md for troubleshooting
3. Check Discord.js documentation for API errors
4. Review PostgreSQL error messages

---

## Success Criteria

Deployment is successful when:

✅ Bot connects and shows online
✅ Commands registered and appear in Discord
✅ All 3 subcommands functional
✅ Database table created with correct schema
✅ Settings save and retrieve correctly
✅ Auto-purge executes on schedule
✅ Messages deleted according to filters
✅ No errors in Railway logs
✅ No performance degradation
✅ Existing commands still work

---

## Deployment Complete!

Once all criteria are met, auto-purge is live in production.

**Next steps:**
1. Document usage for your server members
2. Set up auto-purge in production channels
3. Monitor execution for first few days
4. Gather feedback from users

---

**Deployment Guide Version:** 1.0
**Last Updated:** January 31, 2026
**Status:** Ready for Production Deployment
