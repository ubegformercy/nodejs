// Dashboard API Routes
const express = require('express');
const router = express.Router();
const db = require('../db');

/**
 * Middleware to verify user is authenticated
 */
function requireAuth(req, res, next) {
  try {
    const authCookie = req.cookies.boostmon_auth;
    console.log(`[Auth] Checking auth cookie for ${req.path}:`, authCookie ? 'present' : 'missing');
    if (!authCookie) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    req.user = JSON.parse(authCookie);
    console.log(`[Auth] User authenticated: ${req.user.userId}`);
    next();
  } catch (err) {
    console.error(`[Auth] Error parsing session:`, err.message);
    return res.status(401).json({ error: 'Invalid session' });
  }
}

/**
 * Middleware to verify user has access to the requested guild
 */
function requireGuildAccess(req, res, next) {
  const guildId = req.query.guildId;
  
  if (!guildId) {
    return res.status(400).json({ error: 'Guild ID required' });
  }

  // Check if user's authorized guilds include this guildId
  const userGuilds = req.user.guilds || [];
  const hasAccess = userGuilds.some(g => g.id === guildId);

  if (!hasAccess) {
    console.warn(`Unauthorized guild access attempt: userId=${req.user.userId}, guildId=${guildId}, authorizedGuilds=${userGuilds.map(g => g.id).join(',')}`);
    return res.status(403).json({ 
      error: 'Unauthorized guild access',
      message: 'You do not have permission to access this guild'
    });
  }

  req.guildId = guildId;
  next();
}

/**
 * Middleware to verify user has permission to access the dashboard
 * Owner and Admins always have access
 * Others must have a role with dashboard access granted
 */
async function requireDashboardAccess(req, res, next) {
  const guildId = req.guildId;
  const userId = req.user.userId;

  try {
    // Fetch member info from Discord
    const guild = global.botClient?.guilds?.cache?.get(guildId);
    if (!guild) {
      return res.status(500).json({ error: 'Guild not found' });
    }

    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) {
      return res.status(403).json({ error: 'Could not verify member status' });
    }

    // Check dashboard access
    const hasAccess = await db.hasDashboardAccess(guildId, member);
    if (!hasAccess) {
      console.warn(`Dashboard access denied: userId=${userId}, guildId=${guildId}`);
      return res.status(403).json({ 
        error: 'Dashboard access denied',
        message: 'You do not have permission to access this guild dashboard'
      });
    }

    req.member = member;
    next();
  } catch (err) {
    console.error(`[DashboardAccess] Error:`, err.message);
    return res.status(500).json({ error: 'Permission check failed' });
  }
}

// Helper function to resolve Discord IDs to names
async function resolveUserName(client, userId) {
  try {
    const user = await client.users.fetch(userId);
    return user.username || userId;
  } catch (err) {
    console.error(`Failed to resolve user ${userId}:`, err.message);
    return `Unknown (${userId})`;
  }
}

async function resolveRoleName(guild, roleId) {
  try {
    if (!guild) return `Unknown (${roleId})`;
    const role = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId);
    return role?.name || `Unknown (${roleId})`;
  } catch (err) {
    console.error(`Failed to resolve role ${roleId}:`, err.message);
    return `Unknown (${roleId})`;
  }
}

async function resolveChannelName(guild, channelId) {
  try {
    if (!guild) return `Unknown (${channelId})`;
    const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId);
    return channel?.name || `Unknown (${channelId})`;
  } catch (err) {
    console.error(`Failed to resolve channel ${channelId}:`, err.message);
    return `Unknown (${channelId})`;
  }
}

/**
 * GET /api/dashboard
 * Returns stats and data for the dashboard
 * Query params:
 *   - guildId: Discord Guild ID (required, must be user's authorized guild)
 * 
 * Protected: Requires authentication and guild membership
 */
