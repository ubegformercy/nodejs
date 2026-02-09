//----------------------------------------
// DATABASE MODULE — PostgreSQL Connection & Queries
//----------------------------------------

const { Pool } = require("pg");

// Parse BigInt (BIGINT in PostgreSQL) as JavaScript numbers
// Instead of returning as strings
const types = require('pg').types;
types.setTypeParser(20, (val) => parseInt(val, 10)); // Parse BIGINT as number

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000,  // 5 second timeout for connections
  statement_timeout: 10000,        // 10 second timeout for queries
});

pool.on("error", (err) => {
  console.error("Unexpected error on idle client", err);
});

// Initialize database schema on startup
async function initDatabase() {
  try {
    if (!process.env.DATABASE_URL) {
      console.error("DATABASE_URL environment variable is not set. Skipping database initialization.");
      console.error("For local development: Set DATABASE_URL to a valid PostgreSQL connection string");
      console.error("For Railway deployment: DATABASE_URL will be automatically set");
      return;
    }

    const client = await pool.connect().catch(err => {
      throw new Error(`Failed to connect to database: ${err.message}`);
    });

    try {
      await client.query(`
      CREATE TABLE IF NOT EXISTS role_timers (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        role_id VARCHAR(255) NOT NULL,
        expires_at BIGINT NOT NULL,
        warn_channel_id VARCHAR(255),
        paused BOOLEAN DEFAULT false,
        paused_at BIGINT,
        paused_remaining_ms BIGINT DEFAULT 0,
        warnings_sent JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, role_id)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS autopurge_settings (
        id SERIAL PRIMARY KEY,
        guild_id VARCHAR(255) NOT NULL,
        channel_id VARCHAR(255) NOT NULL,
        type VARCHAR(50) NOT NULL,
        lines INTEGER NOT NULL,
        interval_seconds BIGINT NOT NULL,
        enabled BOOLEAN DEFAULT true,
        last_purge_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(guild_id, channel_id)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS rolestatus_schedules (
        id SERIAL PRIMARY KEY,
        guild_id VARCHAR(255) NOT NULL,
        role_id VARCHAR(255) NOT NULL,
        channel_id VARCHAR(255) NOT NULL,
        interval_minutes INTEGER NOT NULL,
        enabled BOOLEAN DEFAULT true,
        last_report_at TIMESTAMP,
        last_message_id VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(guild_id, role_id, channel_id)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS guild_members_cache (
        id SERIAL PRIMARY KEY,
        guild_id VARCHAR(255) NOT NULL,
        user_id VARCHAR(255) NOT NULL,
        username VARCHAR(255) NOT NULL,
        display_name VARCHAR(255),
        is_bot BOOLEAN DEFAULT false,
        avatar_url TEXT,
        last_synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(guild_id, user_id)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS dashboard_access (
        id SERIAL PRIMARY KEY,
        guild_id VARCHAR(255) NOT NULL,
        role_id VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_by VARCHAR(255),
        UNIQUE(guild_id, role_id)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS boost_queue (
        id SERIAL PRIMARY KEY,
        guild_id VARCHAR(255) NOT NULL,
        user_id VARCHAR(255) NOT NULL,
        added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        note TEXT,
        status VARCHAR(50) DEFAULT 'pending',
        completed_by VARCHAR(255),
        completed_at TIMESTAMP,
        position_order INTEGER NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(guild_id, user_id)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_registrations (
        id SERIAL PRIMARY KEY,
        guild_id VARCHAR(255) NOT NULL,
        discord_id VARCHAR(255) NOT NULL,
        discord_username VARCHAR(255) NOT NULL,
        in_game_username VARCHAR(255) NOT NULL,
        display_name VARCHAR(255) NOT NULL,
        registered_by VARCHAR(255) NOT NULL,
        registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(guild_id, discord_id)
      );
    `);

    // Add missing column if it doesn't exist (for existing databases)
    try {
      await client.query(`
        ALTER TABLE rolestatus_schedules 
        ADD COLUMN IF NOT EXISTS last_message_id VARCHAR(255);
      `);
    } catch (err) {
      if (!err.message.includes("already exists")) {
        console.warn("Migration info:", err.message);
      }
    }

    // Add guild_id to role_timers for multi-server support
    try {
      await client.query(`
        ALTER TABLE role_timers 
        ADD COLUMN IF NOT EXISTS guild_id VARCHAR(255);
      `);
    } catch (err) {
      if (!err.message.includes("already exists")) {
        console.warn("Migration info:", err.message);
      }
    }

    // Add dashboard_access_mode to track restrict vs normal mode
    try {
      await client.query(`
        ALTER TABLE dashboard_access 
        ADD COLUMN IF NOT EXISTS mode VARCHAR(50) DEFAULT 'normal';
      `);
    } catch (err) {
      if (!err.message.includes("already exists")) {
        console.warn("Migration info:", err.message);
      }
    }

    console.log("✓ Database schema initialized");

    // Create performance indexes for scale
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_role_timers_expires_at ON role_timers(expires_at)',
      'CREATE INDEX IF NOT EXISTS idx_role_timers_user_id ON role_timers(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_role_timers_guild_id ON role_timers(guild_id)',
      'CREATE INDEX IF NOT EXISTS idx_role_timers_paused_expires ON role_timers(paused, expires_at)',
      'CREATE INDEX IF NOT EXISTS idx_autopurge_settings_guild_channel ON autopurge_settings(guild_id, channel_id)',
      'CREATE INDEX IF NOT EXISTS idx_autopurge_settings_enabled ON autopurge_settings(enabled)',
      'CREATE INDEX IF NOT EXISTS idx_rolestatus_schedules_enabled ON rolestatus_schedules(enabled)',
      'CREATE INDEX IF NOT EXISTS idx_rolestatus_schedules_guild_role ON rolestatus_schedules(guild_id, role_id)',
      'CREATE INDEX IF NOT EXISTS idx_guild_members_cache_guild_id ON guild_members_cache(guild_id)',
      'CREATE INDEX IF NOT EXISTS idx_guild_members_cache_user_id ON guild_members_cache(guild_id, user_id)',
      'CREATE INDEX IF NOT EXISTS idx_guild_members_cache_username ON guild_members_cache(guild_id, username)',
      'CREATE INDEX IF NOT EXISTS idx_boost_queue_guild_id ON boost_queue(guild_id)',
      'CREATE INDEX IF NOT EXISTS idx_boost_queue_user_id ON boost_queue(guild_id, user_id)',
      'CREATE INDEX IF NOT EXISTS idx_boost_queue_position ON boost_queue(guild_id, position_order)',
      'CREATE INDEX IF NOT EXISTS idx_boost_queue_status ON boost_queue(guild_id, status)',
      'CREATE INDEX IF NOT EXISTS idx_user_registrations_guild_id ON user_registrations(guild_id)',
      'CREATE INDEX IF NOT EXISTS idx_user_registrations_discord_id ON user_registrations(guild_id, discord_id)',
    ];

      for (const indexQuery of indexes) {
        try {
          await client.query(indexQuery);
        } catch (err) {
          if (!err.message.includes("already exists")) {
            console.warn("Index creation info:", err.message);
          }
        }
      }
      console.log("✓ Indexes created/verified");
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Failed to initialize database:", err);
  }
}

