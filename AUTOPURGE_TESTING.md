# Auto-Purge Testing Guide

## Pre-Deployment Testing

### 1. Local Testing Setup

Before deploying to Railway, test the implementation locally:

```bash
# Install dependencies (if not already installed)
npm install

# Set environment variables
export DISCORD_TOKEN="your_bot_token"
export DISCORD_CLIENT_ID="your_client_id"
export DISCORD_GUILD_ID="your_test_guild_id"
export DATABASE_URL="postgresql://user:password@localhost:5432/boostmon"

# Run the bot
npm start
```

### 2. Database Verification

Verify the autopurge table was created:

```bash
# Connect to your local PostgreSQL database
psql postgresql://user:password@localhost:5432/boostmon

# Check table exists
\dt autopurge_settings

# Verify indexes
\di idx_autopurge*
```

Expected output:
```
                              Table "public.autopurge_settings"
       Column        |            Type             | Collation | Nullable |                    Default
---------------------+-----------------------------+-----------+----------+---------------------------------------------
 id                  | integer                     |           | not null | nextval('autopurge_settings_id_seq'::regclass)
 guild_id            | character varying(255)      |           | not null |
 channel_id          | character varying(255)      |           | not null |
 type                | character varying(50)       |           | not null |
 lines               | integer                     |           | not null |
 interval_seconds    | bigint                      |           | not null |
 enabled             | boolean                     |           | not null | true
 last_purge_at       | timestamp without time zone |           |          |
 created_at          | timestamp without time zone |           | not null | CURRENT_TIMESTAMP
 updated_at          | timestamp without time zone |           | not null | CURRENT_TIMESTAMP
```

### 3. Test Each Subcommand

#### Test `/autopurge set`

1. In your test Discord server, run:
   ```
   /autopurge set channel:#test-purge type:bot lines:5 interval:1
   ```

2. Verify response:
   - ✅ Shows green "✅ Auto-Purge Enabled" embed
   - ✅ Lists channel, type, lines, and interval
   - ✅ Shows "Next Purge: In ~1 minute(s)"

3. Check database:
   ```sql
   SELECT * FROM autopurge_settings WHERE channel_id = 'YOUR_CHANNEL_ID';
   ```

   Expected columns:
   - `type`: 'bot'
   - `lines`: 5
   - `interval_seconds`: 60
   - `enabled`: true

#### Test `/autopurge status`

1. Run:
   ```
   /autopurge status
   ```

2. Verify response:
   - ✅ Shows all configured channels
   - ✅ Lists type with emoji (🤖/👤/🔀)
   - ✅ Shows lines per purge
   - ✅ Shows interval in minutes
   - ✅ Shows "Last Purge: Never" (for new settings)

#### Test `/autopurge disable`

1. Run:
   ```
   /autopurge disable channel:#test-purge
   ```

2. Verify response:
   - ✅ Shows red "❌ Auto-Purge Disabled" embed
   - ✅ Shows target channel

3. Check database:
   ```sql
   SELECT enabled FROM autopurge_settings WHERE channel_id = 'YOUR_CHANNEL_ID';
   ```
   - Expected: `false`

4. Run `/autopurge status` again:
   - ✅ Channel no longer appears in list

### 4. Test Purge Execution

1. Set up auto-purge with 1-minute interval:
   ```
   /autopurge set channel:#test-purge type:bot lines:5 interval:1
   ```

2. Send test messages:
   - Post 5+ messages from a bot account in #test-purge
   - Post 5+ messages from a user account in #test-purge
   - Pin 1 message to verify it's not deleted

3. Wait for execution:
   - Bot's cleanup cycle runs every 30 seconds
   - First execution happens within 1 minute
   - Check logs for: `[AUTOPURGE] Purged X bot message(s) from #test-purge`

4. Verify results:
   - ✅ Bot messages deleted (based on type:bot)
   - ✅ User messages remain
   - ✅ Pinned message not deleted
   - ✅ Database updated: `last_purge_at` timestamp changed

### 5. Test Message Type Filters

#### Test `type:user`
```
/autopurge set channel:#test-purge type:user lines:5 interval:1
```
- Post bot messages and user messages
- After 1 minute: only user messages should be deleted

