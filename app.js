//----------------------------------------
// BoostMon — Slim Entry Point (Modular)
//----------------------------------------

// Load environment variables
require("dotenv").config();

// Load version info
let VERSION = { version: "2.0.0", major: 2, minor: 0, patch: 0 };
try {
  VERSION = require("./version.json");
} catch (err) {
  console.warn("Warning: Could not load version.json, using default");
}

const express = require("express");
const path = require("path");
const cookieParser = require("cookie-parser");
const {
  Client,
  GatewayIntentBits,
} = require("discord.js");

const indexRouter = require("./routes/index");
const authRouter = require("./routes/auth");
const dashboardRouter = require("./routes/dashboard");
const db = require("./db");
const guildMemberSync = require("./guild-member-sync");

// Services
const streakService = require("./services/streak");
const cleanupService = require("./services/cleanup");

// Discord modules
const { registerCommands } = require("./discord/register");
const commandHandlers = require("./discord/handlers");
const { friendlyDiscordError } = require("./utils/helpers");

console.log("=== BoostMon app.js booted ===");
console.log("DISCORD_TOKEN present:", Boolean(process.env.DISCORD_TOKEN));
console.log("DISCORD_CLIENT_ID present:", Boolean(process.env.DISCORD_CLIENT_ID));
console.log("DISCORD_GUILD_ID present:", Boolean(process.env.DISCORD_GUILD_ID));
console.log("DATABASE_URL present:", Boolean(process.env.DATABASE_URL));

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

// Multi-server support
if (GUILD_ID) {
  console.log(`[MULTI-SERVER] Using GUILD_ID mode: bot restricted to server ${GUILD_ID}`);
} else {
  console.log("[MULTI-SERVER] GUILD_ID not set: bot will work on ALL servers (global commands)");
}

// Initialize in-memory member cache for fast dashboard lookups
global.memberCache = {};
console.log("[Member Cache] Initialized for fast dashboard performance");


//----------------------------------------
// Discord Client
//----------------------------------------
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

// Expose client globally for dashboard API
global.botClient = client;

// Inject client into streak service (avoids circular deps)
streakService.init(client);