// ===== READ OPERATIONS =====

async function getTimerForRole(userId, roleId) {
  try {
    const result = await pool.query(
      "SELECT * FROM role_timers WHERE user_id = $1 AND role_id = $2",
      [userId, roleId]
    );
    const timer = result.rows[0] || null;
    if (timer) {
      console.log(`[getTimerForRole] Found timer: expires_at=${timer.expires_at} (type: ${typeof timer.expires_at})`);
    }
    return timer;
  } catch (err) {
    console.error("getTimerForRole error:", err);
    return null;
  }
}

async function getTimersForUser(userId) {
  try {
    const result = await pool.query(
      "SELECT * FROM role_timers WHERE user_id = $1 ORDER BY created_at ASC",
      [userId]
    );
    return result.rows;
  } catch (err) {
    console.error("getTimersForUser error:", err);
    return [];
  }
}

async function getTimersForRole(roleId) {
  try {
    const result = await pool.query(
      "SELECT * FROM role_timers WHERE role_id = $1 ORDER BY expires_at ASC",
      [roleId]
    );
    return result.rows;
  } catch (err) {
    console.error("getTimersForRole error:", err);
    return [];
  }
}

async function getAllActiveTimers() {
  try {
    const result = await pool.query(
      "SELECT * FROM role_timers WHERE expires_at > 0 ORDER BY expires_at ASC"
    );
    return result.rows;
  } catch (err) {
    console.error("getAllActiveTimers error:", err);
    return [];
  }
}

// ===== WRITE OPERATIONS =====

