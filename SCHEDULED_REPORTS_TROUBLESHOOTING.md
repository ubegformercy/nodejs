# Quick Troubleshooting Guide - Scheduled Reports

## What Changed?
We added comprehensive permission checking and error logging to the scheduled role status reports feature. The bot now logs exactly what's happening when reports fail.

## How to Check the Logs

### Option 1: Railway Dashboard (Easiest)
1. Go to https://railway.app
2. Select your BoostMon project
3. Click on the "Logs" tab
4. Search for `SCHEDULED-REPORT` to see all report attempts

### Option 2: Railway CLI
```bash
railway logs --follow
```

## Expected Log Messages

### ✅ Success
```
[SCHEDULED-REPORT] Sent new report to 【🔥】・server-1 in guild Server1 (message ID: 1234567890)
```

### ❌ Missing Send Messages Permission
```
[SCHEDULED-REPORT] Missing SendMessages permission in channel 【🔥】・server-1 (1234567890) for guild 1111111111
```
**Fix**: Go to Discord → server-1 → Channel Settings → Permissions → Find BoostMon role → Ensure "Send Messages" has ✅

### ❌ Missing Embed Links Permission
```
[SCHEDULED-REPORT] Missing EmbedLinks permission in channel 【🔥】・server-1 (1234567890) for guild 1111111111
```
**Fix**: Go to Discord → server-1 → Channel Settings → Permissions → Find BoostMon role → Ensure "Embed Links" has ✅

### ❌ Channel Not Found
```
[SCHEDULED-REPORT] Channel 1234567890 not found in guild 1111111111
```
**Fix**: The configured channel was deleted or the bot can't see it. Reconfigure the report channel using `/rolestatus schedule set`

### ❌ Channel Not Text-Based
```
[SCHEDULED-REPORT] Channel voice-channel is not text-based
```
**Fix**: The configured channel is a voice channel. Use `/rolestatus schedule set` to select a text channel instead.

### ❌ Send Failed with Details
```
[SCHEDULED-REPORT] Failed to send report to 【🔥】・server-1 in guild Server1: Missing Permissions
[SCHEDULED-REPORT] Error code: 50013, HTTP Status: 403
```
**Fix**: This is a Discord API error. Common causes:
- Channel permission overwrite denying the bot
- Bot role positioned too low in hierarchy
- Channel was just deleted/restricted

## Step-by-Step Troubleshooting

### 1. Verify Bot Role Permissions
```
Server Settings → Roles → Find BoostMon
Check these are enabled:
✅ Manage Roles
✅ Send Messages
✅ Embed Links
✅ Read Message History
✅ Manage Messages
```

### 2. Verify Channel-Specific Permissions
```
Right-click report channel → Edit Channel → Permissions
Look for BoostMon role (or @everyone)
Check:
✅ Send Messages (green checkmark)
✅ Embed Links (green checkmark)
✅ Read Message History (green checkmark)
```

### 3. Check Bot Role Hierarchy
```
Server Settings → Roles
Find BoostMon role
Is it positioned HIGH in the role list?
(Should be higher than member roles but doesn't need to be #1)
```

### 4. Test Command Execution
Run `/rolestatus view @role` in server-1
- If this works → Permissions are OK globally
- If this fails → There's a broader permission issue

### 5. Check Report Configuration
Run `/rolestatus schedule list` in server-1
Verify:
- Role is correct
- Channel is correct (and text-based)
- Interval looks right

## Common Issues & Solutions

| Issue | Log Message | Solution |
|-------|-------------|----------|
| Channel deleted | "Channel ... not found" | Use `/rolestatus schedule set` to pick a new channel |
| Voice channel used | "not text-based" | Use `/rolestatus schedule set` to pick a text channel |
| Permission overwrite | "Missing SendMessages" | Fix channel permissions in Discord |
| Bot role too low | "Missing Permissions" + 50013 | Move BoostMon role higher in hierarchy |
| Embed links denied | "Missing EmbedLinks" | Enable "Embed Links" in channel permissions |
| API timeout | "Failed to send" with no details | Retry (usually recovers automatically) |

## How to Re-Enable Reports

If reports were working but stopped:

1. **Check the logs** for error messages
2. **Fix the issue** based on the error message
3. **No action needed** - bot will automatically retry on next interval
4. **To verify** - run `/rolestatus schedule list` to confirm config is still there

## Need to Reconfigure?

```
/rolestatus schedule set
  role: [select the role]
  channel: [select the channel]
  interval: [set in minutes, e.g., 15]
```

This will clear the old schedule and create a new one.

## Still Not Working?

1. Check logs for exact error message
2. Verify channel permissions in Discord UI
3. Try disabling and re-enabling the schedule
4. Check if bot has "View Channels" permission for the channel
5. Try a different text channel to isolate the issue