//----------------------------------------
// Client Ready — Init DB, Sync, Backfill, Timers, Register Commands
//----------------------------------------
client.once("ready", async () => {
  console.log(`BoostMon logged in as ${client.user.tag}`);

  // Initialize database
  await db.initDatabase();

  // Start guild member sync service
  guildMemberSync.startBackgroundSync(client);

  // Backfill guild_id for timers that don't have it yet
  try {
    let totalUpdated = 0;
    let batchNum = 0;

    while (true) {
      const result = await db.pool.query(
        `SELECT id, user_id, role_id FROM role_timers WHERE guild_id IS NULL LIMIT 100`
      );
      const nullGuildTimers = result.rows;

      if (nullGuildTimers.length === 0) {
        console.log(`[Backfill] Complete! Updated ${totalUpdated} timers total with guild_id`);
        break;
      }

      batchNum++;
      console.log(`[Backfill] Batch ${batchNum}: Found ${nullGuildTimers.length} timers without guild_id, searching...`);
      let batchUpdated = 0;

      for (const timer of nullGuildTimers) {
        for (const guild of client.guilds.cache.values()) {
          try {
            const member = await guild.members.fetch(timer.user_id).catch(() => null);

            if (member && member.roles.cache.has(timer.role_id)) {
              await db.pool.query(
                `UPDATE role_timers SET guild_id = $1 WHERE id = $2`,
                [guild.id, timer.id]
              );
              batchUpdated++;
              totalUpdated++;
              break;
            }
          } catch (e) {
            // Continue to next guild
          }
        }
      }

      console.log(`[Backfill] Batch ${batchNum}: Updated ${batchUpdated}/${nullGuildTimers.length} timers`);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  } catch (err) {
    console.error("[Backfill] Error:", err.message);
  }

  // Backfill streak records for users with active timers but no streak row
  try {
    const result = await db.pool.query(
      `SELECT DISTINCT rt.guild_id, rt.user_id, MIN(rt.created_at) AS earliest_timer
       FROM role_timers rt
       WHERE rt.guild_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM user_streaks us
           WHERE us.guild_id = rt.guild_id AND us.user_id = rt.user_id
         )
       GROUP BY rt.guild_id, rt.user_id`
    );

    if (result.rows.length > 0) {
      for (const row of result.rows) {
        const streakStart = row.earliest_timer || new Date();
        await db.upsertUserStreak(row.guild_id, row.user_id, {
          streak_start_at: streakStart,
          save_tokens: 0,
          last_save_earned_at: streakStart,
        });
      }
      console.log(`[Streak Backfill] Created streak records for ${result.rows.length} users with active timers`);
    } else {
      console.log(`[Streak Backfill] All users with active timers already have streak records`);
    }
  } catch (err) {
    console.error("[Streak Backfill] Error:", err.message);
  }

  // ===== TIMER EXPIRATION CHECKER =====
  setInterval(async () => {
    try {
      const now = Date.now();
      const expiredTimers = await db.pool.query(
        `SELECT * FROM role_timers 
         WHERE expires_at > 0 AND expires_at <= $1 AND guild_id IS NOT NULL AND paused = false`,
        [now]
      );

      if (expiredTimers.rows.length === 0) return;

      for (const timer of expiredTimers.rows) {
        try {
          const guild = client.guilds.cache.get(timer.guild_id);
          if (!guild) continue;

          const member = await guild.members.fetch(timer.user_id).catch(() => null);
          const role = guild.roles.cache.get(timer.role_id);

          // STREAK LOGIC: Check for saves or degradation
          const streak = await db.getUserStreak(timer.guild_id, timer.user_id);

          if (streak && streak.streak_start_at) {
            if (streak.save_tokens > 0) {
              const gracePeriodUntil = new Date(now + 24 * 60 * 60 * 1000);
              await db.upsertUserStreak(timer.guild_id, timer.user_id, {
                save_tokens: streak.save_tokens - 1,
                grace_period_until: gracePeriodUntil
              });

              const newExpiresAt = now + 24 * 60 * 60 * 1000;
              await db.pool.query(
                "UPDATE role_timers SET expires_at = $1 WHERE id = $2",
                [newExpiresAt, timer.id]
              );

              console.log(`[Streak] Save used for ${timer.user_id}. 24h grace period granted.`);
              continue;
            } else {
              const streakDays = Math.floor((now - new Date(streak.streak_start_at).getTime()) / (24 * 60 * 60 * 1000));
              const streakRoles = await db.getStreakRoles(timer.guild_id);

              let currentTierDays = 0;
              for (const sr of streakRoles) {
                if (streakDays >= sr.day_threshold && sr.day_threshold > currentTierDays) {
                  currentTierDays = sr.day_threshold;
                }
              }

              let nextTierDown = 0;
              for (const sr of streakRoles) {
                if (sr.day_threshold < currentTierDays && sr.day_threshold > nextTierDown) {
                  nextTierDown = sr.day_threshold;
                }
              }

              if (currentTierDays > 0) {
                const newStreakStart = new Date(now - nextTierDown * 24 * 60 * 60 * 1000);
                await db.upsertUserStreak(timer.guild_id, timer.user_id, {
                  streak_start_at: newStreakStart,
                  degradation_started_at: new Date(now)
                });

                if (member) {
                  await streakService.syncStreakRoles(member, nextTierDown, streakRoles);
                }

                const newExpiresAt = now + 24 * 60 * 60 * 1000;
                await db.pool.query(
                  "UPDATE role_timers SET expires_at = $1 WHERE id = $2",
                  [newExpiresAt, timer.id]
                );

                console.log(`[Streak] Degraded ${timer.user_id} to ${nextTierDown} day tier.`);
                continue;
              } else {
                await db.upsertUserStreak(timer.guild_id, timer.user_id, {
                  streak_start_at: null,
                  degradation_started_at: null
                });
              }
            }
          }

          // Standard removal if no streak protection or fully degraded
          if (member && role && member.roles.cache.has(timer.role_id)) {
            await member.roles.remove(timer.role_id).catch(err => {
              console.warn(`Failed to remove role ${timer.role_id} from ${timer.user_id}:`, err.message);
            });
          }

          await db.pool.query(
            `DELETE FROM role_timers WHERE id = $1`,
            [timer.id]
          );

          console.log(`[Timer Expired] Removed ${role?.name || "unknown role"} from ${member?.user?.username || timer.user_id}`);
        } catch (err) {
          console.error(`[Timer Expiration] Error processing timer ${timer.id}:`, err.message);
        }
      }
    } catch (err) {
      console.error("[Timer Expiration Checker] Error:", err.message);
    }
  }, 30000);

  // Start cleanup/warning loop (warnings, autopurge, scheduled reports)
  cleanupService.start(client, GUILD_ID);

  // Register slash commands
  await registerCommands({ TOKEN, CLIENT_ID, GUILD_ID });
});


//----------------------------------------
// Interaction Router — Dispatch to command handlers
//----------------------------------------
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    const handler = commandHandlers[interaction.commandName];
    if (handler) {
      await handler(interaction, { client });
    }
  } catch (err) {
    console.error("Command error:", err);

    const msg = "Error running command. Details: " + friendlyDiscordError(err);

    try {
      if (interaction.deferred || interaction.replied) {
        return interaction.followUp({ content: msg, ephemeral: true });
      }
      return interaction.reply({ content: msg, ephemeral: true });
    } catch (e) {
      console.error("Failed to send error to Discord:", e);
    }
  }
});


//----------------------------------------
// Express Web Server
//----------------------------------------
const app = express();
const PORT = process.env.PORT || 3000;

app.use((req, res, next) => {
  console.info(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.resolve(__dirname, "public")));
app.use("/", indexRouter);
app.use("/auth", authRouter);
app.use("/", dashboardRouter);

// Version endpoint — available to all
app.get("/api/version", (req, res) => {
  res.json(VERSION);
});

app.use((req, res) => {
  res.status(404).sendFile(path.resolve(__dirname, "views", "404.html"));
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send("Internal Server Error");
});

app.listen(PORT, () => {
  console.log(`Server listening: http://localhost:${PORT}`);
});


//----------------------------------------
// Error Handling & Graceful Shutdown
//----------------------------------------
client.on("error", (err) => console.error("Discord client error:", err));
process.on("unhandledRejection", (reason) => console.error("Unhandled rejection:", reason));

process.on("SIGTERM", async () => {
  console.log("SIGTERM received. Closing database pool...");
  await db.closePool().catch(err => console.error("Error closing database pool:", err));
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("SIGINT received. Closing database pool...");
  await db.closePool().catch(err => console.error("Error closing database pool:", err));
  process.exit(0);
});


//----------------------------------------
// Discord Login
//----------------------------------------
if (!TOKEN) {
  console.error("DISCORD_TOKEN is missing. Bot cannot log in.");
} else {
  client.login(TOKEN).then(() => {
    console.log("Discord login() called.");
  }).catch((err) => {
    console.error("Discord login failed:", err);
  });
}