async function setMinutesForRole(userId, roleId, minutes, warnChannelId = null, guildId = null) {
  try {
    const expiresAt = Date.now() + minutes * 60 * 1000;
    const result = await pool.query(
      `INSERT INTO role_timers (user_id, role_id, expires_at, warn_channel_id, warnings_sent, paused, paused_remaining_ms, guild_id)
       VALUES ($1, $2, $3, $4, $5, false, 0, $6)
       ON CONFLICT (user_id, role_id) DO UPDATE SET
         expires_at = $3,
         warn_channel_id = $4,
         warnings_sent = '{}',
         paused = false,
         paused_remaining_ms = 0,
         guild_id = $6,
         updated_at = CURRENT_TIMESTAMP
       RETURNING expires_at`,
      [userId, roleId, expiresAt, warnChannelId, JSON.stringify({}), guildId]
    );
    // CRITICAL: Ensure it's a number - type parser may not always work
    return Number(result.rows[0]?.expires_at) || expiresAt;
  } catch (err) {
    console.error("setMinutesForRole error:", err);
    return null;
  }
}

async function addMinutesForRole(userId, roleId, minutes, guildId = null) {
  try {
    const timer = await getTimerForRole(userId, roleId);
    const now = Date.now();
    const timerExpiry = timer?.expires_at || 0;  // Already a number from parser
    const base = timerExpiry > now ? timerExpiry : now;
    const expiresAt = base + minutes * 60 * 1000;

    console.log(`[addMinutesForRole] userId=${userId}, roleId=${roleId}, minutes=${minutes}`);
    console.log(`[addMinutesForRole] timer.expires_at=${timerExpiry} (type: ${typeof timerExpiry})`);
    console.log(`[addMinutesForRole] calculated expiresAt=${expiresAt}`);

    const result = await pool.query(
      `INSERT INTO role_timers (user_id, role_id, expires_at, warnings_sent, guild_id)
       VALUES ($1, $2, $3, '{}', $4)
       ON CONFLICT (user_id, role_id) DO UPDATE SET
         expires_at = $3,
         warnings_sent = '{}',
         guild_id = $4,
         updated_at = CURRENT_TIMESTAMP
       RETURNING expires_at`,
      [userId, roleId, expiresAt, guildId]
    );
    const returnedValue = result.rows[0]?.expires_at;
    console.log(`[addMinutesForRole] returned from DB: ${returnedValue} (type: ${typeof returnedValue})`);
    // CRITICAL: Ensure it's a number - type parser may not always work
    const finalValue = Number(returnedValue);
    console.log(`[addMinutesForRole] final value: ${finalValue} (type: ${typeof finalValue})`);
    return finalValue || expiresAt;
  } catch (err) {
    console.error("addMinutesForRole error:", err);
    return null;
  }
}

async function removeMinutesForRole(userId, roleId, minutes) {
  try {
    const timer = await getTimerForRole(userId, roleId);
    if (!timer) return null;

    const now = Date.now();
    const newExpiry = timer.expires_at - minutes * 60 * 1000;  // Already numbers

    if (newExpiry <= now) {
      // Delete the timer
      await pool.query(
        "DELETE FROM role_timers WHERE user_id = $1 AND role_id = $2",
        [userId, roleId]
      );
      return 0;
    }

    const result = await pool.query(
      `UPDATE role_timers 
       SET expires_at = $3, warnings_sent = '{}', updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $1 AND role_id = $2
       RETURNING expires_at`,
      [userId, roleId, newExpiry]
    );
    // CRITICAL: Ensure it's a number - type parser may not always work
    return Number(result.rows[0]?.expires_at) || newExpiry;
  } catch (err) {
    console.error("removeMinutesForRole error:", err);
    return null;
  }
}

async function clearRoleTimer(userId, roleId) {
  try {
    const result = await pool.query(
      "DELETE FROM role_timers WHERE user_id = $1 AND role_id = $2 RETURNING *",
      [userId, roleId]
    );
    return result.rows.length > 0;
  } catch (err) {
    console.error("clearRoleTimer error:", err);
    return false;
  }
}

// ===== PAUSE/RESUME OPERATIONS =====

async function pauseTimer(userId, roleId) {
  try {
    const timer = await getTimerForRole(userId, roleId);
    if (!timer) return null;

    const now = Date.now();
    const remainingMs = Math.max(0, timer.expires_at - now);  // Already numbers

    await pool.query(
      `UPDATE role_timers 
       SET paused = true, paused_at = $3, paused_remaining_ms = $4, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $1 AND role_id = $2`,
      [userId, roleId, now, remainingMs]
    );
    return remainingMs;
  } catch (err) {
    console.error("pauseTimer error:", err);
    return null;
  }
}