router.get('/api/dashboard', requireAuth, requireGuildAccess, requireDashboardAccess, async (req, res) => {
  try {
    const guildId = req.guildId;
    
    // Import Discord client to get guild data
    let client = null;
    let guild = null;
    
    try {
      // Try to get the main bot client if guildId provided
      if (guildId && global.botClient) {
        client = global.botClient;
        guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId);
      }
    } catch (err) {
      console.warn('Could not fetch guild:', err.message);
      // Continue without guild data - will display IDs instead
    }

    // Build a cache of role/channel names to avoid repeated Discord API calls
    const nameCache = {
      users: new Map(),
      roles: new Map(),
      channels: new Map()
    };

    // Pre-populate cache from guild cache
    if (guild) {
      // Cache all roles
      guild.roles.cache.forEach(role => {
        nameCache.roles.set(role.id, role.name);
      });
      // Cache all channels
      guild.channels.cache.forEach(channel => {
        nameCache.channels.set(channel.id, channel.name);
      });
    }

    // Get timers for this guild only
    let allTimers = [];
    try {
      // First, try to get timers where guild_id is explicitly set
      let result = await db.pool.query(
        `SELECT * FROM role_timers WHERE guild_id = $1 AND expires_at > 0 ORDER BY expires_at ASC`,
        [guildId]
      );
      allTimers = result.rows || [];
      
      // If we got timers, we're good. If not, also check for NULL guild_id timers
      // that might belong to this guild (legacy timers that haven't been backfilled)
      if (allTimers.length === 0 && guild) {
        console.log(`[Dashboard] No timers found with guild_id = ${guildId}, checking for legacy timers...`);
        
        // Get all guild role IDs for this guild
        const guildRoleIds = new Set(guild.roles.cache.keys());
        
        // Get ALL timers with NULL guild_id and filter by role
        const legacyResult = await db.pool.query(
          `SELECT * FROM role_timers WHERE guild_id IS NULL AND expires_at > 0 ORDER BY expires_at ASC`
        );
        
        const legacyTimers = legacyResult.rows || [];
        
        // Filter to only timers with roles in this guild
        const matchingLegacyTimers = legacyTimers.filter(timer => guildRoleIds.has(timer.role_id));
        
        if (matchingLegacyTimers.length > 0) {
          console.log(`[Dashboard] Found ${matchingLegacyTimers.length} legacy timers (guild_id = NULL) with roles in this guild`);
          // Backfill guild_id for these timers
          try {
            await db.pool.query(
              `UPDATE role_timers SET guild_id = $1 WHERE guild_id IS NULL AND role_id = ANY($2::varchar[])`,
              [guildId, Array.from(guildRoleIds)]
            );
            console.log(`[Dashboard] ✓ Backfilled guild_id for legacy timers`);
          } catch (err) {
            console.error('[Dashboard] Error backfilling guild_id:', err.message);
          }
          allTimers = matchingLegacyTimers;
        }
      }
    } catch (err) {
      console.error('Error fetching timers:', err);
    }
    
    // Get role status schedules for this guild only
    let schedules = [];
    try {
      const result = await db.pool.query(
        `SELECT * FROM rolestatus_schedules WHERE guild_id = $1 AND enabled = true ORDER BY created_at DESC`,
        [guildId]
      );
      schedules = result.rows || [];
    } catch (err) {
      console.error('Error fetching schedules:', err);
      schedules = [];
    }

    // Get autopurge settings for this guild only
    let autopurges = [];
    try {
      const result = await db.pool.query(
        `SELECT * FROM autopurge_settings WHERE guild_id = $1 AND enabled = true ORDER BY created_at DESC`,
        [guildId]
      );
      autopurges = result.rows || [];
    } catch (err) {
      console.error('Error fetching autopurges:', err);
      autopurges = [];
    }

    // Helper function to resolve name from cache with fallback
    async function getUserName(userId) {
      if (nameCache.users.has(userId)) {
        return nameCache.users.get(userId);
      }
      
      let userName = `Unknown (${userId})`;
      if (client) {
        try {
          const user = await Promise.race([
            client.users.fetch(userId),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 2000))
          ]);
          userName = user.username || userId;
          nameCache.users.set(userId, userName);
        } catch (err) {
          // Use fallback
        }
      }
      return userName;
    }

    function getRoleName(roleId) {
      if (nameCache.roles.has(roleId)) {
        return nameCache.roles.get(roleId);
      }
      return `Unknown (${roleId})`;
    }

    function getChannelName(channelId) {
      if (nameCache.channels.has(channelId)) {
        return nameCache.channels.get(channelId);
      }
      return `Unknown (${channelId})`;
    }

    // Format timers for display with cached name resolution
    const formattedTimers = await Promise.all(
      (allTimers || []).map(async (timer) => {
        const remaining = Math.max(0, Number(timer.expires_at) - Date.now());
        const hours = Math.floor(remaining / (1000 * 60 * 60));
        const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((remaining % (1000 * 60)) / 1000);

        // Use cached names (only fetch from Discord if not in cache)
        const userName = await getUserName(timer.user_id);
        const roleName = getRoleName(timer.role_id);

        // Get member display name and presence from fast in-memory cache (no API calls)
        let displayName = userName;
        let presence = 'offline';
        
        // Try in-memory cache first (populated by guild-member-sync)
        const cachedMember = global.memberCache?.[guildId]?.[timer.user_id];
        if (cachedMember) {
          displayName = cachedMember.displayName || userName;
          presence = cachedMember.presence || 'offline';
        } else {
          // Fallback: try to get from Discord cache (no async wait)
          try {
            const guild = global.botClient?.guilds?.cache?.get(guildId);
            if (guild) {
              const member = guild.members.cache.get(timer.user_id);
              if (member) {
                displayName = member.displayName || userName;
                presence = member.presence?.status || 'offline';
              }
            }
          } catch (err) {
            // Silently fall back to userName and offline
          }
        }

        return {
          id: timer.id,
          user: userName,
          userId: timer.user_id,
          displayName: displayName,
          presence: presence,
          role: roleName,
          roleId: timer.role_id,
          remaining: remaining,
          formattedTime: `${hours}h ${minutes}m ${seconds}s`,
          expiresAt: timer.expires_at,
          paused: timer.paused,
        };
      })
    ).then(timers => timers.filter(t => t !== null && t !== undefined));

    // Format schedules for display with cached name resolution
    const formattedSchedules = (schedules || []).map((schedule) => {
      const lastReport = schedule.last_report_at 
        ? new Date(schedule.last_report_at).toLocaleString()
        : 'Never';
      
      const nextReportMs = schedule.last_report_at 
        ? new Date(schedule.last_report_at).getTime() + (schedule.interval_minutes * 60 * 1000)
        : Date.now() + (schedule.interval_minutes * 60 * 1000);
      
      const nextReport = new Date(nextReportMs).toLocaleString();

      // Use cached names (no async calls needed)
      const roleName = getRoleName(schedule.role_id);
      const channelName = getChannelName(schedule.channel_id);

      return {
        id: schedule.id,
        role: roleName,
        roleId: schedule.role_id,
        channel: channelName,
        channelId: schedule.channel_id,
        interval: schedule.interval_minutes,
        lastReport: lastReport,
        nextReport: nextReport,
      };
    }).filter(s => s !== null && s !== undefined);

    // Format autopurge settings for display with cached name resolution
    const formattedAutopurge = (autopurges || []).map((setting) => {
      const lastPurge = setting.last_purge_at
        ? new Date(setting.last_purge_at).toLocaleString()
        : 'Never';

      // Use cached name (no async calls needed)
      const channelName = getChannelName(setting.channel_id);

      return {
        id: setting.id,
        channel: channelName,
        channelId: setting.channel_id,
        type: setting.type,
        lines: setting.lines,
        interval: Math.ceil(setting.interval_seconds / 60),
        lastPurge: lastPurge,
      };
    }).filter(a => a !== null && a !== undefined);

    console.log('Dashboard data loaded:', {
      timersCount: formattedTimers.length,
      schedulesCount: formattedSchedules.length,
      autopurgesCount: formattedAutopurge.length,
      guildId: guildId || 'none',
    });

    // Build response
    const response = {
      botStatus: 'online',
      stats: {
        activeTimers: formattedTimers.length,
        scheduledReports: formattedSchedules.length,
        autopurgeSettings: formattedAutopurge.length,
      },
      timers: formattedTimers,
      reports: formattedSchedules,
      autopurge: formattedAutopurge,
      timestamp: new Date().toISOString(),
      guildId: guildId,
    };

    res.json(response);
  } catch (err) {
    console.error('Dashboard API error:', err);
    res.status(500).json({
      error: 'Failed to load dashboard data',
      details: err.message,
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * POST /api/timer/add
 * Create a new timer entry
 * 
 * Body:
 *   - userId: Discord user ID (required)
 *   - roleId: Discord role ID (required)
 *   - minutes: Timer duration in minutes (required)
 *   - channelId: Discord channel ID for warnings (optional, defaults to DM)
 * 
 * Query params:
 *   - guildId: Discord Guild ID (required)
 * 
 * Protected: Requires authentication and guild access
 */
router.post('/api/timer/add', requireAuth, requireGuildAccess, requireDashboardAccess, async (req, res) => {
  try {
    const { userId, roleId, minutes, channelId } = req.body;
    const guildId = req.guildId;

    // Validation
    if (!userId || !roleId || !minutes || minutes <= 0) {
      return res.status(400).json({ 
        error: 'Missing required fields: userId, roleId, and positive minutes' 
      });
    }

    const expiresAt = Date.now() + (minutes * 60 * 1000);

    // Check if timer already exists for this user/role
    const existing = await db.pool.query(
      `SELECT id FROM role_timers WHERE user_id = $1 AND role_id = $2 AND guild_id = $3`,
      [userId, roleId, guildId]
    );

    let result;
    if (existing.rows.length > 0) {
      // Update existing timer
      result = await db.pool.query(
        `UPDATE role_timers 
         SET expires_at = $1, warn_channel_id = $2, paused = false, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $3 AND role_id = $4 AND guild_id = $5
         RETURNING *`,
        [expiresAt, channelId || null, userId, roleId, guildId]
      );
    } else {
      // Create new timer
      result = await db.pool.query(
        `INSERT INTO role_timers (user_id, role_id, expires_at, warn_channel_id, guild_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [userId, roleId, expiresAt, channelId || null, guildId]
      );
    }

    res.json({ 
      success: true, 
      timer: result.rows[0],
      message: `Timer ${existing.rows.length > 0 ? 'updated' : 'created'} successfully`
    });
  } catch (err) {
    console.error('Error adding timer:', err);
    res.status(500).json({ error: 'Failed to add timer', details: err.message });
  }
});

/**
 * PATCH /api/timer/update
 * Update timer expiration time
 * 
 * Body:
 *   - timerId: Timer ID (required)
 *   - minutes: New duration in minutes (required)
 * 
 * Query params:
 *   - guildId: Discord Guild ID (required)
 * 
 * Protected: Requires authentication and guild access
 */
router.patch('/api/timer/update', requireAuth, requireGuildAccess, requireDashboardAccess, async (req, res) => {
  try {
    const { timerId, minutes } = req.body;
    const guildId = req.guildId;

    // Validation
    if (!timerId || !minutes || minutes <= 0) {
      return res.status(400).json({ 
        error: 'Missing required fields: timerId and positive minutes' 
      });
    }

    const expiresAt = Date.now() + (minutes * 60 * 1000);

    const result = await db.pool.query(
      `UPDATE role_timers 
       SET expires_at = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND guild_id = $3
       RETURNING *`,
      [expiresAt, timerId, guildId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Timer not found' });
    }

    res.json({ 
      success: true, 
      timer: result.rows[0],
      message: 'Timer updated successfully'
    });
  } catch (err) {
    console.error('Error updating timer:', err);
    res.status(500).json({ error: 'Failed to update timer', details: err.message });
  }
});

/**
 * DELETE /api/timer/delete
 * Delete a timer entry
 * 
 * Body:
 *   - timerId: Timer ID (required)
 * 
 * Query params:
 *   - guildId: Discord Guild ID (required)
 * 
 * Protected: Requires authentication and guild access
 */
router.delete('/api/timer/delete', requireAuth, requireGuildAccess, requireDashboardAccess, async (req, res) => {
  try {
    console.log('[DELETE] Received delete request');
    console.log('[DELETE] Request headers:', req.headers);
    console.log('[DELETE] Request body:', req.body);
    console.log('[DELETE] Request method:', req.method);
    
    const { timerId } = req.body;
    const guildId = req.guildId;

    console.log(`[DELETE] timerId: ${timerId}, guildId: ${guildId}`);

    // Validation
    if (!timerId) {
      console.log('[DELETE] Error: timerId is missing');
      return res.status(400).json({ error: 'Timer ID is required' });
    }

    console.log('[DELETE] Executing query to delete timer');
    const result = await db.pool.query(
      `DELETE FROM role_timers 
       WHERE id = $1 AND guild_id = $2
       RETURNING id`,
      [timerId, guildId]
    );

    console.log(`[DELETE] Query result: ${result.rows.length} rows affected`);

    if (result.rows.length === 0) {
      console.log('[DELETE] Timer not found in database');
      return res.status(404).json({ error: 'Timer not found' });
    }

    console.log('[DELETE] Timer deleted successfully');
    res.json({ 
      success: true, 
      message: 'Timer deleted successfully'
    });
  } catch (err) {
    console.error('[DELETE] Error deleting timer:', err);
    console.error('[DELETE] Error stack:', err.stack);
    res.status(500).json({ error: 'Failed to delete timer', details: err.message });
  }
});

/**
 * POST /api/timer/pause-toggle
 * Toggle pause/resume state for a timer
 * Body:
 *   - userId: Discord User ID (required)
 *   - roleId: Discord Role ID (required)
 *   - guildId: Discord Guild ID (passed via query/middleware)
 * 
 * Returns the new pause state and remaining time
 * Protected: Requires authentication and guild access
 */
router.post('/api/timer/pause-toggle', requireAuth, requireGuildAccess, requireDashboardAccess, async (req, res) => {
  try {
    console.log('[PAUSE-TOGGLE] Received pause-toggle request');
    
    const { userId, roleId } = req.body;
    const guildId = req.guildId;

    console.log(`[PAUSE-TOGGLE] userId: ${userId}, roleId: ${roleId}, guildId: ${guildId}`);

    // Validation
    if (!userId || !roleId) {
      console.log('[PAUSE-TOGGLE] Error: userId or roleId is missing');
      return res.status(400).json({ error: 'User ID and Role ID are required' });
    }

    // Get current timer state
    const timerResult = await db.getTimerForRole(userId, roleId);
    if (!timerResult) {
      console.log('[PAUSE-TOGGLE] Timer not found');
      return res.status(404).json({ error: 'Timer not found' });
    }

    let newExpiresAt;
    if (timerResult.paused) {
      // Timer is paused, resume it
      console.log('[PAUSE-TOGGLE] Resuming timer');
      newExpiresAt = await db.resumeTimer(userId, roleId);
    } else {
      // Timer is active, pause it
      console.log('[PAUSE-TOGGLE] Pausing timer');
      await db.pauseTimer(userId, roleId);
    }

    // Get updated timer state
    const updatedTimer = await db.getTimerForRole(userId, roleId);
    
    console.log('[PAUSE-TOGGLE] Timer toggled successfully');
    res.json({
      success: true,
      paused: updatedTimer.paused,
      remainingMs: updatedTimer.paused ? updatedTimer.paused_remaining_ms : (updatedTimer.expires_at - Date.now()),
      formattedTime: formatDuration(updatedTimer.paused ? updatedTimer.paused_remaining_ms : (updatedTimer.expires_at - Date.now()))
    });
  } catch (err) {
    console.error('[PAUSE-TOGGLE] Error toggling pause:', err);
    console.error('[PAUSE-TOGGLE] Error stack:', err.stack);
    res.status(500).json({ error: 'Failed to toggle pause state', details: err.message });
  }
});

/**
 * Helper function to format duration in milliseconds to readable string
 */
function formatDuration(ms) {
  if (ms <= 0) return '0s';
  
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  
  const parts = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0) parts.push(`${seconds}s`);
  
  return parts.length > 0 ? parts.join(' ') : '0s';
}

/**
 * GET /api/dropdown-data
 * Get available users, roles, and channels for form dropdowns
 * Uses CACHED Discord data only (no network fetches to avoid timeouts)
 * Query params:
 *   - guildId: Discord Guild ID (required)
 * 
 * Returns:
 *   - users: Array of { id, name } (from cached members)
 *   - roles: Array of { id, name } (all roles in guild)
 *   - channels: Array of { id, name } (all text channels in guild)
 * 
 * Protected: Requires authentication and guild access
 */
router.get('/api/dropdown-data', requireAuth, requireGuildAccess, requireDashboardAccess, async (req, res) => {
  try {
    const guildId = req.guildId;
    let guild = null;
    const data = {
      users: [],
      roles: [],
      channels: []
    };

    // Get guild from Discord client cache only (no fetch to avoid timeouts)
    if (global.botClient) {
      guild = global.botClient.guilds.cache.get(guildId);
      if (!guild) {
        return res.status(400).json({ error: 'Guild not in bot cache' });
      }
    } else {
      return res.status(500).json({ error: 'Discord client not available' });
    }

    // Get users from guild member cache (database, synced from Discord periodically)
    try {
      if (guild) {
        // Get members from the database cache (fast, no Discord API calls)
        const cachedMembers = await db.getGuildMembers(guildId);
        
        if (cachedMembers && cachedMembers.length > 0) {
          // Use cached members
          data.users = cachedMembers.map(member => ({
            id: member.id,
            name: member.name,
            displayName: member.displayName || member.name,
            userType: 'member',
            status: 'offline', // We don't track status in cache, keep it simple
            isBot: member.isBot,
            source: 'cached'
          })).sort((a, b) => a.displayName.localeCompare(b.displayName));
          
          console.log(`[Dropdown] Loaded ${data.users.length} users from database cache for guild ${guildId}`);
        } else {
          // If cache is empty, fall back to live Discord cache (happens on first sync)
          const discordMembers = Array.from(guild.members.cache.values())
            .filter(m => !m.user.bot)
            .map(m => ({
              id: m.user.id,
              name: m.user.username,
              displayName: m.displayName || m.user.username,
              userType: 'member',
              status: m.user.presence?.status || 'offline',
              isBot: false,
              source: 'live-cache'
            }))
            .sort((a, b) => a.displayName.localeCompare(b.displayName));
          
          data.users = discordMembers;
          console.log(`[Dropdown] Cache empty, loaded ${data.users.length} users from live Discord cache`);
        }
        
        // Also add users who have active timers but might not be in the guild anymore
        try {
          const timerUsers = await db.query(
            `SELECT DISTINCT user_id FROM role_timers WHERE guild_id = $1`,
            [guildId]
          );
          
          const userMap = new Map();
          data.users.forEach(u => userMap.set(u.id, u));
          
          timerUsers.rows.forEach(row => {
            if (!userMap.has(row.user_id)) {
              userMap.set(row.user_id, {
                id: row.user_id,
                name: row.user_id,
                displayName: row.user_id,
                userType: 'member',
                status: 'offline',
                isBot: false,
                source: 'timer-archive'
              });
            }
          });
          
          data.users = Array.from(userMap.values())
            .sort((a, b) => a.displayName.localeCompare(b.displayName));
          
          console.log(`[Dropdown] Added ${timerUsers.rows.length} archived timer users`);
        } catch (dbErr) {
          console.warn('Could not fetch timer users:', dbErr.message);
        }
      }
    } catch (err) {
      console.error('Error loading guild members:', err);
      data.users = [];
    }

    // Get all roles in the guild
    try {
      if (guild) {
        data.roles = guild.roles.cache
          .filter(r => r.id !== guildId) // Exclude @everyone role
          .map(r => ({
            id: r.id,
            name: r.name
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
      }
    } catch (err) {
      console.error('Error processing guild roles:', err);
      data.roles = [];
    }

    // Get all text channels in the guild
    try {
      if (guild) {
        data.channels = guild.channels.cache
          .filter(c => c.isTextBased())
          .map(c => ({
            id: c.id,
            name: c.name
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
      }
    } catch (err) {
      console.error('Error processing guild channels:', err);
      data.channels = [];
    }

    console.log(`[Dropdown] Serving ${data.users.length} users, ${data.roles.length} roles, ${data.channels.length} channels for guild ${guildId}`);
    res.json(data);
  } catch (err) {
    console.error('Error fetching dropdown data:', err);
    res.status(500).json({ error: 'Failed to fetch dropdown data', details: err.message });
  }
});

// Advanced Search - Search for user by ID or username
router.post('/api/search-user', requireAuth, async (req, res) => {
  try {
    const { query: searchQuery, guildId } = req.body;

    if (!searchQuery || !guildId) {
      return res.status(400).json({ error: 'Search query and guildId required' });
    }

    const client = req.app.get('discord-client');
    if (!client) {
      return res.status(500).json({ error: 'Discord client not available' });
    }

    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      return res.status(400).json({ error: 'Guild not found' });
    }

    let user = null;
    let foundUser = null;

    // Check if it's a Discord ID (18-20 digits)
    if (/^\d{18,20}$/.test(searchQuery)) {
      try {
        // Try to fetch from Discord API
        user = await client.users.fetch(searchQuery);
      } catch (err) {
        return res.status(404).json({ error: 'User not found in Discord' });
      }

      // Check if user is in the guild
      try {
        const guildMember = await guild.members.fetch(searchQuery);
        foundUser = {
          id: guildMember.user.id,
          name: guildMember.user.username,
          displayName: guildMember.displayName || guildMember.user.username,
          isBot: guildMember.user.bot,
          status: guildMember.user.presence?.status || 'offline',
          source: 'discord-fetch'
        };
      } catch (err) {
        // User exists in Discord but not in this guild
        foundUser = {
          id: user.id,
          name: user.username,
          displayName: user.username,
          isBot: user.bot,
          status: 'offline',
          source: 'discord-fetch',
          notInGuild: true
        };
      }
    } else {
      // Search by username in database cache first (fast lookup)
      const cachedUsers = await db.searchGuildMembers(guildId, searchQuery);
      
      if (cachedUsers && cachedUsers.length > 0) {
        const match = cachedUsers[0]; // Return first match
        foundUser = {
          id: match.id,
          name: match.name,
          displayName: match.displayName || match.name,
          isBot: match.isBot,
          status: 'offline',
          source: 'cached'
        };
      } else {
        // Fall back to live Discord cache (for recently joined members not yet synced)
        const members = Array.from(guild.members.cache.values());
        const match = members.find(m => 
          m.user.username.toLowerCase() === searchQuery.toLowerCase() ||
          m.displayName.toLowerCase() === searchQuery.toLowerCase() ||
          m.user.username.toLowerCase().includes(searchQuery.toLowerCase())
        );

        if (match) {
          foundUser = {
            id: match.user.id,
            name: match.user.username,
            displayName: match.displayName || match.user.username,
            isBot: match.user.bot,
            status: match.user.presence?.status || 'offline',
            source: 'live-cache'
          };
        } else {
          // Try to search in timer history
          try {
            const dbResult = await db.query(
              `SELECT DISTINCT user_id FROM role_timers WHERE guild_id = $1 AND user_id = $2`,
              [guildId, searchQuery]
            );

            if (dbResult.rows.length > 0) {
              const row = dbResult.rows[0];
              foundUser = {
                id: row.user_id,
                name: row.user_id,
                displayName: row.user_id,
                isBot: false,
                status: 'offline',
                source: 'timer-history'
              };
            }
          } catch (dbErr) {
            console.warn('Database search error:', dbErr.message);
          }
        }
      }
    }

    if (!foundUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(foundUser);
  } catch (err) {
    console.error('Error searching user:', err);
    res.status(500).json({ error: 'Search failed', details: err.message });
  }
});

// Get member count for a guild
router.get('/api/guild-member-count', requireAuth, async (req, res) => {
  try {
    const { guildId } = req.query;
    
    if (!guildId) {
      return res.status(400).json({ error: 'guildId required' });
    }
    
    const result = await db.query(
      'SELECT COUNT(*) as count FROM guild_members_cache WHERE guild_id = $1',
      [guildId]
    );
    
    const count = parseInt(result.rows[0].count);
    
    res.json({
      guildId,
      memberCount: count,
      lastUpdated: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error getting member count:', err);
    res.status(500).json({ error: 'Failed to get member count', details: err.message });
  }
});

// ============================================
// SCHEDULED REPORTS MANAGEMENT ENDPOINTS
// ============================================

/**
 * POST /api/report/add
 * Create a new scheduled report
 * 
 * Body:
 *   - roleId: Discord role ID (required)
 *   - channelId: Discord channel ID for reports (required)
 *   - intervalMinutes: Report interval in minutes (required)
 * 
 * Query params:
 *   - guildId: Discord Guild ID (required)
 */
router.post('/api/report/add', requireAuth, requireGuildAccess, requireDashboardAccess, async (req, res) => {
  try {
    const { roleId, channelId, intervalMinutes } = req.body;
    const guildId = req.guildId;

    // Validation
    if (!roleId || !channelId || !intervalMinutes || intervalMinutes <= 0) {
      return res.status(400).json({
        error: 'Missing required fields: roleId, channelId, and positive intervalMinutes'
      });
    }

    // Check if report already exists for this role/channel combination
    const existing = await db.pool.query(
      `SELECT id FROM rolestatus_schedules WHERE guild_id = $1 AND role_id = $2 AND channel_id = $3`,
      [guildId, roleId, channelId]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({
        error: 'A scheduled report already exists for this role and channel combination'
      });
    }

    // Create new scheduled report
    const result = await db.pool.query(
      `INSERT INTO rolestatus_schedules (guild_id, role_id, channel_id, interval_minutes, enabled)
       VALUES ($1, $2, $3, $4, true)
       RETURNING *`,
      [guildId, roleId, channelId, intervalMinutes]
    );

    res.json({
      success: true,
      report: result.rows[0],
      message: 'Scheduled report created successfully'
    });
  } catch (err) {
    console.error('Error adding scheduled report:', err);
    res.status(500).json({ error: 'Failed to add scheduled report', details: err.message });
  }
});

/**
 * PATCH /api/report/update
 * Update a scheduled report
 * 
 * Body:
 *   - reportId: Report ID (required)
 *   - intervalMinutes: New interval in minutes (required)
 * 
 * Query params:
 *   - guildId: Discord Guild ID (required)
 */
router.patch('/api/report/update', requireAuth, requireGuildAccess, requireDashboardAccess, async (req, res) => {
  try {
    const { reportId, intervalMinutes } = req.body;
    const guildId = req.guildId;

    // Validation
    if (!reportId || !intervalMinutes || intervalMinutes <= 0) {
      return res.status(400).json({
        error: 'Missing required fields: reportId and positive intervalMinutes'
      });
    }

    const result = await db.pool.query(
      `UPDATE rolestatus_schedules
       SET interval_minutes = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND guild_id = $3
       RETURNING *`,
      [intervalMinutes, reportId, guildId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Scheduled report not found' });
    }

    res.json({
      success: true,
      report: result.rows[0],
      message: 'Scheduled report updated successfully'
    });
  } catch (err) {
    console.error('Error updating scheduled report:', err);
    res.status(500).json({ error: 'Failed to update scheduled report', details: err.message });
  }
});

/**
 * DELETE /api/report/delete
 * Delete a scheduled report
 * 
 * Body:
 *   - reportId: Report ID (required)
 * 
 * Query params:
 *   - guildId: Discord Guild ID (required)
 */
router.delete('/api/report/delete', requireAuth, requireGuildAccess, requireDashboardAccess, async (req, res) => {
  try {
    const { reportId } = req.body;
    const guildId = req.guildId;

    // Validation
    if (!reportId) {
      return res.status(400).json({ error: 'Report ID is required' });
    }

    const result = await db.pool.query(
      `DELETE FROM rolestatus_schedules
       WHERE id = $1 AND guild_id = $2
       RETURNING id`,
      [reportId, guildId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Scheduled report not found' });
    }

    res.json({
      success: true,
      message: 'Scheduled report deleted successfully'
    });
  } catch (err) {
    console.error('Error deleting scheduled report:', err);
    res.status(500).json({ error: 'Failed to delete scheduled report', details: err.message });
  }
});

/**
 * GET /api/reports
 * Get all scheduled reports for a guild
 * 
 * Query params:
 *   - guildId: Discord Guild ID (required)
 */
router.get('/api/reports', requireAuth, requireGuildAccess, requireDashboardAccess, async (req, res) => {
  try {
    const guildId = req.guildId;

    const result = await db.pool.query(
      `SELECT * FROM rolestatus_schedules WHERE guild_id = $1 ORDER BY created_at DESC`,
      [guildId]
    );

    res.json({
      success: true,
      reports: result.rows,
      count: result.rows.length
    });
  } catch (err) {
    console.error('Error fetching scheduled reports:', err);
    res.status(500).json({ error: 'Failed to fetch scheduled reports', details: err.message });
  }
});

// ============================================
// AUTO-PURGE SETTINGS MANAGEMENT ENDPOINTS
// ============================================

/**
 * POST /api/autopurge/add
 * Create a new auto-purge setting
 * 
 * Body:
 *   - channelId: Discord channel ID (required)
 *   - type: Purge type - 'all', 'bots', or 'embeds' (required)
 *   - lines: Number of messages to auto-purge per interval (required)
 *   - intervalMinutes: Purge interval in minutes (required)
 * 
 * Query params:
 *   - guildId: Discord Guild ID (required)
 */
router.post('/api/autopurge/add', requireAuth, requireGuildAccess, requireDashboardAccess, async (req, res) => {
  try {
    const { channelId, type, lines, intervalMinutes } = req.body;
    const guildId = req.guildId;

    // Validation
    if (!channelId || !type || !lines || !intervalMinutes) {
      return res.status(400).json({
        error: 'Missing required fields: channelId, type, lines, and intervalMinutes'
      });
    }

    if (!['all', 'bots', 'embeds'].includes(type)) {
      return res.status(400).json({
        error: 'Invalid type. Must be one of: all, bots, embeds'
      });
    }

    if (lines <= 0 || intervalMinutes <= 0) {
      return res.status(400).json({
        error: 'Lines and interval must be positive numbers'
      });
    }

    // Check if autopurge already exists and is enabled for this channel
    const existing = await db.pool.query(
      `SELECT id, enabled FROM autopurge_settings WHERE guild_id = $1 AND channel_id = $2`,
      [guildId, channelId]
    );

    if (existing.rows.length > 0) {
      const setting = existing.rows[0];
      
      // If it exists and is enabled, reject
      if (setting.enabled) {
        return res.status(409).json({
          error: 'An auto-purge setting already exists for this channel'
        });
      }
      
      // If it exists but is disabled, update it instead of creating new
      const result = await db.pool.query(
        `UPDATE autopurge_settings 
         SET type = $1, lines = $2, interval_seconds = $3, enabled = true, updated_at = CURRENT_TIMESTAMP
         WHERE id = $4
         RETURNING *`,
        [type, lines, intervalMinutes * 60, setting.id]
      );

      return res.json({
        success: true,
        setting: result.rows[0],
        message: 'Auto-purge setting re-enabled successfully'
      });
    }

    // Create new autopurge setting
    const result = await db.pool.query(
      `INSERT INTO autopurge_settings (guild_id, channel_id, type, lines, interval_seconds, enabled)
       VALUES ($1, $2, $3, $4, $5, true)
       RETURNING *`,
      [guildId, channelId, type, lines, intervalMinutes * 60]
    );

    res.json({
      success: true,
      setting: result.rows[0],
      message: 'Auto-purge setting created successfully'
    });
  } catch (err) {
    console.error('Error adding auto-purge setting:', err);
    res.status(500).json({ error: 'Failed to add auto-purge setting', details: err.message });
  }
});

/**
 * PATCH /api/autopurge/update
 * Update an auto-purge setting
 * 
 * Body:
 *   - channelId: Discord channel ID (required)
 *   - lines: New number of messages to auto-purge per interval (optional)
 *   - intervalMinutes: New interval in minutes (optional)
 * 
 * Query params:
 *   - guildId: Discord Guild ID (required)
 */
router.patch('/api/autopurge/update', requireAuth, requireGuildAccess, requireDashboardAccess, async (req, res) => {
  try {
    const { channelId, lines, intervalMinutes } = req.body;
    const guildId = req.guildId;

    // Validation
    if (!channelId) {
      return res.status(400).json({
        error: 'Channel ID is required'
      });
    }

    if (lines !== undefined && lines <= 0) {
      return res.status(400).json({
        error: 'Lines must be a positive number'
      });
    }

    if (intervalMinutes !== undefined && intervalMinutes <= 0) {
      return res.status(400).json({
        error: 'Interval must be a positive number'
      });
    }

    // Build dynamic update query
    const updates = [];
    const values = [guildId, channelId];
    let paramCount = 2;

    if (lines !== undefined) {
      paramCount++;
      updates.push(`lines = $${paramCount}`);
      values.push(lines);
    }

    if (intervalMinutes !== undefined) {
      paramCount++;
      updates.push(`interval_seconds = $${paramCount}`);
      values.push(intervalMinutes * 60);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        error: 'At least one field (lines or intervalMinutes) must be provided'
      });
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');

    const result = await db.pool.query(
      `UPDATE autopurge_settings
       SET ${updates.join(', ')}
       WHERE guild_id = $1 AND channel_id = $2
       RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Auto-purge setting not found' });
    }

    res.json({
      success: true,
      setting: result.rows[0],
      message: 'Auto-purge setting updated successfully'
    });
  } catch (err) {
    console.error('Error updating auto-purge setting:', err);
    res.status(500).json({ error: 'Failed to update auto-purge setting', details: err.message });
  }
});

/**
 * DELETE /api/autopurge/delete
 * Delete an auto-purge setting
 * 
 * Body:
 *   - channelId: Discord channel ID (required)
 * 
 * Query params:
 *   - guildId: Discord Guild ID (required)
 */
router.delete('/api/autopurge/delete', requireAuth, requireGuildAccess, requireDashboardAccess, async (req, res) => {
  try {
    const { channelId } = req.body;
    const guildId = req.guildId;

    // Validation
    if (!channelId) {
      return res.status(400).json({ error: 'Channel ID is required' });
    }

    console.log('[DEBUG] Deleting autopurge setting:', { guildId, channelId, bodyChannelId: req.body.channelId });

    const result = await db.pool.query(
      `DELETE FROM autopurge_settings
       WHERE guild_id = $1 AND channel_id = $2
       RETURNING id`,
      [guildId, channelId]
    );

    console.log('[DEBUG] Delete result rows:', result.rows.length);

    if (result.rows.length === 0) {
      // Try to fetch to see what exists
      const existing = await db.pool.query(
        `SELECT id, guild_id, channel_id FROM autopurge_settings WHERE guild_id = $1 LIMIT 5`,
        [guildId]
      );
      console.log('[DEBUG] Existing autopurge settings for guild:', existing.rows);
      return res.status(404).json({ error: 'Auto-purge setting not found' });
    }

    res.json({
      success: true,
      message: 'Auto-purge setting deleted successfully'
    });
  } catch (err) {
    console.error('Error deleting auto-purge setting:', err);
    res.status(500).json({ error: 'Failed to delete auto-purge setting', details: err.message });
  }
});

module.exports = router;
