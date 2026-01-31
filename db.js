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
    console.log("✓ Database schema initialized");

    // Create performance indexes for scale
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_role_timers_expires_at ON role_timers(expires_at)',
      'CREATE INDEX IF NOT EXISTS idx_role_timers_user_id ON role_timers(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_role_timers_paused_expires ON role_timers(paused, expires_at)',
      'CREATE INDEX IF NOT EXISTS idx_autopurge_settings_guild_channel ON autopurge_settings(guild_id, channel_id)',
      'CREATE INDEX IF NOT EXISTS idx_autopurge_settings_enabled ON autopurge_settings(enabled)',
      'CREATE INDEX IF NOT EXISTS idx_rolestatus_schedules_enabled ON rolestatus_schedules(enabled)',
      'CREATE INDEX IF NOT EXISTS idx_rolestatus_schedules_guild_role ON rolestatus_schedules(guild_id, role_id)',
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

async function setMinutesForRole(userId, roleId, minutes, warnChannelId = null) {
  try {
    const expiresAt = Date.now() + minutes * 60 * 1000;
    const result = await pool.query(
      `INSERT INTO role_timers (user_id, role_id, expires_at, warn_channel_id, warnings_sent, paused, paused_remaining_ms)
       VALUES ($1, $2, $3, $4, $5, false, 0)
       ON CONFLICT (user_id, role_id) DO UPDATE SET
         expires_at = $3,
         warn_channel_id = $4,
         warnings_sent = '{}',
         paused = false,
         paused_remaining_ms = 0,
         updated_at = CURRENT_TIMESTAMP
       RETURNING expires_at`,
      [userId, roleId, expiresAt, warnChannelId, JSON.stringify({})]
    );
    // CRITICAL: Ensure it's a number - type parser may not always work
    return Number(result.rows[0]?.expires_at) || expiresAt;
  } catch (err) {
    console.error("setMinutesForRole error:", err);
    return null;
  }
}

async function addMinutesForRole(userId, roleId, minutes) {
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
      `INSERT INTO role_timers (user_id, role_id, expires_at, warnings_sent)
       VALUES ($1, $2, $3, '{}')
       ON CONFLICT (user_id, role_id) DO UPDATE SET
         expires_at = $3,
         warnings_sent = '{}',
         updated_at = CURRENT_TIMESTAMP
       RETURNING expires_at`,
      [userId, roleId, expiresAt]
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

async function closePool() {
  await pool.end();
  console.log("Database connection pool closed");
}

module.exports = {
  initDatabase,
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
  closePool,
};