async function resumeTimer(userId, roleId) {
  try {
    const timer = await getTimerForRole(userId, roleId);
    if (!timer || !timer.paused) return null;

    const remainingMs = Math.max(0, timer.paused_remaining_ms || 0);  // Already numbers
    const newExpiresAt = Date.now() + remainingMs;

    const result = await pool.query(
      `UPDATE role_timers 
       SET paused = false, paused_at = NULL, paused_remaining_ms = 0, expires_at = $3, warnings_sent = '{}', updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $1 AND role_id = $2
       RETURNING expires_at`,
      [userId, roleId, newExpiresAt]
    );
    // CRITICAL: Ensure it's a number - type parser may not always work
    return Number(result.rows[0]?.expires_at) || newExpiresAt;
  } catch (err) {
    console.error("resumeTimer error:", err);
    return null;
  }
}

// ===== WARNING TRACKING =====

async function markWarningAsSent(userId, roleId, minuteThreshold) {
  try {
    const timer = await getTimerForRole(userId, roleId);
    if (!timer) return;

    const warningsSent = timer.warnings_sent || {};
    warningsSent[String(minuteThreshold)] = true;

    await pool.query(
      `UPDATE role_timers 
       SET warnings_sent = $3, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $1 AND role_id = $2`,
      [userId, roleId, JSON.stringify(warningsSent)]
    );
  } catch (err) {
    console.error("markWarningAsSent error:", err);
  }
}

async function hasWarningBeenSent(userId, roleId, minuteThreshold) {
  try {
    const timer = await getTimerForRole(userId, roleId);
    if (!timer) return false;
    const warningsSent = timer.warnings_sent || {};
    return Boolean(warningsSent[String(minuteThreshold)]);
  } catch (err) {
    console.error("hasWarningBeenSent error:", err);
    return false;
  }
}

// ===== UTILITY =====

async function getFirstTimedRoleForUser(userId) {
  try {
    const result = await pool.query(
      "SELECT role_id FROM role_timers WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1",
      [userId]
    );
    return result.rows[0]?.role_id || null;
  } catch (err) {
    console.error("getFirstTimedRoleForUser error:", err);
    return null;
  }
}

// ===== AUTOPURGE OPERATIONS =====

async function setAutopurgeSetting(guildId, channelId, type, lines, intervalSeconds) {
  try {
    const result = await pool.query(
      `INSERT INTO autopurge_settings (guild_id, channel_id, type, lines, interval_seconds, enabled, last_purge_at)
       VALUES ($1, $2, $3, $4, $5, true, NULL)
       ON CONFLICT (guild_id, channel_id) DO UPDATE SET
         type = $3,
         lines = $4,
         interval_seconds = $5,
         enabled = true,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [guildId, channelId, type, lines, intervalSeconds]
    );
    return result.rows[0] || null;
  } catch (err) {
    console.error("setAutopurgeSetting error:", err);
    return null;
  }
}

async function getAutopurgeSetting(guildId, channelId) {
  try {
    const result = await pool.query(
      "SELECT * FROM autopurge_settings WHERE guild_id = $1 AND channel_id = $2",
      [guildId, channelId]
    );
    return result.rows[0] || null;
  } catch (err) {
    console.error("getAutopurgeSetting error:", err);
    return null;
  }
}

async function getAllAutopurgeSettings(guildId) {
  try {
    const result = await pool.query(
      "SELECT * FROM autopurge_settings WHERE guild_id = $1 AND enabled = true ORDER BY channel_id ASC",
      [guildId]
    );
    return result.rows;
  } catch (err) {
    console.error("getAllAutopurgeSettings error:", err);
    return [];
  }
}

async function disableAutopurgeSetting(guildId, channelId) {
  try {
    const result = await pool.query(
      "UPDATE autopurge_settings SET enabled = false, updated_at = CURRENT_TIMESTAMP WHERE guild_id = $1 AND channel_id = $2 RETURNING *",
      [guildId, channelId]
    );
    return result.rows.length > 0;
  } catch (err) {
    console.error("disableAutopurgeSetting error:", err);
    return false;
  }
}

async function deleteAutopurgeSetting(guildId, channelId) {
  try {
    const result = await pool.query(
      "DELETE FROM autopurge_settings WHERE guild_id = $1 AND channel_id = $2 RETURNING *",
      [guildId, channelId]
    );
    return result.rows.length > 0;
  } catch (err) {
    console.error("deleteAutopurgeSetting error:", err);
    return false;
  }
}

async function updateAutopurgeLastPurge(guildId, channelId) {
  try {
    await pool.query(
      "UPDATE autopurge_settings SET last_purge_at = CURRENT_TIMESTAMP WHERE guild_id = $1 AND channel_id = $2",
      [guildId, channelId]
    );
  } catch (err) {
    console.error("updateAutopurgeLastPurge error:", err);
  }
}

// ===== ROLESTATUS SCHEDULE OPERATIONS =====

async function createRolestatusSchedule(guildId, roleId, channelId, intervalMinutes) {
  try {
    const result = await pool.query(
      `INSERT INTO rolestatus_schedules (guild_id, role_id, channel_id, interval_minutes, enabled, last_report_at)
       VALUES ($1, $2, $3, $4, true, NULL)
       ON CONFLICT (guild_id, role_id, channel_id) DO UPDATE SET
         interval_minutes = $4,
         enabled = true,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [guildId, roleId, channelId, intervalMinutes]
    );
    return result.rows[0] || null;
  } catch (err) {
    console.error("createRolestatusSchedule error:", err);
    return null;
  }
}

