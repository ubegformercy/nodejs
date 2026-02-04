//----------------------------------------
// SECTION 0 — Imports & Boot Logging
//----------------------------------------

// Load environment variables from .env file
require('dotenv').config();

// Load version info
let VERSION = { version: '2.0.0', major: 2, minor: 0, patch: 0 };
try {
  VERSION = require('./version.json');
} catch (err) {
  console.warn('Warning: Could not load version.json, using default');
}

const express = require("express");
const path = require("path");
const cookieParser = require("cookie-parser");
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,  
} = require("discord.js");
const indexRouter = require("./routes/index");
const authRouter = require("./routes/auth");
const dashboardRouter = require("./routes/dashboard");
const db = require("./db");
const guildMemberSync = require("./guild-member-sync");
const BOOSTMON_ICON_URL = "https://raw.githubusercontent.com/ubegformercy/nodejs/main/public/images/boostmon.png";
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



//----------------------------------------
// SECTION 1 — Warning/Timer Configuration
//----------------------------------------

// Warning thresholds (minutes remaining)
const WARNING_THRESHOLDS_MIN = [60, 10, 1]; // customize as you like
const CHECK_INTERVAL_MS = 30_000;



//----------------------------------------
// SECTION 2 — Database (PostgreSQL)
//----------------------------------------

// Database is initialized on startup (see SECTION 5)




//----------------------------------------
// SECTION 3 — Utility Helpers
//----------------------------------------
const ACTIVE_GREEN = 0x2ECC71;

function buildActiveTimerEmbed({
  actor,
  targetUser,
  role,
  minutes,
  expiresAt,
  warnChannel,
}) {
  return new EmbedBuilder()
    .setColor(ACTIVE_GREEN)
    .setTitle("🟢 Timed Role Activated")
    .setTimestamp(new Date())
    .addFields(
      { name: "Command Run By", value: `${actor}`, inline: true },
      { name: "Target User", value: `${targetUser}`, inline: true },
      { name: "Role Assigned", value: `${role.name}`, inline: true },
      { name: "Duration", value: `${minutes} minute(s)`, inline: true },
      {
        name: "Expires",
        value: `<t:${Math.floor(expiresAt / 1000)}:F>\n(<t:${Math.floor(expiresAt / 1000)}:R>)`,
        inline: true,
      },
      {
        name: "Warning Channel",
        value: warnChannel ? `${warnChannel}` : "DMs",
        inline: true,
      }
    )
    .setFooter({ text: "BoostMon • Active Timer" });
}


function formatMs(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h}h ${m}m ${s}s`;
}

function friendlyDiscordError(err) {
  const rawMsg = err?.rawError?.message || err?.message || "Unknown error";
  const code = err?.code ? ` (code ${err.code})` : "";
  const status = err?.status ? ` (HTTP ${err.status})` : "";
  return `${rawMsg}${code}${status}`;
}

function getTimeLeftMsForRole(userId, roleId) {
  // This will be handled by cleanupAndWarn which queries the DB
  // For immediate queries, use db.getTimerForRole() instead
  return 0;
}

// Helper: when role not specified, choose a role timer deterministically (first key)
async function getFirstTimedRoleId(userId) {
  return await db.getFirstTimedRoleForUser(userId);
}



//----------------------------------------
// SECTION 4 — Timer Math (set/add/remove)
//----------------------------------------

// Add minutes to a specific role timer (user+role)
function addMinutesForRole(userId, roleId, minutes, guildId = null) {
  return db.addMinutesForRole(userId, roleId, minutes, guildId);
}

// Set minutes exactly for a role timer (user+role) to now+minutes.
// Also sets warnChannelId (nullable) and resets warningsSent.
function setMinutesForRole(userId, roleId, minutes, warnChannelIdOrNull, guildId = null) {
  return db.setMinutesForRole(userId, roleId, minutes, warnChannelIdOrNull ?? null, guildId);
}

// Remove minutes from a role timer (user+role)
// Returns:
// - 0 if expired/removed
// - new expiresAt timestamp if still active
// - null if no timer existed
function removeMinutesForRole(userId, roleId, minutes) {
  return db.removeMinutesForRole(userId, roleId, minutes);
}

function clearRoleTimer(userId, roleId) {
  return db.clearRoleTimer(userId, roleId);
}



//----------------------------------------
// SECTION 5 — Discord Client + Slash Command Registration
//----------------------------------------

// NOTE: GUILD_MEMBERS intent is required for the dashboard user dropdown to work.
// This intent MUST be enabled in the Discord Developer Portal:
// 1. Go to: https://discord.com/developers/applications/{CLIENT_ID}/bot
// 2. Enable "Server Members Intent" under PRIVILEGED GATEWAY INTENTS
// Without this intent, guild members won't be cached and the dropdown will show no users.
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

// Expose client globally for dashboard API
global.botClient = client;

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
        // Check all guilds the bot is in
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
      
      // Small delay between batches to avoid overwhelming the bot
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  } catch (err) {
    console.error('[Backfill] Error:', err.message);
  }

  // ===== START TIMER EXPIRATION CHECKER =====
  // Check every 30 seconds for expired timers and remove roles
  setInterval(async () => {
    try {
      const expiredTimers = await db.pool.query(
        `SELECT id, user_id, role_id, guild_id FROM role_timers 
         WHERE expires_at > 0 AND expires_at <= $1 AND guild_id IS NOT NULL`,
        [Date.now()]
      );

      if (expiredTimers.rows.length === 0) return;

      for (const timer of expiredTimers.rows) {
        try {
          const guild = client.guilds.cache.get(timer.guild_id);
          if (!guild) continue;

          const member = await guild.members.fetch(timer.user_id).catch(() => null);
          const role = guild.roles.cache.get(timer.role_id);

          // Remove the role from the member
          if (member && role && member.roles.cache.has(timer.role_id)) {
            await member.roles.remove(timer.role_id).catch(err => {
              console.warn(`Failed to remove role ${timer.role_id} from ${timer.user_id}:`, err.message);
            });
          }

          // Mark timer as cleared in database
          await db.pool.query(
            `DELETE FROM role_timers WHERE id = $1`,
            [timer.id]
          );

          console.log(`[Timer Expired] Removed ${role?.name || 'unknown role'} from ${member?.user?.username || timer.user_id}`);
        } catch (err) {
          console.error(`[Timer Expiration] Error processing timer ${timer.id}:`, err.message);
        }
      }
    } catch (err) {
      console.error('[Timer Expiration Checker] Error:', err.message);
    }
  }, 30000); // Check every 30 seconds
  // ===== END TIMER EXPIRATION CHECKER =====

  if (!CLIENT_ID) {
    console.log("Missing DISCORD_CLIENT_ID; skipping command registration.");
    return;
  }

  const commands = [
    new SlashCommandBuilder()
      .setName("settime")
      .setDescription("Set a user's timed role time to exactly N minutes from now and assign the role.")
      .addUserOption((o) => o.setName("user").setDescription("User to set time for").setRequired(true))
      .addIntegerOption((o) =>
        o.setName("minutes").setDescription("Minutes to set").setRequired(true).setMinValue(1)
      )
      .addRoleOption((o) => o.setName("role").setDescription("Role to grant").setRequired(true))
      .addChannelOption((o) =>
        o
          .setName("channel")
          .setDescription("Where expiry warnings should be sent (optional). If omitted, warnings are DMed.")
          .setRequired(false)
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      ),

    new SlashCommandBuilder()
      .setName("addtime")
      .setDescription("Add minutes to a user's timed role and assign the role.")
      .addUserOption((o) => o.setName("user").setDescription("User to add time to").setRequired(true))
      .addIntegerOption((o) =>
        o.setName("minutes").setDescription("Minutes to add").setRequired(true).setMinValue(1)
      )
      .addRoleOption((o) => o.setName("role").setDescription("Role to add time to (optional)").setRequired(false)),
    
    new SlashCommandBuilder()
      .setName("pausetime")
      .setDescription("Pause a user's timed role timer (stops countdown until resumed).")
      .addUserOption((o) => o.setName("user").setDescription("User to pause").setRequired(true))
      .addRoleOption((o) => o.setName("role").setDescription("Role to pause (optional)").setRequired(false)),
    
    new SlashCommandBuilder()
      .setName("resumetime")
      .setDescription("Resume a paused timed role (continues from where it was paused).")
      .addUserOption((o) => o.setName("user").setDescription("User to resume").setRequired(true))
      .addRoleOption((o) => o.setName("role").setDescription("Role to resume").setRequired(true)),

    new SlashCommandBuilder()
      .setName("removetime")
      .setDescription("Remove minutes from a user's timed role.")
      .addUserOption((o) => o.setName("user").setDescription("User to modify").setRequired(true))
      .addIntegerOption((o) =>
        o.setName("minutes").setDescription("Minutes to remove").setRequired(true).setMinValue(1)
      )
      .addRoleOption((o) => o.setName("role").setDescription("Role to remove time from (optional)").setRequired(false)),

    new SlashCommandBuilder()
      .setName("cleartime")
      .setDescription("Clear a user's timed role timer and remove the role.")
      .addUserOption((o) => o.setName("user").setDescription("User to clear").setRequired(true))
      .addRoleOption((o) => o.setName("role").setDescription("Role to clear (optional)").setRequired(false)),

    new SlashCommandBuilder()
      .setName("showtime")
      .setDescription("Show remaining timed role time for a user (and optional role).")
      .addUserOption((o) => o.setName("user").setDescription("User to check (default: you)").setRequired(false))
      .addRoleOption((o) => o.setName("role").setDescription("Role to check (optional)").setRequired(false)),

    new SlashCommandBuilder()
      .setName("rolestatus")
      .setDescription("View role members or manage automated role status reports.")
      .addSubcommand((s) =>
        s
          .setName("view")
          .setDescription("Show all users with a specific role and their remaining times.")
          .addRoleOption((o) => o.setName("role").setDescription("Role to check").setRequired(true))
      )
      .addSubcommandGroup((g) =>
        g
          .setName("schedule")
          .setDescription("Manage automated role status reports")
          .addSubcommand((s) =>
            s
              .setName("set")
              .setDescription("Start automatic role status reports")
              .addRoleOption((o) => o.setName("role").setDescription("Role to monitor").setRequired(true))
              .addChannelOption((o) => o.setName("channel").setDescription("Channel to post reports").setRequired(true))
              .addIntegerOption((o) =>
                o
                  .setName("interval")
                  .setDescription("Minutes between reports (15-1440)")
                  .setRequired(true)
                  .setMinValue(15)
                  .setMaxValue(1440)
              )
          )
          .addSubcommand((s) =>
            s
              .setName("disable")
              .setDescription("Stop automated reports for a role")
              .addRoleOption((o) => o.setName("role").setDescription("Role to stop monitoring").setRequired(true))
          )
          .addSubcommand((s) =>
            s
              .setName("list")
              .setDescription("Show all active automated role status reports in this server")
          )
      ),

    new SlashCommandBuilder()
      .setName("autopurge")
      .setDescription("Automatically purge bot or user messages from a channel at set intervals.")
      .addSubcommand((s) =>
        s
          .setName("set")
          .setDescription("Set up auto-purge for a channel")
          .addChannelOption((o) => o.setName("channel").setDescription("Channel to auto-purge").setRequired(true))
          .addStringOption((o) =>
            o
              .setName("type")
              .setDescription("Message type to purge")
              .setRequired(true)
              .addChoices(
                { name: "Bot messages only", value: "bot" },
                { name: "User messages only", value: "user" },
                { name: "Both bot and user messages", value: "both" }
              )
          )
          .addIntegerOption((o) =>
            o
              .setName("lines")
              .setDescription("Number of messages to purge per interval (1-100)")
              .setRequired(true)
              .setMinValue(1)
              .setMaxValue(100)
          )
          .addIntegerOption((o) =>
            o
              .setName("interval")
              .setDescription("Minutes between purges (15-10080)")
              .setRequired(true)
              .setMinValue(15)
              .setMaxValue(10080)
          )
      )
      .addSubcommand((s) =>
        s
          .setName("disable")
          .setDescription("Disable auto-purge for a channel")
          .addChannelOption((o) => o.setName("channel").setDescription("Channel to disable").setRequired(true))
      )
      .addSubcommand((s) =>
        s
          .setName("status")
          .setDescription("Show all auto-purge settings in this server")
      ),
  ].map((c) => c.toJSON());

  console.log("Registering command names:", commands.map((c) => c.name).join(", "));

  try {
    const rest = new REST({ version: "10" }).setToken(TOKEN);

    // Use global commands for multi-server support, or guild commands if GUILD_ID is set
    const commandRoute = GUILD_ID
      ? Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID)
      : Routes.applicationCommands(CLIENT_ID);

    const routeType = GUILD_ID ? `guild (${GUILD_ID})` : "global (all servers)";
    console.log(`🔄 Registering ${commands.length} commands as: ${routeType}`);
    
    if (!GUILD_ID) {
      console.log("ℹ️  Global commands registered. This may take 15-60 minutes to sync across Discord.");
    }

    const result = await rest.put(commandRoute, { body: commands });

    console.log("✅ Slash commands registered. Discord now has:", result.map((c) => c.name).join(", "));
  } catch (err) {
    console.error("❌ Failed to register slash commands:", err);
  }
});


//----------------------------------------
// SECTION 6 — Slash Command Handlers
//----------------------------------------
async function canManageRole(guild, role) {
  const me = await guild.members.fetchMe();

  if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return { ok: false, reason: "I don't have Manage Roles permission." };
  }

  if (me.roles.highest.position <= role.position) {
    return {
      ok: false,
      reason: `I can't manage **${role.name}** because my highest role is not above it. Move my bot role higher than **${role.name}**.`,
    };
  }

  return { ok: true, me };
}

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

