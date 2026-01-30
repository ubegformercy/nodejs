//----------------------------------------
// DATABASE MODULE — PostgreSQL Connection & Queries
//----------------------------------------

const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on("error", (err) => {
  console.error("Unexpected error on idle client", err);
});

// Initialize database schema on startup
async function initDatabase() {
  const client = await pool.connect();
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
    console.log("✓ Database schema initialized");
  } catch (err) {
    console.error("Failed to initialize database:", err);
  } finally {
    client.release();
  }
}

// ===== READ OPERATIONS =====

async function getTimerForRole(userId, roleId) {
  try {
    const result = await pool.query(
      "SELECT * FROM role_timers WHERE user_id = $1 AND role_id = $2",
      [userId, roleId]
    );
    return result.rows[0] || null;
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
    return result.rows[0]?.expires_at || expiresAt;
  } catch (err) {
    console.error("setMinutesForRole error:", err);
    return null;
  }
}

async function addMinutesForRole(userId, roleId, minutes) {
  try {
    const timer = await getTimerForRole(userId, roleId);
    const now = Date.now();
    const base = timer && timer.expires_at > now ? timer.expires_at : now;
    const expiresAt = base + minutes * 60 * 1000;

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
    return result.rows[0]?.expires_at || expiresAt;
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
    const newExpiry = timer.expires_at - minutes * 60 * 1000;

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
    return result.rows[0]?.expires_at || newExpiry;
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
    const remainingMs = Math.max(0, timer.expires_at - now);

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

    const remainingMs = Math.max(0, timer.paused_remaining_ms);
    const newExpiresAt = Date.now() + remainingMs;

    const result = await pool.query(
      `UPDATE role_timers 
       SET paused = false, paused_at = NULL, paused_remaining_ms = 0, expires_at = $3, warnings_sent = '{}', updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $1 AND role_id = $2
       RETURNING expires_at`,
      [userId, roleId, newExpiresAt]
    );
    return result.rows[0]?.expires_at || newExpiresAt;
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

async function closePool() {
  await pool.end();
  console.log("Database connection pool closed");
}

module.exports = {
  initDatabase,
  getTimerForRole,
  getTimersForUser,
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
  closePool,
};
