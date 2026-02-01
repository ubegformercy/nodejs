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

module.exports = router;