try { 
// ---------- /pausetime ----------
if (interaction.commandName === "pausetime") {
    // Defer immediately to prevent interaction timeout
    await interaction.deferReply().catch(() => null);

    if (!interaction.guild) {
    return interaction.editReply({ content: "This command can only be used in a server." });
  }

  const targetUser = interaction.options.getUser("user", true);
  const roleOption = interaction.options.getRole("role"); // optional

  const guild = interaction.guild;
  const member = await guild.members.fetch(targetUser.id);

  const timers = await db.getTimersForUser(targetUser.id);
  const timedRoleIds = timers.map(t => t.role_id);

  if (timedRoleIds.length === 0) {
    return interaction.editReply({ content: `${targetUser} has no active timed roles.` });
  }

  let roleIdToPause = null;

  if (roleOption) {
    roleIdToPause = roleOption.id;
    if (!timedRoleIds.includes(roleIdToPause)) {
      return interaction.editReply({
        content: `${targetUser} has no saved time for **${roleOption.name}**.`,
      });
    }
  } else {
    const matching = timedRoleIds.find((rid) => member.roles.cache.has(rid));
    roleIdToPause = matching || timedRoleIds[0];
  }

  const roleObj = guild.roles.cache.get(roleIdToPause);
  const roleName = roleObj?.name || "that role";

  if (!roleObj) {
    return interaction.editReply({
      content: `That role no longer exists in this server, but a timer is stored for it. Use /cleartime to remove the stored timer.`,
    });
  }

  const permCheck = await canManageRole(guild, roleObj);
  if (!permCheck.ok) {
    return interaction.editReply({ content: permCheck.reason });
  }

  const entry = await db.getTimerForRole(targetUser.id, roleIdToPause);

  if (entry?.paused) {
    return interaction.editReply({
      content: `${targetUser}'s timer for **${roleName}** is already paused.`,
    });
  }

  const remainingMs = await db.pauseTimer(targetUser.id, roleIdToPause);

  const embed = new EmbedBuilder()
    .setColor(0xF1C40F) // yellow = paused
    .setAuthor({ name: "BoostMon", iconURL: BOOSTMON_ICON_URL })
    .setTitle("Timed Role Paused")
    .setTimestamp(new Date())
    .addFields(
      { name: "Command Run By", value: `${interaction.user}`, inline: true },
      { name: "Time Run", value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
      { name: "Target User", value: `${targetUser}`, inline: true },
      { name: "Role", value: `${roleObj}`, inline: true },
      { name: "Remaining", value: `**${formatMs(remainingMs)}**`, inline: true }
    )
    .setFooter({ text: "BoostMon • Paused Timer" });

  return interaction.editReply({ embeds: [embed] });
}


// ---------- /resumetime ----------
if (interaction.commandName === "resumetime") {
    // Defer immediately to prevent interaction timeout
    await interaction.deferReply().catch(() => null);

    if (!interaction.guild) {
    return interaction.editReply({ content: "This command can only be used in a server." });
  }

  const targetUser = interaction.options.getUser("user", true);
  const roleOption = interaction.options.getRole("role", true); // REQUIRED

  const guild = interaction.guild;
  const member = await guild.members.fetch(targetUser.id);

  const timers = await db.getTimersForUser(targetUser.id);
  const timedRoleIds = timers.map(t => t.role_id);

  if (timedRoleIds.length === 0) {
    return interaction.editReply({ content: `${targetUser} has no active timed roles.` });
  }

  // Verify the specified role has a timer
  const roleIdToResume = roleOption.id;

  if (!timedRoleIds.includes(roleIdToResume)) {
    return interaction.editReply({
      content: `${targetUser} has no saved time for **${roleOption.name}**.`,
    });
  }

  const roleObj = guild.roles.cache.get(roleIdToResume);
  const roleName = roleObj?.name || "that role";

  const entry = await db.getTimerForRole(targetUser.id, roleIdToResume);

  if (!entry?.paused) {
    return interaction.editReply({
      content: `${targetUser}'s timer for **${roleName}** is not paused.`,
    });
  }

  if (!roleObj) {
    await db.clearRoleTimer(targetUser.id, roleIdToResume);
    return interaction.editReply({
      content: `That role no longer exists in this server, so I cleared the saved timer for ${targetUser}.`,
    });
  }

  const permCheck = await canManageRole(guild, roleObj);
  if (!permCheck.ok) {
    return interaction.editReply({ content: permCheck.reason });
  }

  const remainingMs = Math.max(0, Number(entry.paused_remaining_ms || 0));

  if (remainingMs <= 0) {
    await db.clearRoleTimer(targetUser.id, roleIdToResume);
    if (member.roles.cache.has(roleIdToResume)) {
      await member.roles.remove(roleIdToResume).catch(() => null);
    }
    return interaction.editReply({
      content: `No time remained to resume for ${targetUser} on **${roleName}**. Timer cleared and role removed.`,
    });
  }

  // Resume properly
  const newExpiresAt = await db.resumeTimer(targetUser.id, roleIdToResume);

  // Ensure role is on the member
  if (!member.roles.cache.has(roleIdToResume)) {
    await member.roles.add(roleIdToResume).catch(() => null);
  }

const embed = new EmbedBuilder()
  .setColor(0x2ECC71) // green = active
  .setAuthor({ name: "BoostMon", iconURL: BOOSTMON_ICON_URL })
  .setTitle("Timed Role Resumed")
  .setTimestamp(new Date())
  .addFields(
    { name: "Command Run By", value: `${interaction.user}`, inline: true },
    { name: "Time Run", value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
    { name: "Target User", value: `${targetUser}`, inline: true },
    { name: "Role", value: `${roleObj}`, inline: true },
    { name: "Remaining", value: `**${formatMs(remainingMs)}**`, inline: true },
    {
      name: "New Expiry",
      value: `<t:${Math.floor(newExpiresAt / 1000)}:F>\n(<t:${Math.floor(newExpiresAt / 1000)}:R>)`,
      inline: true,
    }
  )
  .setFooter({ text: "BoostMon • Active Timer" });

return interaction.editReply({ embeds: [embed] });

}


 
    // ---------- /settime ----------
    if (interaction.commandName === "settime") {
      // Defer immediately to prevent interaction timeout
      await interaction.deferReply().catch(() => null);

      if (!interaction.guild) {
        return interaction.editReply({ content: "This command can only be used in a server." });
      }

      const targetUser = interaction.options.getUser("user", true);
      const minutes = interaction.options.getInteger("minutes", true);
      const targetRole = interaction.options.getRole("role", true);
      const channelOpt = interaction.options.getChannel("channel"); // optional

      const guild = interaction.guild;

      const role = guild.roles.cache.get(targetRole.id);
      if (!role) {
        return interaction.editReply({ content: "I couldn't find that role in this server." });
      }

      const permCheck = await canManageRole(guild, role);
      if (!permCheck.ok) {
        return interaction.editReply({ content: permCheck.reason });
      }

      // Validate channel if provided (and whether bot can send there)
      let warnChannelId = null;
      let warnModeText = "No channel selected. Automatic expiry warnings will be DMed to the user.";

      if (channelOpt) {
        const channel = await guild.channels.fetch(channelOpt.id).catch(() => null);

        if (
          channel &&
          (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement)
        ) {
          const me = await guild.members.fetchMe();
          const perms = channel.permissionsFor(me);

          const canView = perms?.has(PermissionFlagsBits.ViewChannel);
          const canSend = perms?.has(PermissionFlagsBits.SendMessages);

          if (canView && canSend) {
            warnChannelId = channel.id;
            warnModeText = `Expiry warnings will be posted in ${channel}.`;
          } else {
            warnModeText =
              `I can't post warnings in ${channel} (missing View Channel or Send Messages). ` +
              `Warnings will be DMed to the user instead.`;
          }
        } else {
          warnModeText = "That channel isn't a text/announcement channel. Warnings will be DMed to the user.";
        }
      }

      const member = await guild.members.fetch(targetUser.id);

      const expiresAt = await setMinutesForRole(targetUser.id, role.id, minutes, warnChannelId, guild.id);
      await member.roles.add(role.id);


            
        const embed = new EmbedBuilder()
      .setColor(0x2ECC71) // active timer
      .setTitle("Timed Role Activated")
      .setAuthor({ name: "BoostMon", iconURL: BOOSTMON_ICON_URL })
      .setTimestamp(new Date())
      .addFields(
        { name: "Command Run By", value: `${interaction.user}`, inline: true },
        { name: "Time Run", value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
        { name: "Target User", value: `${targetUser}`, inline: true },
        { name: "Role Assigned", value: `${role}`, inline: true },
        { name: "Duration", value: `${minutes} minute(s)`, inline: true },
        {
          name: "Expires",
          value: `<t:${Math.floor(expiresAt / 1000)}:F>\n(<t:${Math.floor(expiresAt / 1000)}:R>)`,
          inline: true,
        },
        {
          name: "Warning Channel",
          value: warnChannelId ? `<#${warnChannelId}>` : "DMs",
          inline: true,
        },
        { name: "Notes", value: warnModeText, inline: false }
      )
      .setFooter({ text: "BoostMon • Active Timer", iconURL: BOOSTMON_ICON_URL });
    
    return interaction.editReply({ embeds: [embed] });
    }

    // ---------- /addtime ----------
    if (interaction.commandName === "addtime") {
      // Defer immediately to prevent interaction timeout
      await interaction.deferReply().catch(() => null);

      if (!interaction.guild) {
        return interaction.editReply({ content: "This command can only be used in a server." });
      }

      const targetUser = interaction.options.getUser("user", true);
      const minutes = interaction.options.getInteger("minutes", true);
      const roleOption = interaction.options.getRole("role"); // optional

      const guild = interaction.guild;
      const member = await guild.members.fetch(targetUser.id);

      const timers = await db.getTimersForUser(targetUser.id);
      const timedRoleIds = timers.map(t => t.role_id);

      let roleIdToEdit = null;

      if (roleOption) {
        roleIdToEdit = roleOption.id;
      } else {
        if (timedRoleIds.length === 1) {
          roleIdToEdit = timedRoleIds[0];
        } else if (timedRoleIds.length === 0) {
          return interaction.editReply({
            content: `${targetUser} has no active timed roles. Use /settime with a role first.`,
          });
        } else {
          return interaction.editReply({
            content: `${targetUser} has multiple timed roles. Please specify the role.`,
          });
        }
      }

      const role = guild.roles.cache.get(roleIdToEdit);
      if (!role) {
        return interaction.editReply({ content: "That role no longer exists in this server." });
      }

      const permCheck = await canManageRole(guild, role);
      if (!permCheck.ok) {
        return interaction.editReply({ content: permCheck.reason });
      }

      const expiresAt = await addMinutesForRole(targetUser.id, role.id, minutes, guild.id);

      if (!member.roles.cache.has(role.id)) {
        await member.roles.add(role.id);
      }

const embed = new EmbedBuilder()
  .setColor(0x2ECC71) // 🟢 active timer
  .setAuthor({
    name: "BoostMon",
    iconURL: BOOSTMON_ICON_URL,
  })
  .setTitle("Timed Role Extended")
  .setTimestamp(new Date())
  .addFields(
    { name: "Command Run By", value: `${interaction.user}`, inline: true },
    { name: "Time Run", value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
    { name: "Target User", value: `${targetUser}`, inline: true },
    { name: "Role", value: `${role}`, inline: true },
    { name: "Time Added", value: `${minutes} minute(s)`, inline: true },
    {
      name: "New Expiry",
      value: `<t:${Math.floor(expiresAt / 1000)}:F>\n(<t:${Math.floor(expiresAt / 1000)}:R>)`,
      inline: true,
    }
  )
  .setFooter({ text: "BoostMon • Active Timer" });

return interaction.editReply({
  embeds: [embed],
});
}

// ---------- /removetime ----------
if (interaction.commandName === "removetime") {
    // Defer immediately to prevent interaction timeout
    await interaction.deferReply().catch(() => null);

    if (!interaction.guild) {
    return interaction.editReply({ content: "This command can only be used in a server." });
  }

  const targetUser = interaction.options.getUser("user", true);
  const minutes = interaction.options.getInteger("minutes", true);
  const roleOption = interaction.options.getRole("role"); // optional

  const guild = interaction.guild;
  const member = await guild.members.fetch(targetUser.id);

  const timers = await db.getTimersForUser(targetUser.id);
  const timedRoleIds = timers.map(t => t.role_id);

  if (timedRoleIds.length === 0) {
    const embed = new EmbedBuilder()
      .setColor(0x95A5A6) // grey
      .setAuthor({ name: "BoostMon", iconURL: BOOSTMON_ICON_URL })
      .setTitle("No Active Timed Roles")
      .setTimestamp(new Date())
      .addFields({ name: "Target User", value: `${targetUser}`, inline: true })
      .setFooter({ text: "BoostMon" });

    return interaction.editReply({ embeds: [embed] });
  }

  // Decide which role to edit
  let roleIdToEdit = null;

  if (roleOption) {
    roleIdToEdit = roleOption.id;

    if (!timedRoleIds.includes(roleIdToEdit)) {
      const embed = new EmbedBuilder()
        .setColor(0xF1C40F) // yellow
        .setAuthor({ name: "BoostMon", iconURL: BOOSTMON_ICON_URL })
        .setTitle("No Saved Time For That Role")
        .setTimestamp(new Date())
        .addFields(
          { name: "Target User", value: `${targetUser}`, inline: true },
          { name: "Role", value: `${roleOption}`, inline: true }
        )
        .setFooter({ text: "BoostMon" });

      return interaction.editReply({ embeds: [embed] });
    }
  } else {
    const matching = timedRoleIds.filter((rid) => member.roles.cache.has(rid));

    if (matching.length === 1) {
      roleIdToEdit = matching[0];
    } else if (matching.length === 0) {
      if (timedRoleIds.length === 1) {
        roleIdToEdit = timedRoleIds[0];
      } else {
        const possible = timedRoleIds
          .map((rid) => guild.roles.cache.get(rid)?.name || rid)
          .slice(0, 15)
          .join(", ");

        const embed = new EmbedBuilder()
          .setColor(0xF1C40F) // yellow
          .setAuthor({ name: "BoostMon", iconURL: BOOSTMON_ICON_URL })
          .setTitle("Please Specify a Role")
          .setTimestamp(new Date())
          .addFields(
            { name: "Target User", value: `${targetUser}`, inline: true },
            { name: "Time To Remove", value: `${minutes} minute(s)`, inline: true },
            { name: "Reason", value: "Multiple timed roles are stored but none clearly matches current roles.", inline: false },
            { name: "Possible Stored Roles", value: possible || "None", inline: false }
          )
          .setFooter({ text: "BoostMon • Select a Role" });

        return interaction.editReply({ embeds: [embed] });
      }
    } else {
      const possible = matching
        .map((rid) => guild.roles.cache.get(rid)?.name || rid)
        .slice(0, 15)
        .join(", ");

      const embed = new EmbedBuilder()
        .setColor(0xF1C40F) // yellow
        .setAuthor({ name: "BoostMon", iconURL: BOOSTMON_ICON_URL })
        .setTitle("Please Specify a Role")
        .setTimestamp(new Date())
        .addFields(
          { name: "Target User", value: `${targetUser}`, inline: true },
          { name: "Time To Remove", value: `${minutes} minute(s)`, inline: true },
          { name: "Reason", value: "User currently has multiple timed roles.", inline: false },
          { name: "Possible Roles", value: possible || "None", inline: false }
        )
        .setFooter({ text: "BoostMon • Select a Role" });

      return interaction.editReply({ embeds: [embed] });
    }
  }

  const roleObj = guild.roles.cache.get(roleIdToEdit);
  if (!roleObj) {
    const embed = new EmbedBuilder()
      .setColor(0xE67E22) // orange
      .setAuthor({ name: "BoostMon", iconURL: BOOSTMON_ICON_URL })
      .setTitle("Role No Longer Exists")
      .setTimestamp(new Date())
      .addFields(
        { name: "Target User", value: `${targetUser}`, inline: true },
        { name: "Stored Role ID", value: `${roleIdToEdit}`, inline: true },
        { name: "Note", value: "That role was deleted from this server. Use /cleartime to remove the stored timer.", inline: false }
      )
      .setFooter({ text: "BoostMon" });

    return interaction.editReply({ embeds: [embed] });
  }

  const permCheck = await canManageRole(guild, roleObj);
  if (!permCheck.ok) {
    return interaction.editReply({ content: permCheck.reason });
  }

  const result = await removeMinutesForRole(targetUser.id, roleIdToEdit, minutes);

  if (result === null) {
    const embed = new EmbedBuilder()
      .setColor(0xF1C40F) // yellow
      .setAuthor({ name: "BoostMon", iconURL: BOOSTMON_ICON_URL })
      .setTitle("No Saved Time For That Role")
      .setTimestamp(new Date())
      .addFields(
        { name: "Target User", value: `${targetUser}`, inline: true },
        { name: "Role", value: `${roleObj}`, inline: true }
      )
      .setFooter({ text: "BoostMon" });

    return interaction.editReply({ embeds: [embed] });
  }

  // result is either 0 (expired) or an expiresAt timestamp (ms)
  if (result === 0) {
    if (member.roles.cache.has(roleIdToEdit)) {
      await member.roles.remove(roleIdToEdit).catch(() => null);
    }

    const embed = new EmbedBuilder()
      .setColor(0xE74C3C) // red
      .setAuthor({ name: "BoostMon", iconURL: BOOSTMON_ICON_URL })
      .setTitle("Timed Role Reduced (Expired)")
      .setTimestamp(new Date())
      .addFields(
        { name: "Command Run By", value: `${interaction.user}`, inline: true },
        { name: "Time Run", value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
        { name: "Target User", value: `${targetUser}`, inline: true },
        { name: "Role", value: `${roleObj}`, inline: true },
        { name: "Time Removed", value: `${minutes} minute(s)`, inline: true },
        { name: "Result", value: "Time expired — role removed.", inline: true }
      )
      .setFooter({ text: "BoostMon • Timer Ended" });

    return interaction.editReply({ embeds: [embed] });
  }

  const leftMs = Math.max(0, result - Date.now());

  const embed = new EmbedBuilder()
    .setColor(0x2ECC71) // green
    .setAuthor({ name: "BoostMon", iconURL: BOOSTMON_ICON_URL })
    .setTitle("Timed Role Reduced")
    .setTimestamp(new Date())
    .addFields(
      { name: "Command Run By", value: `${interaction.user}`, inline: true },
      { name: "Time Run", value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
      { name: "Target User", value: `${targetUser}`, inline: true },
      { name: "Role", value: `${roleObj}`, inline: true },
      { name: "Time Removed", value: `${minutes} minute(s)`, inline: true },
      { name: "Remaining", value: `**${formatMs(leftMs)}**`, inline: true },
      {
        name: "Expires",
        value: `<t:${Math.floor(result / 1000)}:F>\n(<t:${Math.floor(result / 1000)}:R>)`,
        inline: false,
      }
    )
    .setFooter({ text: "BoostMon • Active Timer" });

  return interaction.editReply({ embeds: [embed] });
}


    // ---------- /cleartime ----------
    if (interaction.commandName === "cleartime") {
      // Defer immediately to prevent interaction timeout
      await interaction.deferReply().catch(() => null);

      if (!interaction.guild) {
        return interaction.editReply({ content: "This command can only be used in a server." });
      }

      const targetUser = interaction.options.getUser("user", true);
      const roleOption = interaction.options.getRole("role"); // optional

      const guild = interaction.guild;
      const member = await guild.members.fetch(targetUser.id);

      const timers = await db.getTimersForUser(targetUser.id);
      const timedRoleIds = timers.map(t => t.role_id);

      if (timedRoleIds.length === 0) {
        return interaction.editReply({ content: `${targetUser} has no active timed roles.` });
      }

      // Pick role to clear
      let roleIdToClear = null;

      if (roleOption) {
        roleIdToClear = roleOption.id;
        if (!timedRoleIds.includes(roleIdToClear)) {
          return interaction.editReply({
            content: `${targetUser} has no saved time for **${roleOption.name}**.`,
          });
        }
      } else {
        // "first found role" behavior: prefer one they currently have, else first stored
        const matching = timedRoleIds.find((rid) => member.roles.cache.has(rid));
        roleIdToClear = matching || timedRoleIds[0];
      }

      const roleObj = guild.roles.cache.get(roleIdToClear);
      if (!roleObj) {
        // Role deleted, but timer exists. Clear timer anyway.
        await db.clearRoleTimer(targetUser.id, roleIdToClear);
        return interaction.editReply({
          content: `Cleared saved time for ${targetUser}. (Role no longer exists in this server.)`,
        });
      }

      const permCheck = await canManageRole(guild, roleObj);
      if (!permCheck.ok) {
        return interaction.editReply({ content: permCheck.reason });
      }

      await db.clearRoleTimer(targetUser.id, roleIdToClear);

      if (member.roles.cache.has(roleIdToClear)) {
        await member.roles.remove(roleIdToClear);
      }

      return interaction.editReply({
        content: `Cleared saved time for ${targetUser} on **${roleObj.name}** and removed the role.`,
      });
    }

    // ---------- /showtime ----------
    if (interaction.commandName === "showtime") {
      // Defer immediately to prevent interaction timeout
      await interaction.deferReply().catch(() => null);

      const targetUser = interaction.options.getUser("user") ?? interaction.user;
      const role = interaction.options.getRole("role"); // optional

      if (role) {
        const timer = await db.getTimerForRole(targetUser.id, role.id);
        if (!timer) {
          const embed = new EmbedBuilder()
            .setColor(0x95A5A6) // grey
            .setAuthor({ name: "BoostMon", iconURL: BOOSTMON_ICON_URL })
            .setTitle("No Active Timer")
            .setTimestamp(new Date())
            .addFields(
              { name: "Target User", value: `${targetUser}`, inline: true },
              { name: "Role", value: `${role.name}`, inline: true },
              { name: "Time Remaining", value: "0 minutes", inline: true }
            )
            .setFooter({ text: "BoostMon • No Timer" });
          return interaction.editReply({ embeds: [embed] });
        }
        
        // Calculate remaining time
        let remainingMs = Number(timer.expires_at) - Date.now();
        const isPaused = timer.paused;
        if (isPaused && timer.paused_remaining_ms) {
          remainingMs = Number(timer.paused_remaining_ms);
        }
        
        if (remainingMs <= 0) {
          const embed = new EmbedBuilder()
            .setColor(0xE74C3C) // red
            .setAuthor({ name: "BoostMon", iconURL: BOOSTMON_ICON_URL })
            .setTitle("Timer Expired")
            .setTimestamp(new Date())
            .addFields(
              { name: "Target User", value: `${targetUser}`, inline: true },
              { name: "Role", value: `${role.name}`, inline: true },
              { name: "Time Remaining", value: "0 minutes (expired)", inline: true }
            )
            .setFooter({ text: "BoostMon • Expired" });
          return interaction.editReply({ embeds: [embed] });
        }

        const expiresAt = Date.now() + remainingMs;
        const statusColor = isPaused ? 0xF1C40F : 0x2ECC71; // yellow if paused, green if active
        const statusTitle = isPaused ? "⏸️ Timer Paused" : "⏱️ Timer Active";
        const statusFooter = isPaused ? "BoostMon • Paused Timer" : "BoostMon • Active Timer";

        const embed = new EmbedBuilder()
          .setColor(statusColor)
          .setAuthor({ name: "BoostMon", iconURL: BOOSTMON_ICON_URL })
          .setTitle(statusTitle)
          .setTimestamp(new Date())
          .addFields(
            { name: "Target User", value: `${targetUser}`, inline: true },
            { name: "Role", value: `${role.name}`, inline: true },
            { name: "Time Remaining", value: `**${formatMs(remainingMs)}**`, inline: true },
            { 
              name: "Expires", 
              value: `<t:${Math.floor(expiresAt / 1000)}:F>\n(<t:${Math.floor(expiresAt / 1000)}:R>)`, 
              inline: false 
            }
          )
          .setFooter({ text: statusFooter });
        
        return interaction.editReply({ embeds: [embed] });
      }

      const currentRoleId = await getFirstTimedRoleId(targetUser.id);
      if (!currentRoleId) {
        const embed = new EmbedBuilder()
          .setColor(0x95A5A6) // grey
          .setAuthor({ name: "BoostMon", iconURL: BOOSTMON_ICON_URL })
          .setTitle("No Active Timers")
          .setTimestamp(new Date())
          .addFields(
            { name: "Target User", value: `${targetUser}`, inline: true },
            { name: "Status", value: "No timed roles found", inline: true }
          )
          .setFooter({ text: "BoostMon" });
        return interaction.editReply({ embeds: [embed] });
      }

      const timer = await db.getTimerForRole(targetUser.id, currentRoleId);
      const roleObj = interaction.guild?.roles?.cache?.get(currentRoleId);

      if (!timer) {
        const embed = new EmbedBuilder()
          .setColor(0x95A5A6) // grey
          .setAuthor({ name: "BoostMon", iconURL: BOOSTMON_ICON_URL })
          .setTitle("No Active Timer")
          .setTimestamp(new Date())
          .addFields(
            { name: "Target User", value: `${targetUser}`, inline: true },
            { name: "Status", value: "No timed role found", inline: true }
          )
          .setFooter({ text: "BoostMon" });
        return interaction.editReply({ embeds: [embed] });
      }

      let remainingMs = Number(timer.expires_at) - Date.now();
      const isPaused = timer.paused;
      if (isPaused && timer.paused_remaining_ms) {
        remainingMs = Number(timer.paused_remaining_ms);
      }

      if (remainingMs <= 0) {
        const embed = new EmbedBuilder()
          .setColor(0xE74C3C) // red
          .setAuthor({ name: "BoostMon", iconURL: BOOSTMON_ICON_URL })
          .setTitle("Timer Expired")
          .setTimestamp(new Date())
          .addFields(
            { name: "Target User", value: `${targetUser}`, inline: true },
            { name: "Role", value: roleObj ? `${roleObj.name}` : "Unknown", inline: true },
            { name: "Time Remaining", value: "0 minutes (expired)", inline: true }
          )
          .setFooter({ text: "BoostMon • Expired" });
        return interaction.editReply({ embeds: [embed] });
      }

      const expiresAt = Date.now() + remainingMs;
      const statusColor = isPaused ? 0xF1C40F : 0x2ECC71; // yellow if paused, green if active
      const statusTitle = isPaused ? "⏸️ Timer Paused" : "⏱️ Timer Active";
      const statusFooter = isPaused ? "BoostMon • Paused Timer" : "BoostMon • Active Timer";

      const embed = new EmbedBuilder()
        .setColor(statusColor)
        .setAuthor({ name: "BoostMon", iconURL: BOOSTMON_ICON_URL })
        .setTitle(statusTitle)
        .setTimestamp(new Date())
        .addFields(
          { name: "Target User", value: `${targetUser}`, inline: true },
          { name: "Role", value: roleObj ? `${roleObj.name}` : "Unknown", inline: true },
          { name: "Time Remaining", value: `**${formatMs(remainingMs)}**`, inline: true },
          { 
            name: "Expires", 
            value: `<t:${Math.floor(expiresAt / 1000)}:F>\n(<t:${Math.floor(expiresAt / 1000)}:R>)`, 
              inline: false 
          }
        )
        .setFooter({ text: statusFooter });
      
      return interaction.editReply({ embeds: [embed] });
    }

    // ---------- /rolestatus ----------
    if (interaction.commandName === "rolestatus") {
      // Defer immediately to prevent interaction timeout
      await interaction.deferReply().catch(() => null);

      if (!interaction.guild) {
        return interaction.editReply({ content: "This command can only be used in a server." });
      }

      const subcommand = interaction.options.getSubcommand();
      const subcommandGroup = interaction.options.getSubcommandGroup();
      const guild = interaction.guild;

      // ===== ROLESTATUS VIEW =====
      if (subcommand === "view") {

        const roleOption = interaction.options.getRole("role", true);

        // OPTIMIZATION: Query database FIRST to get timers for this role
        // Then fetch only those members from Discord
        const timersFromDb = await db.getTimersForRole(roleOption.id).catch(() => []);
        
        if (timersFromDb.length === 0) {
          const embed = new EmbedBuilder()
            .setColor(0x95A5A6) // grey
            .setAuthor({ name: "BoostMon", iconURL: BOOSTMON_ICON_URL })
            .setTitle("Role Status")
            .setTimestamp(new Date())
            .addFields(
              { name: "Role", value: `${roleOption.name}`, inline: true },
              { name: "Members", value: "0", inline: true },
              { name: "Status", value: "No members have timers for this role", inline: false }
            )
            .setFooter({ text: "BoostMon • Role Status" });
          return interaction.editReply({ embeds: [embed] });
        }

        // Fetch only the members that have timers for this role
        const timersList = [];
        for (const timer of timersFromDb) {
          try {
            const member = await guild.members.fetch(timer.user_id).catch(() => null);
            if (member) {
              timersList.push({ member, timer });
            }
          } catch (err) {
            console.error(`Failed to fetch member ${timer.user_id}:`, err);
          }
        }

        // If no members found, they may have left the server
        if (timersList.length === 0) {
          const embed = new EmbedBuilder()
            .setColor(0x95A5A6) // grey
            .setAuthor({ name: "BoostMon", iconURL: BOOSTMON_ICON_URL })
            .setTitle("Role Status")
            .setTimestamp(new Date())
            .addFields(
              { name: "Role", value: `${roleOption.name}`, inline: true },
              { name: "Members", value: "0", inline: true },
              { name: "Status", value: "Members with timers have left the server", inline: false }
            )
            .setFooter({ text: "BoostMon • Role Status" });
          return interaction.editReply({ embeds: [embed] });
        }

        // Sort by time remaining (ascending - expires soonest first)
        timersList.sort((a, b) => {
          let aMs = Number(a.timer.expires_at) - Date.now();
          let bMs = Number(b.timer.expires_at) - Date.now();
          
          if (a.timer.paused && a.timer.paused_remaining_ms) {
            aMs = Number(a.timer.paused_remaining_ms);
          }
          if (b.timer.paused && b.timer.paused_remaining_ms) {
            bMs = Number(b.timer.paused_remaining_ms);
          }
          
          return aMs - bMs;
        });

        // Build field list (max 25 fields per embed, but Discord recommends less)
        const fields = [];
        let totalMembers = 0;
        let activeMembers = 0;
        let pausedMembers = 0;

        for (const { member, timer } of timersList) {
          totalMembers++;
          const isPaused = timer.paused;
          if (isPaused) pausedMembers++;
          else activeMembers++;

          let remainingMs = Number(timer.expires_at) - Date.now();
          if (isPaused && timer.paused_remaining_ms) {
            remainingMs = Number(timer.paused_remaining_ms);
          }

          const status = isPaused ? "⏸️ PAUSED" : remainingMs <= 0 ? "🔴 EXPIRED" : "🟢 ACTIVE";
          const timeText = remainingMs > 0 ? formatMs(remainingMs) : "0s";
          
          // Limit to 20 members per embed (leave room for summary field)
          if (fields.length < 20) {
            fields.push({
              name: `${member.user.username}`,
              value: `${status} • ${timeText}`,
              inline: false
            });
          }
        }

        const embed = new EmbedBuilder()
          .setColor(0x2ECC71) // green
          .setAuthor({ name: "BoostMon", iconURL: BOOSTMON_ICON_URL })
          .setTitle(`${roleOption.name} - Status Report`)
          .setTimestamp(new Date())
          .addFields(...fields)
          .addFields(
            { name: "━━━━━━━━━━━━━━━", value: "Summary", inline: false },
            { name: "Total Members", value: `${totalMembers}`, inline: true },
            { name: "Active ⏱️", value: `${activeMembers}`, inline: true },
            { name: "Paused ⏸️", value: `${pausedMembers}`, inline: true }
          )
          .setFooter({ text: `BoostMon • Showing ${Math.min(timersList.length, 20)} members` });

        return interaction.editReply({ embeds: [embed] });
      }

      // ===== ROLESTATUS SCHEDULE SUBCOMMANDS =====
      if (subcommandGroup === "schedule") {
        const scheduleSubcommand = interaction.options.getSubcommand();

        if (scheduleSubcommand === "set") {
          // Check permissions
          if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
            return interaction.editReply({
              content: "You need **Manage Messages** permission to set up automated reports.",
            });
          }

          const role = interaction.options.getRole("role", true);
          const channel = interaction.options.getChannel("channel", true);
          const interval = interaction.options.getInteger("interval", true);

          // Validate channel is text-based
          if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
            return interaction.editReply({
              content: "Channel must be a text or announcement channel.",
            });
          }

          // Check bot permissions in target channel
          const me = await guild.members.fetchMe();
          const perms = channel.permissionsFor(me);

          if (!perms?.has(PermissionFlagsBits.SendMessages)) {
            return interaction.editReply({
              content: `I don't have permission to send messages in ${channel}.`,
            });
          }

          // Create schedule in database
          const schedule = await db.createRolestatusSchedule(guild.id, role.id, channel.id, interval);
          
          if (!schedule) {
            return interaction.editReply({
              content: "Failed to create schedule. Please try again.",
            });
          }

          const embed = new EmbedBuilder()
            .setColor(0x2ECC71)
            .setAuthor({ name: "BoostMon", iconURL: BOOSTMON_ICON_URL })
            .setTitle("✅ Schedule Created")
            .setTimestamp(new Date())
            .addFields(
              { name: "Role", value: `${role.name}`, inline: true },
              { name: "Channel", value: `${channel.name}`, inline: true },
              { name: "Interval", value: `Every ${interval} minutes`, inline: true },
              { name: "Status", value: "🟢 Active - Reports will begin shortly", inline: false }
            )
            .setFooter({ text: "BoostMon • Scheduled Report Started" });

          return interaction.editReply({ embeds: [embed] });
        }

        if (scheduleSubcommand === "disable") {
          // Check permissions
          if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
            return interaction.editReply({
              content: "You need **Manage Messages** permission to disable automated reports.",
            });
          }

          const role = interaction.options.getRole("role", true);

          // Disable all schedules for this role
          const success = await db.disableRolestatusSchedule(guild.id, role.id);

          if (!success) {
            return interaction.editReply({
              content: `No active schedules found for ${role.name}.`,
            });
          }

          const embed = new EmbedBuilder()
            .setColor(0xE74C3C)
            .setAuthor({ name: "BoostMon", iconURL: BOOSTMON_ICON_URL })
            .setTitle("⛔ Schedule Disabled")
            .setTimestamp(new Date())
            .addFields(
              { name: "Role", value: `${role.name}`, inline: true },
              { name: "Status", value: "🔴 Inactive - Reports stopped", inline: true }
            )
            .setFooter({ text: "BoostMon • Scheduled Report Stopped" });

          return interaction.editReply({ embeds: [embed] });
        }

        if (scheduleSubcommand === "list") {
          const schedules = await db.getAllRolestatusSchedules(guild.id);

          if (schedules.length === 0) {
            return interaction.editReply({
              content: "No active role status schedules in this server.",
            });
          }

          const fields = [];
          for (const schedule of schedules) {
            try {
              const role = await guild.roles.fetch(schedule.role_id).catch(() => null);
              const channel = await guild.channels.fetch(schedule.channel_id).catch(() => null);

              if (role && channel) {
                fields.push({
                  name: `${role.name}`,
                  value: `📢 Posts to ${channel.name}\n⏱️ Every ${schedule.interval_minutes} min`,
                  inline: false,
                });
              }
            } catch (err) {
              console.error("Error fetching schedule details:", err);
            }
          }

          const embed = new EmbedBuilder()
            .setColor(0x3498DB)
            .setAuthor({ name: "BoostMon", iconURL: BOOSTMON_ICON_URL })
            .setTitle("📋 Active Role Status Schedules")
            .setTimestamp(new Date())
            .addFields(...fields)
            .setFooter({ text: `BoostMon • ${schedules.length} schedule(s) active` });

          return interaction.editReply({ embeds: [embed] });
        }
      }
    }

    // ---------- /autopurge ----------
    if (interaction.commandName === "autopurge") {
      // Defer immediately to prevent interaction timeout
      await interaction.deferReply().catch(() => null);

      if (!interaction.guild) {
        return interaction.editReply({ content: "This command can only be used in a server." });
      }

      const subcommand = interaction.options.getSubcommand();
      const guild = interaction.guild;

      if (subcommand === "set") {
        const channel = interaction.options.getChannel("channel", true);
        const type = interaction.options.getString("type", true);
        const lines = interaction.options.getInteger("lines", true);
        const interval = interaction.options.getInteger("interval", true);

        // Validate channel is text-based
        if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
          return interaction.editReply({ content: "Channel must be a text or announcement channel." });
        }

        // Check bot permissions in the target channel
        const me = await guild.members.fetchMe();
        const perms = channel.permissionsFor(me);

        if (!perms?.has(PermissionFlagsBits.ManageMessages)) {
          return interaction.editReply({
            content: `I don't have **Manage Messages** permission in ${channel}. I need this to delete messages.`,
          });
        }

        // Save to database
        const intervalSeconds = interval * 60;
        const setting = await db.setAutopurgeSetting(guild.id, channel.id, type, lines, intervalSeconds);

        if (!setting) {
          return interaction.editReply({ content: "Failed to save autopurge setting. Try again later." });
        }

        const embed = new EmbedBuilder()
          .setColor(0x2ECC71)
          .setAuthor({ name: "BoostMon", iconURL: BOOSTMON_ICON_URL })
          .setTitle("✅ Auto-Purge Enabled")
          .setTimestamp(new Date())
          .addFields(
            { name: "Channel", value: `${channel}`, inline: true },
            { name: "Message Type", value: `${type === "bot" ? "🤖 Bot Only" : type === "user" ? "👤 User Only" : "🔀 Both"}`, inline: true },
            { name: "Lines per Purge", value: `${lines}`, inline: true },
            { name: "Interval", value: `${interval} minute(s)`, inline: true },
            { name: "Next Purge", value: `In ~${interval} minute(s)`, inline: true }
          )
          .setFooter({ text: "BoostMon • Auto-Purge Active" });

        return interaction.editReply({ embeds: [embed] });
      }

      if (subcommand === "disable") {
        const channel = interaction.options.getChannel("channel", true);

        const setting = await db.getAutopurgeSetting(guild.id, channel.id);
        if (!setting) {
          return interaction.editReply({
            content: `No auto-purge setting found for ${channel}.`,
          });
        }

        const disabled = await db.disableAutopurgeSetting(guild.id, channel.id);
        if (!disabled) {
          return interaction.editReply({ content: "Failed to disable auto-purge. Try again later." });
        }

        const embed = new EmbedBuilder()
          .setColor(0xE74C3C)
          .setAuthor({ name: "BoostMon", iconURL: BOOSTMON_ICON_URL })
          .setTitle("❌ Auto-Purge Disabled")
          .setTimestamp(new Date())
          .addFields({ name: "Channel", value: `${channel}`, inline: true })
          .setFooter({ text: "BoostMon • Auto-Purge Disabled" });

        return interaction.editReply({ embeds: [embed] });
      }

      if (subcommand === "status") {
        const settings = await db.getAllAutopurgeSettings(guild.id).catch(() => []);

        if (settings.length === 0) {
          const embed = new EmbedBuilder()
            .setColor(0x95A5A6)
            .setAuthor({ name: "BoostMon", iconURL: BOOSTMON_ICON_URL })
            .setTitle("Auto-Purge Status")
            .setTimestamp(new Date())
            .addFields({ name: "Settings", value: "No active auto-purge settings in this server", inline: false })
            .setFooter({ text: "BoostMon" });
          return interaction.editReply({ embeds: [embed] });
        }

        const fields = [];
        for (const setting of settings) {
          const channel = guild.channels.cache.get(setting.channel_id);
          const channelName = channel ? channel.toString() : `<#${setting.channel_id}>`;
          const typeEmoji = setting.type === "bot" ? "🤖" : setting.type === "user" ? "👤" : "🔀";
          const intervalMins = Math.floor(setting.interval_seconds / 60);
          const lastPurge = setting.last_purge_at
            ? `<t:${Math.floor(new Date(setting.last_purge_at).getTime() / 1000)}:R>`
            : "Never";

          fields.push({
            name: `${typeEmoji} ${channelName}`,
            value: `**Lines:** ${setting.lines} | **Interval:** ${intervalMins}m | **Last Purge:** ${lastPurge}`,
            inline: false,
          });
        }

        const embed = new EmbedBuilder()
          .setColor(0x3498DB)
          .setAuthor({ name: "BoostMon", iconURL: BOOSTMON_ICON_URL })
          .setTitle("Auto-Purge Status")
          .setTimestamp(new Date())
          .addFields(...fields)
          .addFields({ name: "━━━━━━━━━━━━━━━", value: `Total: ${settings.length}`, inline: false })
          .setFooter({ text: "BoostMon • Active Settings" });

        return interaction.editReply({ embeds: [embed] });
      }
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
// SECTION 7 — Express Web Server
//----------------------------------------

const app = express();
const PORT = process.env.PORT || 3000;

app.use((req, res, next) => {
  console.info(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

app.use(express.json()); // Parse JSON request bodies
app.use(cookieParser());
app.use(express.static(path.resolve(__dirname, "public")));
app.use("/", indexRouter);
app.use("/auth", authRouter);
app.use("/", dashboardRouter);

// Version endpoint - available to all
app.get('/api/version', (req, res) => {
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
// SECTION 8 — Timers: Warnings + Expiry Cleanup
//----------------------------------------

// ===== SCHEDULED ROLESTATUS REPORTING =====

async function executeScheduledRolestatus(guild, now) {
  try {
    const schedules = await db.getAllRolestatusSchedules(guild.id).catch(() => []);

    for (const schedule of schedules) {
      const channel = guild.channels.cache.get(schedule.channel_id);
      if (!channel) {
        console.warn(`[SCHEDULED-REPORT] Channel ${schedule.channel_id} not found in guild ${guild.id}`);
        continue;
      }

      // Check if channel is text-based
      if (!channel.isTextBased()) {
        console.warn(`[SCHEDULED-REPORT] Channel ${channel.name} is not text-based`);
        continue;
      }

      // Check bot permissions in this specific channel
      const me = await guild.members.fetchMe().catch(() => null);
      if (!me) {
        console.warn(`[SCHEDULED-REPORT] Could not fetch bot member in guild ${guild.id}`);
        continue;
      }

      const perms = channel.permissionsFor(me);
      if (!perms?.has(PermissionFlagsBits.SendMessages)) {
        console.error(`[SCHEDULED-REPORT] Missing SendMessages permission in channel ${channel.name} (${schedule.channel_id}) for guild ${guild.id}`);
        continue;
      }

      if (!perms?.has(PermissionFlagsBits.EmbedLinks)) {
        console.error(`[SCHEDULED-REPORT] Missing EmbedLinks permission in channel ${channel.name} (${schedule.channel_id}) for guild ${guild.id}`);
        continue;
      }

      // Check if it's time to run the report
      const lastReportTime = schedule.last_report_at ? new Date(schedule.last_report_at).getTime() : 0;
      const timeSinceLastReport = now - lastReportTime;
      const intervalMs = schedule.interval_minutes * 60 * 1000;

      if (timeSinceLastReport < intervalMs) {
        continue; // Not time yet
      }

      try {
        // Get timers for this role (same logic as /rolestatus view)
        const timersFromDb = await db.getTimersForRole(schedule.role_id).catch(() => []);

        if (timersFromDb.length === 0) {
          // No timers - send empty report
          const embed = new EmbedBuilder()
            .setColor(0x95A5A6)
            .setAuthor({ name: "BoostMon", iconURL: BOOSTMON_ICON_URL })
            .setTitle("📋 Role Status Report")
            .setTimestamp(new Date())
            .addFields(
              { name: "Role", value: `<@&${schedule.role_id}>`, inline: true },
              { name: "Members", value: "0", inline: true },
              { name: "Status", value: "No members have active timers", inline: false }
            )
            .setFooter({ text: "BoostMon • Automated Report" });

          try {
            await channel.send({ embeds: [embed] });
            await db.updateRolestatusLastReport(guild.id, schedule.role_id, schedule.channel_id);
          } catch (err) {
            console.error(`[SCHEDULED-REPORT] Failed to send empty report to ${channel.name}: ${err.message}`);
          }
          continue;
        }

        // Fetch members
        const timersList = [];
        for (const timer of timersFromDb) {
          try {
            const member = await guild.members.fetch(timer.user_id).catch(() => null);
            if (member) {
              timersList.push({ member, timer });
            }
          } catch (err) {
            console.error(`Failed to fetch member ${timer.user_id}:`, err);
          }
        }

        if (timersList.length === 0) {
          // Timers exist but members left server
          const embed = new EmbedBuilder()
            .setColor(0x95A5A6)
            .setAuthor({ name: "BoostMon", iconURL: BOOSTMON_ICON_URL })
            .setTitle("📋 Role Status Report")
            .setTimestamp(new Date())
            .addFields(
              { name: "Role", value: `<@&${schedule.role_id}>`, inline: true },
              { name: "Members", value: "0", inline: true },
              { name: "Status", value: "Members with timers have left the server", inline: false }
            )
            .setFooter({ text: "BoostMon • Automated Report" });

          try {
            await channel.send({ embeds: [embed] });
            await db.updateRolestatusLastReport(guild.id, schedule.role_id, schedule.channel_id);
          } catch (err) {
            console.error(`[SCHEDULED-REPORT] Failed to send left-members report to ${channel.name}: ${err.message}`);
          }
          continue;
        }

        // Sort by time remaining (expires soonest first)
        timersList.sort((a, b) => {
          let aMs = Number(a.timer.expires_at) - now;
          let bMs = Number(b.timer.expires_at) - now;
          
          if (a.timer.paused && a.timer.paused_remaining_ms) {
            aMs = Number(a.timer.paused_remaining_ms);
          }
          if (b.timer.paused && b.timer.paused_remaining_ms) {
            bMs = Number(b.timer.paused_remaining_ms);
          }
          
          return aMs - bMs;
        });

        // Build field list
        const fields = [];
        let totalMembers = 0;
        let activeMembers = 0;
        let pausedMembers = 0;

        for (const { member, timer } of timersList) {
          totalMembers++;
          const isPaused = timer.paused;
          if (isPaused) pausedMembers++;
          else activeMembers++;

          let remainingMs = Number(timer.expires_at) - now;
          if (isPaused && timer.paused_remaining_ms) {
            remainingMs = Number(timer.paused_remaining_ms);
          }

          const status = isPaused ? "⏸️ PAUSED" : remainingMs <= 0 ? "🔴 EXPIRED" : "🟢 ACTIVE";
          const timeText = remainingMs > 0 ? formatMs(remainingMs) : "0s";
          
          // Limit to 20 members per embed
          if (fields.length < 20) {
            fields.push({
              name: `${member.user.username}`,
              value: `${status} • ${timeText}`,
              inline: false
            });
          }
        }

        const embed = new EmbedBuilder()
          .setColor(0x2ECC71)
          .setAuthor({ name: "BoostMon", iconURL: BOOSTMON_ICON_URL })
          .setTitle("📋 Role Status Report")
          .setTimestamp(new Date())
          .addFields(...fields)
          .addFields(
            { name: "━━━━━━━━━━━━━━━", value: "Summary", inline: false },
            { name: "Total Members", value: `${totalMembers}`, inline: true },
            { name: "Active ⏱️", value: `${activeMembers}`, inline: true },
            { name: "Paused ⏸️", value: `${pausedMembers}`, inline: true }
          )
          .setFooter({ text: `BoostMon • Automated Report (showing ${Math.min(timersList.length, 20)}/${totalMembers})` });

        // Delete old message if it exists
        if (schedule.last_message_id) {
          try {
            const oldMessage = await channel.messages.fetch(schedule.last_message_id).catch(() => null);
            if (oldMessage) {
              await oldMessage.delete().catch(() => null);
              console.log(`[SCHEDULED-REPORT] Deleted old message ${schedule.last_message_id} from ${channel.name}`);
            }
          } catch (err) {
            console.warn(`[SCHEDULED-REPORT] Could not delete old message: ${err.message}`);
          }
        }

        // Send new message
        let newMessage = null;
        try {
          // Double-check permissions right before sending
          const currentPerms = channel.permissionsFor(me);
          if (!currentPerms?.has(PermissionFlagsBits.SendMessages)) {
            console.error(`[SCHEDULED-REPORT] Permission check failed right before send in ${channel.name}: Missing SendMessages`);
            continue;
          }
          if (!currentPerms?.has(PermissionFlagsBits.EmbedLinks)) {
            console.error(`[SCHEDULED-REPORT] Permission check failed right before send in ${channel.name}: Missing EmbedLinks`);
            continue;
          }

          newMessage = await channel.send({ embeds: [embed] });
          console.log(`[SCHEDULED-REPORT] Sent new report to ${channel.name} in guild ${guild.name} (message ID: ${newMessage.id})`);
        } catch (err) {
          console.error(`[SCHEDULED-REPORT] Failed to send report to ${channel.name} in guild ${guild.name}: ${err.message}`);
          console.error(`[SCHEDULED-REPORT] Error code: ${err.code}, HTTP Status: ${err.status}`);
        }

        // Update last report time and message ID
        await db.updateRolestatusLastReport(guild.id, schedule.role_id, schedule.channel_id);
        if (newMessage) {
          await db.updateRolestatusLastMessageId(guild.id, schedule.role_id, schedule.channel_id, newMessage.id);
        }
      } catch (err) {
        console.error(`[SCHEDULED-REPORT] Error processing schedule for role ${schedule.role_id} in guild ${guild.name}: ${err.message}`);
      }
    }
  } catch (err) {
    console.error("executeScheduledRolestatus error:", err);
  }
}

async function executeAutopurges(guild, now) {
  try {
    const settings = await db.getAllAutopurgeSettings(guild.id).catch(() => []);

    for (const setting of settings) {
      const channel = guild.channels.cache.get(setting.channel_id);
      if (!channel) continue;

      // Check if it's time to purge
      const lastPurgeTime = setting.last_purge_at ? new Date(setting.last_purge_at).getTime() : 0;
      const timeSinceLastPurge = now - lastPurgeTime;
      const intervalMs = setting.interval_seconds * 1000;

      if (timeSinceLastPurge < intervalMs) {
        continue; // Not time yet
      }

      // Fetch messages to purge
      try {
        const messages = await channel
          .messages.fetch({ limit: Math.min(setting.lines + 5, 100) })
          .catch(() => null);

        if (!messages || messages.size === 0) {
          await db.updateAutopurgeLastPurge(guild.id, setting.channel_id);
          continue;
        }

        let messagesToDelete = [];

        for (const msg of messages.values()) {
          if (messagesToDelete.length >= setting.lines) break;

          // Filter by message type
          const isBot = msg.author.bot;
          const isUser = !msg.author.bot;

          let shouldDelete = false;
          if (setting.type === "bot" && isBot) shouldDelete = true;
          if (setting.type === "user" && isUser) shouldDelete = true;
          if (setting.type === "both") shouldDelete = true;

          // Don't delete pinned messages
          if (msg.pinned) shouldDelete = false;

          // Don't delete if older than 14 days (Discord API limitation)
          const messageAge = now - msg.createdTimestamp;
          if (messageAge > 14 * 24 * 60 * 60 * 1000) shouldDelete = false;

          if (shouldDelete) {
            messagesToDelete.push(msg);
          }
        }

        // Delete messages using bulkDelete (more efficient)
        if (messagesToDelete.length > 0) {
          await channel.bulkDelete(messagesToDelete, true).catch((err) => {
            console.warn(
              `[AUTOPURGE] Failed to bulk delete ${messagesToDelete.length} messages from ${channel.name}: ${err.message}`
            );
          });

          console.log(
            `[AUTOPURGE] Purged ${messagesToDelete.length} ${setting.type} message(s) from ${channel.name}`
          );
        }

        // Update last purge time
        await db.updateAutopurgeLastPurge(guild.id, setting.channel_id);
      } catch (err) {
        console.error(`[AUTOPURGE] Error processing channel ${setting.channel_id}:`, err.message);
      }
    }
  } catch (err) {
    console.error("executeAutopurges error:", err);
  }
}

// Send warning notification to channel or DM
async function sendWarningOrDm(guild, userId, roleId, leftMin, warnChannelId) {
  try {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return;

    const role = guild.roles.cache.get(roleId);
    const roleDisplay = role ? role.name : `<@&${roleId}>`;

    const embed = new EmbedBuilder()
      .setColor(0xF39C12)
      .setAuthor({ name: "BoostMon", iconURL: BOOSTMON_ICON_URL })
      .setTitle("⏰ Timer Warning")
      .setDescription(`Your **${roleDisplay}** role expires in **${leftMin}** minute(s)!`)
      .setTimestamp(new Date())
      .setFooter({ text: "BoostMon • Timer Warning" });

    if (warnChannelId) {
      const channel = guild.channels.cache.get(warnChannelId);
      if (channel && channel.isTextBased()) {
        await channel.send({ content: `${member}`, embeds: [embed] }).catch(() => null);
      } else {
        // Fallback to DM if channel not found
        await member.send({ embeds: [embed] }).catch(() => null);
      }
    } else {
      // Send DM
      await member.send({ embeds: [embed] }).catch(() => null);
    }
  } catch (err) {
    console.error("sendWarningOrDm error:", err.message);
  }
}

// Send expiration notice when timer expires
async function sendExpiredNoticeOrDm(guild, userId, roleId, warnChannelId) {
  try {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return;

    const role = guild.roles.cache.get(roleId);
    const roleDisplay = role ? role.name : `<@&${roleId}>`;

    const embed = new EmbedBuilder()
      .setColor(0xE74C3C)
      .setAuthor({ name: "BoostMon", iconURL: BOOSTMON_ICON_URL })
      .setTitle("❌ Timer Expired")
      .setDescription(`Your **${roleDisplay}** role has been removed due to timer expiration.`)
      .setTimestamp(new Date())
      .setFooter({ text: "BoostMon • Timer Expired" });

    if (warnChannelId) {
      const channel = guild.channels.cache.get(warnChannelId);
      if (channel && channel.isTextBased()) {
        await channel.send({ content: `${member}`, embeds: [embed] }).catch(() => null);
      } else {
        // Fallback to DM if channel not found
        await member.send({ embeds: [embed] }).catch(() => null);
      }
    } else {
      // Send DM
      await member.send({ embeds: [embed] }).catch(() => null);
    }
  } catch (err) {
    console.error("sendExpiredNoticeOrDm error:", err.message);
  }
}

async function cleanupAndWarn() {
  try {
    if (!client.isReady()) return;

    const now = Date.now();

    // Get all active timers from database
    const allTimers = await db.getAllActiveTimers().catch(() => []);

    // Group timers by guild_id for efficient processing
    const timersByGuild = {};
    for (const timer of allTimers) {
      const gId = timer.guild_id || GUILD_ID;
      if (!gId) continue; // Skip timers without guild_id
      if (!timersByGuild[gId]) timersByGuild[gId] = [];
      timersByGuild[gId].push(timer);
    }

    // Process each guild's timers
    for (const guildId in timersByGuild) {
      const guild = await client.guilds.fetch(guildId).catch(() => null);
      if (!guild) continue;

      const me = await guild.members.fetchMe().catch(() => null);
      const canManage = Boolean(me?.permissions?.has(PermissionFlagsBits.ManageRoles));

      // Process all timers for this guild
      for (const entry of timersByGuild[guildId]) {
        const userId = entry.user_id;
        const roleId = entry.role_id;
        const expiresAt = Number(entry.expires_at);
        const warnChannelId = entry.warn_channel_id;
        const isPaused = entry.paused;
        const pausedRemainingMs = entry.paused_remaining_ms;

        // Skip paused timers
        if (isPaused) continue;

        if (!expiresAt || expiresAt <= 0) continue;

        const leftMs = expiresAt - now;

        // Expired -> remove role + record
        if (leftMs <= 0) {
          if (canManage) {
            const member = await guild.members.fetch(userId).catch(() => null);
            const roleObj = guild.roles.cache.get(roleId);
            if (member && roleObj && me.roles.highest.position > roleObj.position) {
              await member.roles.remove(roleId).catch(() => null);
            }
          }

          await sendExpiredNoticeOrDm(guild, userId, roleId, warnChannelId).catch(() => null);
          await db.clearRoleTimer(userId, roleId).catch(() => null);
          continue;
        }

        // Warnings (use actual minutes left)
        const leftMin = Math.ceil(leftMs / 60_000);

        const warningsSent = entry.warnings_sent || {};

        for (const thresholdMin of WARNING_THRESHOLDS_MIN) {
          const key = String(thresholdMin);

          if (leftMin <= thresholdMin && !warningsSent[key]) {
            await sendWarningOrDm(guild, userId, roleId, leftMin, warnChannelId).catch(() => null);
            await db.markWarningAsSent(userId, roleId, thresholdMin).catch(() => null);
          }
        }
      }

      // Execute autopurge tasks
      await executeAutopurges(guild, now);

      // Execute scheduled rolestatus reports
      await executeScheduledRolestatus(guild, now);
    }
  } catch (e) {
    console.error("cleanupAndWarn error:", e);
  }
}

setInterval(() => {
  cleanupAndWarn();
}, CHECK_INTERVAL_MS);

//----------------------------------------
// SECTION 9 — Start Discord Client
//----------------------------------------

client.on("error", (err) => console.error("Discord client error:", err));
process.on("unhandledRejection", (reason) => console.error("Unhandled rejection:", reason));

// Graceful shutdown
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

if (!TOKEN) {
  console.error("DISCORD_TOKEN is missing. Bot cannot log in.");
} else {
  client.login(TOKEN).then(() => {
    console.log("Discord login() called.");
  }).catch((err) => {
    console.error("Discord login failed:", err);
  });
}


