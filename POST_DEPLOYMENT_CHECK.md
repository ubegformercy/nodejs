# ✅ Post-Deployment Verification Checklist

**You've completed the setup correctly!** Now verify everything is working.

## 🎯 Step-by-Step Verification

### Step 1: Check Bot Deployment Status
**In Railway Dashboard:**

1. Go to your bot service
2. Look at the top - should show:
   - ✅ Green checkmark = Deployed successfully
   - ✅ "Deployment" tab shows recent deployment
   - ✅ Status shows "Running" or "Deployed"

**If you see red or errors:**
- Wait 2-3 minutes
- Refresh page (Cmd+R or Ctrl+R)
- Check if there's a deployment in progress

---

### Step 2: Verify All Environment Variables
**In Railway Bot Settings:**

Click your bot service → Variables tab

You should have ALL FOUR:

```
✓ DISCORD_TOKEN = (your bot token)
✓ DISCORD_CLIENT_ID = (your client ID)
✓ DISCORD_GUILD_ID = (your server ID)
✓ DATABASE_URL = postgresql://user:pass@host:port/db
```

**If any are missing:**
- Click "New Variable"
- Add the missing one
- Copy value from Discord dev portal or PostgreSQL

**If DATABASE_URL looks wrong:**
- Should start with: `postgresql://`
- Should contain: user, password, host, port, database name
- Should NOT have spaces or quotes

---

### Step 3: Check Bot Logs for Startup Messages
**In Railway Bot Logs Tab:**

Look for these exact messages:

```
=== BoostMon app.js booted ===
DISCORD_TOKEN present: true
DISCORD_CLIENT_ID present: true
DISCORD_GUILD_ID present: true

BoostMon logged in as YourBot#1234
✓ Database schema initialized
Slash commands registered
Slash commands registered. Discord now has: settime, addtime, removetime, cleartime, pausetime, resumetime, timeleft
```

**If you see these → Everything is working!** ✅

**If you see errors like:**
- `DATABASE_URL undefined` → You missed setting the variable
- `ECONNREFUSED` → PostgreSQL isn't running or URL is wrong
- `Can't connect to Discord` → Discord token is invalid
- `UNIQUE constraint violation` → Normal on first startup, ignore

---

### Step 4: Verify Bot is Online in Discord
**In your Discord server:**

1. Look at member list (or online users)
2. Find your bot name (e.g., "BoostMon")
3. Should show online status with a green dot

**If bot is offline:**
- Check logs for crash messages
- Verify Discord token is correct
- Wait 30 seconds and check again

---

### Step 5: Test All 7 Commands
**In your Discord server**, type each command:

**Test 1: Create a timer**
```
/settime @yourself 2 @test-role
```
Expected: Embed shows "🟢 Timed Role Activated" with 2 minute duration

**Test 2: Check remaining time**
```
/timeleft @yourself
```
Expected: Shows time remaining (about 2 minutes)

**Test 3: Add time**
```
/addtime @yourself 1
```
Expected: Timer is now ~3 minutes

**Test 4: Pause timer**
```
/pausetime @yourself
```
Expected: Shows "⏸️ Paused" with yellow indicator

**Test 5: Resume timer**
```
/resumetime @yourself
```
Expected: Timer resumes from where paused

**Test 6: Remove time**
```
/removetime @yourself 1
```
Expected: Timer is reduced by 1 minute

**Test 7: Clear timer**
```
/cleartime @yourself
```
Expected: Timer removed and role removed from user

**If ALL commands work → Perfect!** ✅

**If commands give errors:**
- Check bot logs for error details
- Verify bot has permissions to manage roles
- Make sure bot role is above the test role

---

### Step 6: Monitor Logs for 5 Minutes
**In Railway Logs Tab:**

Watch for these repeating messages every 30 seconds:

```
[System] Checking timers...
```

This means the cleanup loop is running! ✅

**Look for any error patterns:**
- Same error repeating? → Might be an issue
- Different errors? → Might be transient

---

