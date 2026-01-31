# Auto-Purge Implementation Guide

## Overview

The `/autopurge` command automatically deletes messages from a Discord channel at regular intervals based on message type (bot, user, or both).

## Database Schema

### autopurge_settings Table

```sql
CREATE TABLE autopurge_settings (
  id SERIAL PRIMARY KEY,
  guild_id VARCHAR(255) NOT NULL,
  channel_id VARCHAR(255) NOT NULL,
  type VARCHAR(50) NOT NULL,              -- 'bot' | 'user' | 'both'
  lines INTEGER NOT NULL,                 -- 1-100 messages per purge
  interval_seconds BIGINT NOT NULL,       -- minimum 900 (15 minutes)
  enabled BOOLEAN DEFAULT true,
  last_purge_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(guild_id, channel_id)
);
```

### Performance Indexes

```sql
CREATE INDEX idx_autopurge_settings_guild_channel ON autopurge_settings(guild_id, channel_id);
CREATE INDEX idx_autopurge_settings_enabled ON autopurge_settings(enabled);
```

## Database Functions

All functions are in `db.js`:

### `setAutopurgeSetting(guildId, channelId, type, lines, intervalSeconds)`
- Creates or updates an autopurge setting
- Returns the setting object or null on error
- Automatically enables the setting

### `getAutopurgeSetting(guildId, channelId)`
- Retrieves a specific autopurge setting
- Returns the setting object or null

### `getAllAutopurgeSettings(guildId)`
- Gets all enabled autopurge settings for a guild
- Returns array of setting objects

### `disableAutopurgeSetting(guildId, channelId)`
- Disables an autopurge setting without deleting it
- Returns boolean success status

### `deleteAutopurgeSetting(guildId, channelId)`
- Permanently removes an autopurge setting
- Returns boolean success status

### `updateAutopurgeLastPurge(guildId, channelId)`
- Updates the `last_purge_at` timestamp
- Called after a successful purge

## Slash Command: `/autopurge`

### Subcommands

#### `/autopurge set`
Sets up auto-purge for a channel.

**Parameters:**
- `channel` (required): Target channel for purging
- `type` (required): Message type to purge
  - `bot`: Delete bot messages only
  - `user`: Delete user messages only
  - `both`: Delete both bot and user messages
- `lines` (required): 1-100 messages to delete per purge interval
- `interval` (required): 15-10080 minutes between purges (15 min to 7 days)

**Permissions Required:**
- Bot must have `Manage Messages` permission in the target channel

**Example:**
```
/autopurge set channel:#spam type:both lines:50 interval:30
```

#### `/autopurge disable`
Disables auto-purge for a channel without deleting the setting.

**Parameters:**
- `channel` (required): Target channel to disable

**Example:**
```
/autopurge disable channel:#spam
```

#### `/autopurge status`
Shows all active auto-purge settings in the server.

**Output:**
- Lists each configured channel with:
  - Message type filter (emoji indicator)
  - Lines per purge
  - Interval in minutes
  - Time of last purge

## Implementation Details

### Command Handlers (`app.js`)

Located in the `/autopurge` command handler section:

1. **Set Subcommand**
   - Validates target channel is text-based or announcement channel
   - Checks bot has `Manage Messages` permission
   - Saves setting to database
   - Returns confirmation embed

2. **Disable Subcommand**
   - Verifies setting exists
   - Disables it in database
   - Returns confirmation embed

3. **Status Subcommand**
   - Fetches all active settings
   - Displays formatted list with metadata
   - Shows when last purge occurred

### Execution Logic (`executeAutopurges()` in `app.js`)

Called every 30 seconds from the `cleanupAndWarn()` function:

```javascript
async function executeAutopurges(guild, now) {
  // 1. Fetch all enabled autopurge settings for the guild
  // 2. For each setting:
  //    a. Check if interval has elapsed since last purge
  //    b. Fetch recent messages from channel
  //    c. Filter by message type (bot/user/both)
  //    d. Exclude pinned messages
  //    d. Exclude messages older than 14 days (Discord API limit)
  //    e. Bulk delete up to specified line count
  //    f. Update last_purge_at timestamp
}
```

### Safety Features

1. **Pinned Message Protection**: Never deletes pinned messages
2. **Age Limit**: Won't delete messages older than 14 days (Discord API limitation)
3. **Rate Limiting**: Respects interval setting to prevent excessive API calls
4. **Permission Check**: Requires `Manage Messages` permission
5. **Channel Validation**: Only works with text/announcement channels
6. **Bulk Delete**: Uses `bulkDelete()` for efficiency (handles rate limits internally)

## Constraints

### Message Count (`lines` parameter)
- Minimum: 1
- Maximum: 100
- Deletes up to this many matching messages per purge interval

### Interval (`interval` parameter)
- Minimum: 15 minutes
- Maximum: 10,080 minutes (7 days)
- Must be at least 15 minutes to prevent spam

## Error Handling

- Missing permissions: Returns error embed
- Invalid channel type: Returns error embed
- Database errors: Logged to console, operation skipped gracefully
- API rate limits: Handled by Discord.js `bulkDelete()`

## Usage Examples

### Set up bot message cleanup in #spam channel every 30 minutes (max 50 per interval)
```
/autopurge set channel:#spam type:bot lines:50 interval:30
```

### Set up both bot and user message cleanup every 2 hours (max 100 per interval)
```
/autopurge set channel:#logs type:both lines:100 interval:120
```

### View all active auto-purge settings
```
/autopurge status
```

### Stop auto-purge in a channel (keeps the setting for later re-enable)
```
/autopurge disable channel:#spam
```

## Integration with Cleanup Cycle

The auto-purge execution is integrated into the existing 30-second cleanup cycle:

```javascript
setInterval(() => {
  cleanupAndWarn();  // Existing function
  // Now also calls executeAutopurges() internally
}, CHECK_INTERVAL_MS); // 30 seconds
```

This ensures:
- Efficient resource usage (single interval for all maintenance tasks)
- Consistent execution timing
- No conflicts with timer warning/expiration system

## Deployment Notes

1. **Database Migration**: The `autopurge_settings` table is created automatically on bot startup via `initDatabase()`
2. **No Manual Migration Required**: Existing deployments will create the table on first startup
3. **Zero Downtime**: Can be deployed with running instances (table created gracefully)
4. **Railway Compatible**: Uses standard PostgreSQL, works with Railway PostgreSQL add-on

## Monitoring

Check bot logs for purge activity:
```
[AUTOPURGE] Purged 50 bot message(s) from #spam
[AUTOPURGE] Error processing channel ...: <error details>
```

## Future Enhancements

Possible improvements:
- Whitelist specific users from auto-purge
- Exclude specific roles from purging
- Custom message content filters (e.g., only purge messages without URLs)
- Per-user purge limits
- Auto-purge statistics/analytics