async function getRolestatusSchedule(guildId, roleId, channelId) {
  try {
    const result = await pool.query(
      "SELECT * FROM rolestatus_schedules WHERE guild_id = $1 AND role_id = $2 AND channel_id = $3",
      [guildId, roleId, channelId]
    );
    return result.rows[0] || null;
  } catch (err) {
    console.error("getRolestatusSchedule error:", err);
    return null;
  }
}

async function getAllRolestatusSchedules(guildId) {
  try {
    const result = await pool.query(
      "SELECT * FROM rolestatus_schedules WHERE guild_id = $1 AND enabled = true ORDER BY created_at ASC",
      [guildId]
    );
    return result.rows;
  } catch (err) {
    console.error("getAllRolestatusSchedules error:", err);
    return [];
  }
}

async function disableRolestatusSchedule(guildId, roleId) {
  try {
    await pool.query(
      "UPDATE rolestatus_schedules SET enabled = false, updated_at = CURRENT_TIMESTAMP WHERE guild_id = $1 AND role_id = $2",
      [guildId, roleId]
    );
    return true;
  } catch (err) {
    console.error("disableRolestatusSchedule error:", err);
    return false;
  }
}

async function updateRolestatusLastReport(guildId, roleId, channelId) {
  try {
    await pool.query(
      "UPDATE rolestatus_schedules SET last_report_at = CURRENT_TIMESTAMP WHERE guild_id = $1 AND role_id = $2 AND channel_id = $3",
      [guildId, roleId, channelId]
    );
    return true;
  } catch (err) {
    console.error("updateRolestatusLastReport error:", err);
    return false;
  }
}

async function updateRolestatusLastMessageId(guildId, roleId, channelId, messageId) {
  try {
    await pool.query(
      "UPDATE rolestatus_schedules SET last_message_id = $4, updated_at = CURRENT_TIMESTAMP WHERE guild_id = $1 AND role_id = $2 AND channel_id = $3",
      [guildId, roleId, channelId, messageId]
    );
    return true;
  } catch (err) {
    console.error("updateRolestatusLastMessageId error:", err);
    return false;
  }
}

// ===== GUILD MEMBERS CACHE OPERATIONS =====

