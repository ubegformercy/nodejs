// Guild Member Synchronization Service
// Periodically syncs Discord guild members to the database
// Runs in the background without blocking the main app

const db = require('./db');

// Configuration
const SYNC_INTERVAL_MS = 60 * 60 * 1000; // Sync every hour (3600000 ms)
const BATCH_SIZE = 100; // Fetch 100 members at a time to avoid rate limits
const SYNC_TIMEOUT_MS = 10 * 60 * 1000; // 10 minute timeout per guild (increased for hourly syncs)

let activeSyncs = new Map(); // Track active syncs per guild to avoid duplicates

/**
 * Sync all members of a guild to the database
 * Uses pagination to avoid rate limits
 */
async function syncGuildMembers(guild) {
  if (!guild) return false;
  
  const guildId = guild.id;
  
  // Prevent duplicate syncs
  if (activeSyncs.has(guildId)) {
    console.log(`[Guild Sync] Sync already in progress for guild ${guildId}`);
    return false;
  }
  
  try {
    activeSyncs.set(guildId, true);
    
    console.log(`[Guild Sync] Starting sync for guild ${guild.name} (${guildId})`);
    const startTime = Date.now();
    
    // Get actual guild member count
    const totalMembers = guild.memberCount || 0;
    let syncedMembers = 0;
    let lastId = undefined;
    let hasMore = true;
    
    // Fetch members in batches (Discord API pagination)
    while (hasMore) {
      try {
        // Fetch batch of members
        const members = await guild.members.fetch({
          limit: BATCH_SIZE,
          after: lastId,
          withTimestamps: false
        }).catch(err => {
          console.error(`[Guild Sync] Error fetching members for ${guildId}:`, err.message);
          return null;
        });
        
        if (!members || members.size === 0) {
          hasMore = false;
          break;
        }
        
        // Batch insert members to database (instead of individual upserts)
        const memberData = Array.from(members.values()).map(member => ({
          guild_id: guildId,
          user_id: member.user.id,
          username: member.user.username,
          display_name: member.displayName || member.user.username,
          is_bot: member.user.bot,
          avatar_url: member.user.displayAvatarURL ? member.user.displayAvatarURL({ size: 128 }) : null
        }));
        
        try {
          await db.batchUpsertGuildMembers(guildId, memberData);
          syncedMembers += memberData.length;
          
          // Update in-memory member cache for fast dashboard lookups (no API calls)
          if (!global.memberCache) {
            global.memberCache = {};
          }
          if (!global.memberCache[guildId]) {
            global.memberCache[guildId] = {};
          }
          
          Array.from(members.values()).forEach(member => {
            global.memberCache[guildId][member.id] = {
              displayName: member.displayName || member.user.username,
              presence: member.presence?.status || 'offline',
              username: member.user.username,
              avatar_url: member.user.displayAvatarURL ? member.user.displayAvatarURL({ size: 128 }) : null
            };
          });
        } catch (err) {
          console.error(`[Guild Sync] Error batch upserting members for ${guildId}:`, err.message);
        }
        
        // Update lastId for pagination
        lastId = members.last()?.user.id;
        
        // Check if we've hit the timeout
        if (Date.now() - startTime > SYNC_TIMEOUT_MS) {
          console.warn(`[Guild Sync] Timeout reached for guild ${guildId}, stopping sync`);
          hasMore = false;
        }
        
        // Small delay to be nice to Discord API
        await new Promise(resolve => setTimeout(resolve, 300));
        
      } catch (err) {
        console.error(`[Guild Sync] Batch fetch error for ${guildId}:`, err.message);
        hasMore = false;
      }
    }
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`[Guild Sync] ✓ Synced ${syncedMembers}/${totalMembers} members for ${guild.name} in ${duration}s`);
    
    return true;
  } catch (err) {
    console.error(`[Guild Sync] Fatal error syncing guild ${guildId}:`, err);
    return false;
  } finally {
    activeSyncs.delete(guildId);
  }
}

/**
 * Start background sync service
 * Syncs all guilds on a periodic interval
 */
function startBackgroundSync(discordClient) {
  if (!discordClient) {
    console.error('[Guild Sync] No Discord client provided');
    return;
  }
  
  console.log(`[Guild Sync] Starting background sync service (interval: ${SYNC_INTERVAL_MS / 1000 / 60} minutes)`);
  
  // Initial sync on startup (staggered)
  if (discordClient.guilds.cache.size > 0) {
    setTimeout(() => {
      syncAllGuilds(discordClient);
    }, 5000); // Wait 5 seconds after bot starts
  }
  
  // Periodic sync
  setInterval(() => {
    syncAllGuilds(discordClient);
  }, SYNC_INTERVAL_MS);
}

/**
 * Sync all guilds the bot is in
 */
async function syncAllGuilds(discordClient) {
  if (!discordClient || discordClient.guilds.cache.size === 0) {
    console.log('[Guild Sync] No guilds to sync');
    return;
  }
  
  console.log(`[Guild Sync] Starting sync for ${discordClient.guilds.cache.size} guilds`);
  
  const startTime = Date.now();
  let successCount = 0;
  
  // Process each guild with a delay to avoid overwhelming the system
  for (const [guildId, guild] of discordClient.guilds.cache) {
    try {
      const result = await syncGuildMembers(guild);
      if (result) successCount++;
      
      // Stagger the syncs (small delay between guilds)
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (err) {
      console.error(`[Guild Sync] Error syncing guild ${guildId}:`, err.message);
    }
  }
  
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`[Guild Sync] ✓ Completed sync cycle: ${successCount}/${discordClient.guilds.cache.size} guilds synced in ${duration}s`);
}

/**
 * Force sync a specific guild
 */
async function forceSyncGuild(guildId, discordClient) {
  try {
    const guild = discordClient.guilds.cache.get(guildId);
    if (!guild) {
      console.error(`[Guild Sync] Guild ${guildId} not found`);
      return false;
    }
    
    console.log(`[Guild Sync] Force syncing guild ${guild.name}`);
    return await syncGuildMembers(guild);
  } catch (err) {
    console.error(`[Guild Sync] Error force syncing guild ${guildId}:`, err);
    return false;
  }
}

/**
 * Get member count in database cache
 */
async function getCachedMemberCount(guildId) {
  try {
    const result = await db.query(
      'SELECT COUNT(*) as count FROM guild_members_cache WHERE guild_id = $1',
      [guildId]
    );
    return parseInt(result.rows[0].count);
  } catch (err) {
    console.error('[Guild Sync] Error getting cached member count:', err);
    return 0;
  }
}

/**
 * Get sync status for a guild
 */
async function getSyncStatus(guildId) {
  try {
    const count = await getCachedMemberCount(guildId);
    const lastSync = await db.getLastSyncTime(guildId);
    
    return {
      guildId,
      cachedMemberCount: count,
      lastSyncTime: lastSync,
      isSyncing: activeSyncs.has(guildId)
    };
  } catch (err) {
    console.error('[Guild Sync] Error getting sync status:', err);
    return null;
  }
}

module.exports = {
  startBackgroundSync,
  syncGuildMembers,
  syncAllGuilds,
  forceSyncGuild,
  getCachedMemberCount,
  getSyncStatus,
  SYNC_INTERVAL_MS,
  BATCH_SIZE
};
