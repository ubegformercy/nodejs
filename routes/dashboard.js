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
router.get('/api/dashboard', requireAuth, requireGuildAccess, async (req, res) => {
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

    // Get timers for this guild only
    let allTimers = [];
    try {
      const result = await db.pool.query(
        `SELECT * FROM role_timers WHERE guild_id = $1 AND expires_at > 0 ORDER BY expires_at ASC`,
        [guildId]
      );
      allTimers = result.rows || [];
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

    // Format timers for display with name resolution
    const formattedTimers = await Promise.all(
      (allTimers || []).map(async (timer) => {
        const remaining = Math.max(0, Number(timer.expires_at) - Date.now());
        const hours = Math.floor(remaining / (1000 * 60 * 60));
        const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((remaining % (1000 * 60)) / 1000);

        // Resolve user and role names
        let userName = `Unknown (${timer.user_id})`;
        let roleName = `Unknown (${timer.role_id})`;

        if (client) {
          try {
            userName = await resolveUserName(client, timer.user_id);
          } catch (e) {
            console.error('Error resolving user:', e);
          }
          
          if (guild) {
            try {
              roleName = await resolveRoleName(guild, timer.role_id);
            } catch (e) {
              console.error('Error resolving role:', e);
            }
          }
        }

        return {
          id: timer.id,
          user: userName,
          userId: timer.user_id,
          role: roleName,
          roleId: timer.role_id,
          remaining: remaining,
          formattedTime: `${hours}h ${minutes}m ${seconds}s`,
          expiresAt: timer.expires_at,
          paused: timer.paused,
        };
      })
    ).then(timers => timers.filter(t => t !== null && t !== undefined));

    // Format schedules for display with name resolution
    const formattedSchedules = await Promise.all(
      (schedules || []).map(async (schedule) => {
        const lastReport = schedule.last_report_at 
          ? new Date(schedule.last_report_at).toLocaleString()
          : 'Never';
        
        const nextReportMs = schedule.last_report_at 
          ? new Date(schedule.last_report_at).getTime() + (schedule.interval_minutes * 60 * 1000)
          : Date.now() + (schedule.interval_minutes * 60 * 1000);
        
        const nextReport = new Date(nextReportMs).toLocaleString();

        // Resolve role and channel names
        let roleName = `Unknown (${schedule.role_id})`;
        let channelName = `Unknown (${schedule.channel_id})`;

        if (guild) {
          try {
            roleName = await resolveRoleName(guild, schedule.role_id);
          } catch (e) {
            console.error('Error resolving role:', e);
          }
          
          try {
            channelName = await resolveChannelName(guild, schedule.channel_id);
          } catch (e) {
            console.error('Error resolving channel:', e);
          }
        }

        return {
          role: roleName,
          roleId: schedule.role_id,
          channel: channelName,
          channelId: schedule.channel_id,
          interval: schedule.interval_minutes,
          lastReport: lastReport,
          nextReport: nextReport,
        };
      })
    ).then(schedules => schedules.filter(s => s !== null && s !== undefined));

    // Format autopurge settings for display with name resolution
    const formattedAutopurge = await Promise.all(
      (autopurges || []).map(async (setting) => {
        const lastPurge = setting.last_purge_at
          ? new Date(setting.last_purge_at).toLocaleString()
          : 'Never';

        // Resolve channel name
        let channelName = `Unknown (${setting.channel_id})`;

        if (guild) {
          try {
            channelName = await resolveChannelName(guild, setting.channel_id);
          } catch (e) {
            console.error('Error resolving channel:', e);
          }
        }

        return {
          channel: channelName,
          channelId: setting.channel_id,
          type: setting.type,
          lines: setting.lines,
          interval: Math.ceil(setting.interval_seconds / 60),
          lastPurge: lastPurge,
        };
      })
    ).then(autopurges => autopurges.filter(a => a !== null && a !== undefined));

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
router.post('/api/timer/add', requireAuth, requireGuildAccess, async (req, res) => {
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
router.patch('/api/timer/update', requireAuth, requireGuildAccess, async (req, res) => {
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
router.delete('/api/timer/delete', requireAuth, requireGuildAccess, async (req, res) => {
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
router.get('/api/dropdown-data', requireAuth, requireGuildAccess, async (req, res) => {
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

    // Fetch all members in the guild
    try {
      if (guild) {
        // Fetch all members to populate the dropdown completely
        const members = await guild.members.fetch({ limit: 1000 });
        data.users = members
          .filter(m => !m.user.bot) // Exclude bots
          .map(m => ({
            id: m.user.id,
            name: m.user.username,
            displayName: m.displayName || m.user.username
          }))
          .sort((a, b) => a.displayName.localeCompare(b.displayName));
      }
    } catch (err) {
      console.error('Error fetching guild members:', err);
      // Fallback to cache if fetch fails
      try {
        if (guild) {
          data.users = guild.members.cache
            .filter(m => !m.user.bot)
            .map(m => ({
              id: m.user.id,
              name: m.user.username,
              displayName: m.displayName || m.user.username
            }))
            .sort((a, b) => a.displayName.localeCompare(b.displayName));
        }
      } catch (cacheErr) {
        console.error('Error processing cached members:', cacheErr);
        data.users = [];
      }
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

module.exports = router;