#### Test `type:both`
```
/autopurge set channel:#test-purge type:both lines:5 interval:1
```
- Post bot messages and user messages
- After 1 minute: all messages should be deleted (except pinned)

### 6. Test Error Handling

#### Invalid Channel Type
1. Try to set auto-purge on a voice channel:
   ```
   /autopurge set channel:#voice-channel type:bot lines:5 interval:1
   ```
2. Verify error response:
   - ✅ Red error embed
   - ✅ Message: "Channel must be a text or announcement channel."

#### Missing Permissions
1. Remove bot's "Manage Messages" permission in a test channel
2. Try to set auto-purge:
   ```
   /autopurge set channel:#no-perms type:bot lines:5 interval:1
   ```
3. Verify error response:
   - ✅ Error mentions missing "Manage Messages" permission

#### Non-Existent Setting
1. Try to disable a channel with no auto-purge:
   ```
   /autopurge disable channel:#no-settings
   ```
2. Verify error response:
   - ✅ Ephemeral error message
   - ✅ Message: "No auto-purge setting found"

### 7. Test Edge Cases

#### Test Message Age Limit
- Messages older than 14 days should not be deleted
- Discord API limitation (cannot bulk delete messages > 14 days old)

#### Test Pinned Messages
- Messages pinned in the channel should be excluded

#### Test Empty Channel
- Run auto-purge on empty channel
- Should complete without errors and update `last_purge_at`

#### Test High Volume
- Set `lines:100` and `interval:1`
- Post 150+ messages of the target type
- Verify only 100 are deleted per interval

### 8. Performance Testing

For a production-ready setup:

1. Test with multiple channels:
   ```sql
   -- Create test settings
   INSERT INTO autopurge_settings (guild_id, channel_id, type, lines, interval_seconds, enabled)
   VALUES 
     ('GUILD_ID', 'CHANNEL_1', 'bot', 50, 60, true),
     ('GUILD_ID', 'CHANNEL_2', 'user', 30, 120, true),
     ('GUILD_ID', 'CHANNEL_3', 'both', 100, 300, true);
   ```

2. Monitor bot logs for:
   - Execution time per purge operation
   - Total time for `executeAutopurges()` function
   - Any rate limit warnings

3. Expected performance:
   - Single channel purge: < 2 seconds
   - Multiple channels: < 10 seconds total
   - Should not block other operations

## Post-Deployment Testing (Railway)

### 1. Verify Database Creation

```bash
# SSH into Railway environment or use Railway CLI
railway shell

# Check table
psql $DATABASE_URL -c "\dt autopurge_settings"
```

### 2. Test in Production Discord Server

1. Set auto-purge in a test channel
2. Monitor bot logs via Railway dashboard
3. Verify purge execution in logs
4. Check database entries

### 3. Monitor for Issues

Watch for these errors in Railway logs:
```
[AUTOPURGE] Failed to bulk delete
[AUTOPURGE] Error processing channel
executeAutopurges error
```

## Rollback Plan

If issues occur:

1. **Disable all auto-purge settings:**
   ```sql
   UPDATE autopurge_settings SET enabled = false;
   ```

2. **Revert code (git):**
   ```bash
   git revert <commit-hash>
   git push origin main
   ```

3. **Railway will auto-redeploy** from the reverted code

## Success Checklist

- ✅ Database table created on startup
- ✅ All three subcommands work
- ✅ Settings saved to database
- ✅ Purge execution runs every interval
- ✅ Messages filtered correctly by type
- ✅ Pinned messages preserved
- ✅ Old messages (14+ days) not deleted
- ✅ Permissions validated
- ✅ Error messages clear and helpful
- ✅ Logs show successful purge operations
- ✅ No performance degradation

## Common Issues

### Issue: "Missing Manage Messages Permission"
**Solution:** Grant bot the "Manage Messages" permission in the target channel

### Issue: Settings not saving
**Solution:** Check DATABASE_URL is correct and database is accessible

### Issue: Purge not running
**Solution:** 
1. Verify `enabled: true` in database
2. Check interval hasn't elapsed
3. Look for errors in logs
4. Verify bot is still connected to Discord

### Issue: Wrong messages being deleted
**Solution:** Verify the `type` setting is correct using `/autopurge status`

---

Once all tests pass, proceed with deployment to Railway!