async function upsertGuildMember(guildId, userId, username, displayName, isBot, avatarUrl) {
  try {
    const result = await pool.query(
      `INSERT INTO guild_members_cache (guild_id, user_id, username, display_name, is_bot, avatar_url, last_synced_at)
       VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
       ON CONFLICT (guild_id, user_id) 
       DO UPDATE SET username = $3, display_name = $4, is_bot = $5, avatar_url = $6, last_synced_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [guildId, userId, username, displayName, isBot, avatarUrl]
    );
    return result.rows[0];
  } catch (err) {
    console.error("upsertGuildMember error:", err);
    throw err;
  }
}

async function batchUpsertGuildMembers(guildId, memberDataArray) {
  // Batch upsert multiple members at once for better performance
  if (!memberDataArray || memberDataArray.length === 0) {
    return [];
  }

  try {
    // Build a single INSERT...ON CONFLICT statement with multiple rows
    let query = `INSERT INTO guild_members_cache (guild_id, user_id, username, display_name, is_bot, avatar_url, last_synced_at)
    VALUES `;
    
    const values = [];
    let paramIndex = 1;
    
    memberDataArray.forEach((member, index) => {
      if (index > 0) query += `, `;
      query += `($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, CURRENT_TIMESTAMP)`;
      values.push(
        member.guild_id,
        member.user_id,
        member.username,
        member.display_name,
        member.is_bot,
        member.avatar_url
      );
    });
    
    query += ` ON CONFLICT (guild_id, user_id) 
    DO UPDATE SET username = EXCLUDED.username, display_name = EXCLUDED.display_name, 
                   is_bot = EXCLUDED.is_bot, avatar_url = EXCLUDED.avatar_url, 
                   last_synced_at = CURRENT_TIMESTAMP
    RETURNING *`;
    
    const result = await pool.query(query, values);
    return result.rows;
  } catch (err) {
    console.error("batchUpsertGuildMembers error:", err);
    throw err;
  }
}

async function getGuildMembers(guildId) {
  try {
    const result = await pool.query(
      `SELECT user_id as "id", username as "name", display_name as "displayName", is_bot as "isBot", avatar_url as "avatarUrl"
       FROM guild_members_cache 
       WHERE guild_id = $1 
       ORDER BY display_name ASC, username ASC`,
      [guildId]
    );
    return result.rows;
  } catch (err) {
    console.error("getGuildMembers error:", err);
    return [];
  }
}

async function searchGuildMembers(guildId, query) {
  try {
    const searchQuery = `%${query}%`;
    const result = await pool.query(
      `SELECT user_id as "id", username as "name", display_name as "displayName", is_bot as "isBot", avatar_url as "avatarUrl"
       FROM guild_members_cache 
       WHERE guild_id = $1 AND (username ILIKE $2 OR display_name ILIKE $2 OR user_id = $3)
       ORDER BY display_name ASC, username ASC
       LIMIT 50`,
      [guildId, searchQuery, query]
    );
    return result.rows;
  } catch (err) {
    console.error("searchGuildMembers error:", err);
    return [];
  }
}

async function clearGuildMemberCache(guildId) {
  try {
    await pool.query(
      `DELETE FROM guild_members_cache WHERE guild_id = $1`,
      [guildId]
    );
    return true;
  } catch (err) {
    console.error("clearGuildMemberCache error:", err);
    return false;
  }
}

async function getLastSyncTime(guildId) {
  try {
    const result = await pool.query(
      `SELECT MAX(last_synced_at) as last_sync FROM guild_members_cache WHERE guild_id = $1`,
      [guildId]
    );
    return result.rows[0]?.last_sync || null;
  } catch (err) {
    console.error("getLastSyncTime error:", err);
    return null;
  }
}

// ===== DASHBOARD ACCESS CONTROL =====

async function grantDashboardAccess(guildId, roleId, grantedBy = null) {
  try {
    const result = await pool.query(
      `INSERT INTO dashboard_access (guild_id, role_id, created_by) 
       VALUES ($1, $2, $3)
       ON CONFLICT (guild_id, role_id) DO NOTHING
       RETURNING *`,
      [guildId, roleId, grantedBy]
    );
    return result.rows[0] || null;
  } catch (err) {
    console.error('grantDashboardAccess error:', err);
    return null;
  }
}

async function revokeDashboardAccess(guildId, roleId) {
  try {
    const result = await pool.query(
      `DELETE FROM dashboard_access WHERE guild_id = $1 AND role_id = $2 RETURNING *`,
      [guildId, roleId]
    );
    return result.rows.length > 0;
  } catch (err) {
    console.error('revokeDashboardAccess error:', err);
    return false;
  }
}

async function getDashboardAccessRoles(guildId) {
  try {
    const result = await pool.query(
      `SELECT role_id, created_by, created_at FROM dashboard_access WHERE guild_id = $1 ORDER BY created_at DESC`,
      [guildId]
    );
    return result.rows || [];
  } catch (err) {
    console.error('getDashboardAccessRoles error:', err);
    return [];
  }
}

async function hasDashboardAccess(guildId, member) {
  try {
    const guild = global.botClient?.guilds?.cache?.get(guildId);
    
    // Owner always has access (cannot be restricted)
    if (guild && guild.ownerId === member.id) {
      return true;
    }

    // Check if restrict mode is active
    const restrictMode = await getDashboardAccessMode(guildId);
    
    if (restrictMode === 'restricted') {
      // In restrict mode: only owner + whitelisted roles have access
      // Admins do NOT have automatic access
      const accessRoles = await getDashboardAccessRoles(guildId);
      if (accessRoles.length === 0) {
        return false; // No roles whitelisted, only owner
      }

      const allowedRoleIds = new Set(accessRoles.map(r => r.role_id));
      const memberRoleIds = member.roles?.cache?.keyArray?.() || [];
      
      return memberRoleIds.some(roleId => allowedRoleIds.has(roleId));
    } else {
      // Normal mode: owner + admins + granted roles have access
      // Admin always has access
      if (member.permissions?.has('Administrator')) {
        return true;
      }

      // Check if any of the member's roles have dashboard access
      const accessRoles = await getDashboardAccessRoles(guildId);
      if (accessRoles.length === 0) {
        return false; // No roles have access, only owner/admin
      }

      const allowedRoleIds = new Set(accessRoles.map(r => r.role_id));
      const memberRoleIds = member.roles?.cache?.keyArray?.() || [];
      
      return memberRoleIds.some(roleId => allowedRoleIds.has(roleId));
    }
  } catch (err) {
    console.error('hasDashboardAccess error:', err);
    return false;
  }
}

async function getDashboardAccessMode(guildId) {
  try {
    const result = await pool.query(
      `SELECT DISTINCT mode FROM dashboard_access WHERE guild_id = $1 LIMIT 1`,
      [guildId]
    );
    return result.rows[0]?.mode || 'normal';
  } catch (err) {
    console.error('getDashboardAccessMode error:', err);
    return 'normal';
  }
}

async function setDashboardRestrictMode(guildId, roleId, grantedBy = null) {
  try {
    // First, set all existing roles to mode='restricted'
    await pool.query(
      `UPDATE dashboard_access SET mode = 'restricted' WHERE guild_id = $1`,
      [guildId]
    );

    // Then ensure the specified role is in the whitelist
    const result = await pool.query(
      `INSERT INTO dashboard_access (guild_id, role_id, created_by, mode) 
       VALUES ($1, $2, $3, 'restricted')
       ON CONFLICT (guild_id, role_id) DO UPDATE SET mode = 'restricted'
       RETURNING *`,
      [guildId, roleId, grantedBy]
    );
    return result.rows[0] || null;
  } catch (err) {
    console.error('setDashboardRestrictMode error:', err);
    return null;
  }
}

async function removeDashboardRestrictMode(guildId) {
  try {
    // Reset all roles back to mode='normal'
    await pool.query(
      `UPDATE dashboard_access SET mode = 'normal' WHERE guild_id = $1`,
      [guildId]
    );
    return true;
  } catch (err) {
    console.error('removeDashboardRestrictMode error:', err);
    return false;
  }
}

async function isRestrictModeActive(guildId) {
  try {
    const result = await pool.query(
      `SELECT COUNT(*) as count FROM dashboard_access WHERE guild_id = $1 AND mode = 'restricted'`,
      [guildId]
    );
    return (result.rows[0]?.count || 0) > 0;
  } catch (err) {
    console.error('isRestrictModeActive error:', err);
    return false;
  }
}

// ===== BOOST QUEUE OPERATIONS =====

async function addToQueue(userId, guildId, note = null) {
  try {
    // Get the next position (max position + 1, or 1 if queue is empty)
    const maxResult = await pool.query(
      `SELECT MAX(position_order) as max_position FROM boost_queue WHERE guild_id = $1 AND status = 'pending'`,
      [guildId]
    );
    const nextPosition = (maxResult.rows[0]?.max_position || 0) + 1;

    const result = await pool.query(
      `INSERT INTO boost_queue (guild_id, user_id, note, status, position_order)
       VALUES ($1, $2, $3, 'pending', $4)
       ON CONFLICT (guild_id, user_id) DO UPDATE SET
         status = 'pending',
         note = $3,
         position_order = $4,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [guildId, userId, note, nextPosition]
    );
    return result.rows[0] || null;
  } catch (err) {
    console.error("addToQueue error:", err);
    return null;
  }
}

