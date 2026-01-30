# BoostMon PostgreSQL Migration Checklist

## Pre-Migration

- [ ] **Backup Existing Data**
  - Save current `data.json` to safe location
  - `cp data.json data.json.backup`

- [ ] **Review Changes**
  - Read `MIGRATION_GUIDE.md` for technical details
  - Review `app.js` for command handler changes
  - Check `db.js` for database schema

- [ ] **Prepare Environment**
  - Have Discord bot token ready
  - Have Discord Client ID ready
  - Have Discord Guild ID ready
  - Have Railway account ready

## Step 1: Setup PostgreSQL on Railway

- [ ] Create Railway PostgreSQL database
  - [ ] Go to railway.app
  - [ ] Create new project or select existing
  - [ ] Click "+ Create" → "Database" → "PostgreSQL"
  - [ ] Wait for container to start

- [ ] Retrieve Database URL
  - [ ] Click PostgreSQL service
  - [ ] Go to "Variables" tab
  - [ ] Copy `DATABASE_URL` value
  - [ ] Save to temporary location

## Step 2: Configure Environment Variables

- [ ] Set variables in Railway dashboard:
  - [ ] `DISCORD_TOKEN` = your bot token
  - [ ] `DISCORD_CLIENT_ID` = your client ID
  - [ ] `DISCORD_GUILD_ID` = your server ID
  - [ ] `DATABASE_URL` = from PostgreSQL setup (auto-created)
  - [ ] Optional: `PORT` = 3000 (or your preferred port)

- [ ] Verify all variables are set
  - [ ] No missing or empty values
  - [ ] All IDs are correct (copy-paste verified)

## Step 3: Deploy Code

### Option A: GitHub Deploy (Recommended)

- [ ] Push code to GitHub
  ```bash
  git add .
  git commit -m "Migrate BoostMon to PostgreSQL"
  git push origin main
  ```

- [ ] Connect Railway to GitHub (if not already)
  - [ ] Click on service
  - [ ] Go to "Deploy" tab
  - [ ] Connect GitHub repo

- [ ] Enable auto-deploy
  - [ ] Set branch to `main` (or your branch)
  - [ ] Auto-deploy should start

### Option B: Railway CLI Deploy

- [ ] Install Railway CLI
  ```bash
  npm install -g @railway/cli
  ```

- [ ] Login to Railway
  ```bash
  railway login
  ```

- [ ] Deploy
  ```bash
  railway up
  ```

## Step 4: Verify Initial Deployment

- [ ] Check Railway logs for startup messages
  - [ ] "✓ Database schema initialized" ✓
  - [ ] "BoostMon logged in as YourBot#XXXX" ✓
  - [ ] "Slash commands registered" ✓
  - [ ] No error messages ✓

- [ ] Bot should be online in Discord
  - [ ] Check Discord server
  - [ ] Bot appears in online members

## Step 5: Migrate Existing Data (Optional)

**Skip this section if you're starting fresh or don't have existing timers**

### Local Migration

- [ ] Set up local environment
  ```bash
  export DATABASE_URL="postgresql://..."  # From Railway
  ```

- [ ] Run migration script
  ```bash
  node migrate.js
  ```

- [ ] Verify migration results
  - [ ] Check output shows "✅ Migration completed successfully!"
  - [ ] All timers migrated
  - [ ] No errors reported

### Or: Manual Migration (Advanced)

- [ ] Connect to PostgreSQL
  ```bash
  railway connect postgresql
  ```

- [ ] Run migration SQL manually
  - See `MIGRATION_GUIDE.md` for SQL queries

## Step 6: Test All Commands

### In Discord, test each command:

- [ ] `/settime @testuser 5 @testrole`
  - [ ] Timer is created
  - [ ] Role is assigned
  - [ ] Embed shows correctly

- [ ] `/addtime @testuser 3`
  - [ ] Timer is extended
  - [ ] New expiry time is shown

- [ ] `/timeleft @testuser`
  - [ ] Shows remaining time
  - [ ] Countdown shows correctly

- [ ] `/pausetime @testuser`
  - [ ] Timer is paused (yellow indicator)
  - [ ] Remaining time is frozen

- [ ] `/resumetime @testuser`
  - [ ] Timer resumes from where paused
  - [ ] Back to active (green indicator)

- [ ] `/removetime @testuser 2`
  - [ ] Time is reduced
  - [ ] New expiry is shown