### Step 7: Wait 30 Seconds and Check Again
**The cleanup loop runs every 30 seconds**

Create a 1-minute timer and wait to see if you get a warning message. Around 10 minutes remaining, you should see:

```
@yourname warning: your access for @test-role expires in 10 minute(s).
```

This appears as a Discord DM or in the warning channel you specified.

---

## ✅ Success Indicators

### You Know Everything Works When:

- ✅ Bot shows online in Discord
- ✅ All 7 commands respond (no errors)
- ✅ Timers show in Discord with embeds
- ✅ `✓ Database schema initialized` in logs
- ✅ Cleanup loop message appears every 30 seconds
- ✅ No error messages in logs
- ✅ Timers persist if you restart bot

### Common "False Alarms" (Not Problems):

- ⚠️ "UNIQUE constraint violation" on startup → Normal, just testing
- ⚠️ Empty logs at first → Wait 30 seconds
- ⚠️ Bot shows offline briefly → Loading, wait a moment
- ⚠️ First command is slow → Connection pooling warming up

---

## 🆘 Troubleshooting If Something's Wrong

### Issue: Bot won't start / keeps crashing

**Check:**
1. Are all 4 environment variables set?
2. Is PostgreSQL service running? (Check Railway PostgreSQL service)
3. Any error messages in logs?

**Fix:**
1. Verify DATABASE_URL format: `postgresql://user:password@host:port/database`
2. Copy DATABASE_URL again from PostgreSQL service
3. Restart bot deployment in Railway

---

### Issue: Commands don't work / "Unknown Command"

**Check:**
1. Are slash commands registered? (Should see "Slash commands registered" in logs)
2. Is bot online? (Check Discord member list)

**Fix:**
1. Wait 2-3 minutes for commands to propagate
2. Try `/settime` again
3. If still fails, check permissions: Bot needs "Manage Roles" permission

---

### Issue: Database errors in logs

**Check log for specific error:**
- `ECONNREFUSED` → PostgreSQL not running
- `Connect timeout` → Wrong DATABASE_URL
- `Authentication failed` → Wrong credentials in URL

**Fix:**
1. Go to Railway PostgreSQL service
2. Click "Public" tab
3. Copy connection URL again
4. Update DATABASE_URL variable
5. Restart bot

---

### Issue: Timers don't persist after bot restart

**Check:**
1. Are timers in PostgreSQL? (Check via Railway PostgreSQL connection)
2. Any database errors in logs?

**Fix:**
1. Verify DATABASE_URL is still set
2. Check PostgreSQL is running
3. If data is lost, might have crashed - check logs

---

## 📊 What's Happening Behind the Scenes

### When Bot Starts:
1. ✅ Connects to Discord
2. ✅ Connects to PostgreSQL
3. ✅ Creates `role_timers` table if it doesn't exist
4. ✅ Registers all 7 slash commands

### Every 30 Seconds:
1. ✅ Queries all active timers
2. ✅ Checks for expired timers
3. ✅ Sends warnings if time remaining reaches threshold
4. ✅ Updates database as needed

### When You Run a Command:
1. ✅ Command is received from Discord
2. ✅ Bot validates permissions
3. ✅ Bot queries/updates database
4. ✅ Bot sends response embed to Discord

---

## 🎯 Next Actions

**Once verified:**

1. ✅ All tests pass → You're done! Bot is working!
2. ⏸️ Something not working? → Tell me what you see and I'll debug
3. 📊 Want to monitor? → Keep Railway logs open, watch for patterns
4. 🚀 Ready to go live? → Bot is already live and working!

---

## 📞 Tell Me About Your Status

Please let me know:

1. **Are the startup messages showing in logs?**
   - Yes, all of them
   - Some of them  
   - None at all

2. **Are the Discord commands working?**
   - Yes, all 7 work
   - Some work, some don't
   - None work

3. **Any error messages?**
   - Yes, what do they say?
   - No errors
   - Not sure

Then I can help you with next steps!

---

**You're doing great! The setup is correct, now just verify it's all connected.** 🎉