async function removeFromQueue(userId, guildId) {
  try {
    const result = await pool.query(
      `DELETE FROM boost_queue WHERE guild_id = $1 AND user_id = $2 RETURNING *`,
      [guildId, userId]
    );
    
    // Reorder remaining positions using CTE
    if (result.rows.length > 0) {
      await pool.query(
        `WITH reordered AS (
           SELECT id, ROW_NUMBER() OVER (ORDER BY added_at) as new_position
           FROM boost_queue
           WHERE guild_id = $1 AND status = 'pending'
         )
         UPDATE boost_queue
         SET position_order = reordered.new_position
         FROM reordered
         WHERE boost_queue.id = reordered.id`,
        [guildId]
      );
    }
    
    return result.rows.length > 0;
  } catch (err) {
    console.error("removeFromQueue error:", err);
    return false;
  }
}

async function getQueue(guildId, limit = 50) {
  try {
    const result = await pool.query(
      `SELECT * FROM boost_queue 
       WHERE guild_id = $1 AND status = 'pending'
       ORDER BY position_order ASC
       LIMIT $2`,
      [guildId, limit]
    );
    return result.rows;
  } catch (err) {
    console.error("getQueue error:", err);
    return [];
  }
}

async function getUserQueuePosition(userId, guildId) {
  try {
    const result = await pool.query(
      `SELECT position_order FROM boost_queue 
       WHERE guild_id = $1 AND user_id = $2 AND status = 'pending'`,
      [guildId, userId]
    );
    return result.rows[0]?.position_order || null;
  } catch (err) {
    console.error("getUserQueuePosition error:", err);
    return null;
  }
}