- [ ] `/cleartime @testuser`
  - [ ] Timer is removed
  - [ ] Role is removed from user
  - [ ] No more timers shown

### Test Multi-Role Scenarios

- [ ] Set time for multiple roles on same user
  - [ ] All timers should work independently
  - [ ] Commands should handle disambiguation

- [ ] Test role selection with multiple timers
  - [ ] Commands should ask for role if ambiguous

## Step 7: Monitor for 24 Hours

- [ ] Watch Railway logs for errors
  - [ ] Check: `railway logs --service boostmon`
  - [ ] Look for database connection issues
  - [ ] Ensure cleanup loop is running

- [ ] Test cleanup/warning system
  - [ ] Set timer for 2 minutes
  - [ ] Wait for 60-minute warning threshold message
  - [ ] Wait for 10-minute warning
  - [ ] Wait for 1-minute warning
  - [ ] Wait for expiry message
  - [ ] Verify role is removed

- [ ] Monitor database health
  - [ ] Click PostgreSQL service in Railway
  - [ ] Check "Metrics" for connection/query activity
  - [ ] Ensure no error spikes

## Step 8: Cleanup & Archive

- [ ] Verify no more errors after 24 hours
  - [ ] Check recent logs
  - [ ] Commands responsive
  - [ ] Database queries fast

- [ ] Archive old data file
  ```bash
  mv data.json data.json.backup
  git add data.json.backup
  git commit -m "Archive old JSON data"
  git push origin main
  ```

- [ ] Optional: Delete old data file after 1 week
  - [ ] Only if absolutely certain migration worked
  - [ ] Keep backup for record

## Step 9: Setup Alerts & Backups

- [ ] Enable Railway notifications
  - [ ] Go to Railway account settings
  - [ ] Enable email for deployment failures
  - [ ] Enable email for service crashes

- [ ] Verify automatic backups
  - [ ] Go to PostgreSQL service
  - [ ] Check "Backups" tab
  - [ ] Should show daily automatic backups

- [ ] Test backup restoration (optional but recommended)
  - [ ] Create test backup
  - [ ] Verify it can be restored

## Step 10: Document for Future Reference

- [ ] Save important information
  - [ ] Location of DATABASE_URL
  - [ ] How to access PostgreSQL
  - [ ] Emergency contact for Railway support

- [ ] Update team documentation
  - [ ] Share migration details with team
  - [ ] Document any custom configurations
  - [ ] Record troubleshooting solutions

## Post-Migration

### Daily
- [ ] Monitor logs: `railway logs`
- [ ] Check bot is online in Discord

### Weekly
- [ ] Review database metrics in Railway
- [ ] Verify backups are running
- [ ] Test a sample command

### Monthly
- [ ] Review database size/performance
- [ ] Check for any error patterns
- [ ] Update documentation if needed

## Rollback Procedure (If Needed)

If something goes wrong and you need to revert:

- [ ] Restore from git
  ```bash
  git revert <commit-hash>
  git push railway main
  ```

- [ ] Railway automatically redeploys with old code

- [ ] Restore data from backup
  ```bash
  mv data.json.backup data.json
  ```

- [ ] All old timers will still work from JSON

## Troubleshooting Quick Links

| Issue | Solution |
|-------|----------|
| "DATABASE_URL not set" | Set Railway PostgreSQL add-on |
| "Connection refused" | Check PostgreSQL service running |
| "UNIQUE constraint violation" | Normal - handled by ON CONFLICT |
| "Command timeout" | Check database metrics, may need scaling |
| "Bot won't start" | Check Discord token/IDs are correct |
| "Timers disappearing" | Check if bot process crashed - review logs |

## Support Resources

- **Railway Docs**: https://docs.railway.app
- **Discord.js Docs**: https://discord.js.org
- **PostgreSQL Docs**: https://www.postgresql.org/docs
- **Migration Guide**: See `MIGRATION_GUIDE.md`
- **Quick Start**: See `RAILWAY_QUICKSTART.md`

---

## Migration Status

- [ ] All steps completed
- [ ] All tests passed
- [ ] Bot stable for 24+ hours
- [ ] Data verified and backed up
- [ ] Team notified of changes

**Date Completed**: ___________

**Completed By**: ___________

**Notes**: ___________________________________________

---

**🎉 Congratulations! Your BoostMon bot is now running on PostgreSQL!**
