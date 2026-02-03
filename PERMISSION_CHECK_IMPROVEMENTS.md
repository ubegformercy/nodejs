# Scheduled Role Status Report - Permission Check Improvements

## Problem Diagnosed
The BoostMon bot was experiencing "Missing Permissions" errors when sending scheduled role status reports to certain Discord channels, specifically in server-1, while the same feature worked perfectly in server-2.

**Root Cause**: Silent error handling was masking the actual permission issues. The original code used `.catch(() => null)` which silently swallowed errors without logging them.

## Solution Implemented

### 1. **Pre-Send Permission Verification** (Lines 1687-1705)
Added upfront permission checks before attempting to send any report:
- ✅ Verify channel is text-based
- ✅ Fetch bot member to get current permissions context
- ✅ Check for `SendMessages` permission in the specific channel
- ✅ Check for `EmbedLinks` permission (required for embeds)
- ✅ Log detailed errors if permissions are missing

**Why this matters**: Discord permissions can be overridden at the channel level. A bot may have server-wide Send Messages permission but be denied in a specific channel through role/permission overwrites.

### 2. **Detailed Error Logging**
Replaced silent `.catch(() => null)` with proper error logging:

**Before (Silent)**:
```javascript
await channel.send({ embeds: [embed] }).catch(() => null);
```

**After (Verbose)**:
```javascript
try {
  await channel.send({ embeds: [embed] });
  await db.updateRolestatusLastReport(guild.id, schedule.role_id, schedule.channel_id);
} catch (err) {
  console.error(`[SCHEDULED-REPORT] Failed to send empty report to ${channel.name}: ${err.message}`);
}
```

### 3. **Double-Check Permission Before Send** (Lines 1854-1860)
Added a final permission verification right before attempting to send the message:
```javascript
const currentPerms = channel.permissionsFor(me);
if (!currentPerms?.has(PermissionFlagsBits.SendMessages)) {
  console.error(`[SCHEDULED-REPORT] Permission check failed right before send in ${channel.name}: Missing SendMessages`);
  continue;
}
```

**Why**: Catches permission changes that might occur between the initial check and the actual send attempt.

### 4. **Enhanced Error Context** (Line 1869-1870)
Added error code and HTTP status to help with debugging:
```javascript
console.error(`[SCHEDULED-REPORT] Error code: ${err.code}, HTTP Status: ${err.status}`);
```

### 5. **Guild and Channel Names in Logs** (Throughout)
Changed from generic logging to include contextual information:
```javascript
console.log(`[SCHEDULED-REPORT] Sent new report to ${channel.name} in guild ${guild.name} (message ID: ${newMessage.id})`);
```

## Expected Log Output After Deployment

### If Reports Send Successfully:
```
[SCHEDULED-REPORT] Sent new report to 【🔥】・server-1 in guild Server1 (message ID: 1234567890)
```

### If Permission Error Exists:
```
[SCHEDULED-REPORT] Missing SendMessages permission in channel 【🔥】・server-1 (1234567890) for guild 1111111111
```

### If Channel Not Found:
```
[SCHEDULED-REPORT] Channel 1234567890 not found in guild 1111111111
```

### If Channel Not Text-Based:
```
[SCHEDULED-REPORT] Channel voice-channel is not text-based
```

## How to Diagnose Server-1 Issues

With this improved logging, you can now:

1. **Check the bot logs** (in Railway dashboard or via CLI)
2. **Look for `[SCHEDULED-REPORT]` entries** to see exactly what's happening
3. **If you see permission errors**, take these actions:
   - Go to server-1 → Channel Settings → Permissions
   - Find the BoostMon role
   - Verify "Send Messages" and "Embed Links" have green checkmarks (not red X)
   - Compare with server-2 channel settings

## Files Modified
- `/workspaces/nodejs/app.js` - `executeScheduledRolestatus()` function (lines 1670-1887)

## Deployment Status
✅ **Changes Committed**: Git commits pushed to `origin/main`
✅ **Auto-Deployed**: Railway will automatically redeploy from the new commits

## Next Steps
1. Watch the Railway logs for scheduled report execution
2. Check console output for the detailed error messages
3. If permission errors appear, use the error messages to identify the specific issue
4. Apply the recommended fix based on the error message

## Testing
The next time a scheduled report runs (every 15 minutes), check:
- Railway Logs dashboard
- Console output for `[SCHEDULED-REPORT]` messages
- Whether reports send successfully with detailed success logs
- If errors occur, their specific error codes and permission details