async function completeQueue(userId, guildId, adminId = null) {
  try {
    const result = await pool.query(
      `UPDATE boost_queue 
       SET status = 'completed', completed_by = $3, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE guild_id = $1 AND user_id = $2
       RETURNING *`,
      [guildId, userId, adminId]
    );
    
    // Reorder remaining positions using CTE
    if (result.rows.length > 0) {
      await pool.query(
        `WITH reordered AS (
           SELECT id, ROW_NUMBER() OVER (ORDER BY added_at) as new_position
           FROM boost_queue
           WHERE guild_id = $1 AND status = 'pending'
         )
         UPDATE boost_queue
         SET position_order = reordered.new_position
         FROM reordered
         WHERE boost_queue.id = reordered.id`,
        [guildId]
      );
    }
    
    return result.rows[0] || null;
  } catch (err) {
    console.error("completeQueue error:", err);
    return null;
  }
}

async function getQueueUser(userId, guildId) {
  try {
    const result = await pool.query(
      `SELECT * FROM boost_queue WHERE guild_id = $1 AND user_id = $2 AND status = 'pending'`,
      [guildId, userId]
    );
    return result.rows[0] || null;
  } catch (err) {
    console.error("getQueueUser error:", err);
    return null;
  }
}

async function registerUser(data) {
  try {
    const result = await pool.query(
      `INSERT INTO user_registrations 
       (guild_id, discord_id, discord_username, in_game_username, display_name, registered_by, registered_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (guild_id, discord_id) DO UPDATE SET
         discord_username = $3,
         in_game_username = $4,
         display_name = $5,
         registered_by = $6,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [
        data.guild_id,
        data.discord_id,
        data.discord_username,
        data.in_game_username,
        data.display_name,
        data.registered_by,
        data.registered_at || new Date(),
        new Date()
      ]
    );
    return result.rows[0] || null;
  } catch (err) {
    console.error("registerUser error:", err);
    return null;
  }
}

async function getUserRegistration(guildId, discordId) {
  try {
    const result = await pool.query(
      `SELECT * FROM user_registrations WHERE guild_id = $1 AND discord_id = $2`,
      [guildId, discordId]
    );
    return result.rows[0] || null;
  } catch (err) {
    console.error("getUserRegistration error:", err);
    return null;
  }
}

async function closePool() {
  await pool.end();
  console.log("Database connection pool closed");
}

// Generic query function for direct database access
async function query(text, params) {
  return pool.query(text, params);
}

module.exports = {
  pool,
  initDatabase,
  query,
  getTimerForRole,
  getTimersForUser,
  getTimersForRole,
  getAllActiveTimers,
  setMinutesForRole,
  addMinutesForRole,
  removeMinutesForRole,
  clearRoleTimer,
  pauseTimer,
  resumeTimer,
  markWarningAsSent,
  hasWarningBeenSent,
  getFirstTimedRoleForUser,
  setAutopurgeSetting,
  getAutopurgeSetting,
  getAllAutopurgeSettings,
  disableAutopurgeSetting,
  deleteAutopurgeSetting,
  updateAutopurgeLastPurge,
  createRolestatusSchedule,
  getRolestatusSchedule,
  getAllRolestatusSchedules,
  disableRolestatusSchedule,
  updateRolestatusLastReport,
  updateRolestatusLastMessageId,
  // Guild members cache
  upsertGuildMember,
  batchUpsertGuildMembers,
  getGuildMembers,
  searchGuildMembers,
  clearGuildMemberCache,
  getLastSyncTime,
  
  // Dashboard access control
  grantDashboardAccess,
  revokeDashboardAccess,
  getDashboardAccessRoles,
  hasDashboardAccess,
  getDashboardAccessMode,
  setDashboardRestrictMode,
  removeDashboardRestrictMode,
  isRestrictModeActive,
  
  // Boost queue operations
  addToQueue,
  removeFromQueue,
  getQueue,
  getUserQueuePosition,
  completeQueue,
  getQueueUser,
  
  // User registration
  registerUser,
  getUserRegistration,
  
  closePool,
};
