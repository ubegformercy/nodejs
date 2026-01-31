//----------------------------------------
// SECTION 0 — Imports & Boot Logging
//----------------------------------------

const express = require("express");
const path = require("path");
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
const db = require("./db");
const BOOSTMON_ICON_URL = "https://raw.githubusercontent.com/ubegformercy/nodejs/main/public/images/boostmon.png";
console.log("=== BoostMon app.js booted ===");
console.log("DISCORD_TOKEN present:", Boolean(process.env.DISCORD_TOKEN));
console.log("DISCORD_CLIENT_ID present:", Boolean(process.env.DISCORD_CLIENT_ID));
console.log("DISCORD_GUILD_ID present:", Boolean(process.env.DISCORD_GUILD_ID));

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID;



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
function addMinutesForRole(userId, roleId, minutes) {
  return db.addMinutesForRole(userId, roleId, minutes);
}

// Set minutes exactly for a role timer (user+role) to now+minutes.
// Also sets warnChannelId (nullable) and resets warningsSent.
function setMinutesForRole(userId, roleId, minutes, warnChannelIdOrNull) {
  return db.setMinutesForRole(userId, roleId, minutes, warnChannelIdOrNull ?? null);
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

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once("ready", async () => {
  console.log(`BoostMon logged in as ${client.user.tag}`);

  // Initialize database
  await db.initDatabase();

  if (!CLIENT_ID || !GUILD_ID) {
    console.log("Missing DISCORD_CLIENT_ID or DISCORD_GUILD_ID; skipping command registration.");
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
      .setDescription("Show all users with a specific role and their remaining times.")
      .addRoleOption((o) => o.setName("role").setDescription("Role to check").setRequired(true)),

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

    const result = await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands }
    );

    console.log("Slash commands registered. Discord now has:", result.map((c) => c.name).join(", "));
  } catch (err) {
    console.error("Failed to register slash commands:", err);
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
  if (!interaction.guild) {
    return interaction.reply({ content: "This command can only be used in a server.", ephemeral: true });
  }

  const targetUser = interaction.options.getUser("user", true);
  const roleOption = interaction.options.getRole("role"); // optional

  const guild = interaction.guild;
  const member = await guild.members.fetch(targetUser.id);

  const timers = await db.getTimersForUser(targetUser.id);
  const timedRoleIds = timers.map(t => t.role_id);

  if (timedRoleIds.length === 0) {
    return interaction.reply({ content: `${targetUser} has no active timed roles.`, ephemeral: true });
  }

  let roleIdToPause = null;

  if (roleOption) {
    roleIdToPause = roleOption.id;
    if (!timedRoleIds.includes(roleIdToPause)) {
      return interaction.reply({
        content: `${targetUser} has no saved time for **${roleOption.name}**.`,
        ephemeral: true,
      });
    }
  } else {
    const matching = timedRoleIds.find((rid) => member.roles.cache.has(rid));
    roleIdToPause = matching || timedRoleIds[0];
  }

  const roleObj = guild.roles.cache.get(roleIdToPause);
  const roleName = roleObj?.name || "that role";

  if (!roleObj) {
    return interaction.reply({
      content: `That role no longer exists in this server, but a timer is stored for it. Use /cleartime to remove the stored timer.`,
      ephemeral: true,
    });
  }

  const permCheck = await canManageRole(guild, roleObj);
  if (!permCheck.ok) {
    return interaction.reply({ content: permCheck.reason, ephemeral: true });
  }

  const entry = await db.getTimerForRole(targetUser.id, roleIdToPause);

  if (entry?.paused) {
    return interaction.reply({
      content: `${targetUser}'s timer for **${roleName}** is already paused.`,
      ephemeral: true,
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

  return interaction.reply({ embeds: [embed] });
}


// ---------- /resumetime ----------
if (interaction.commandName === "resumetime") {
  if (!interaction.guild) {
    return interaction.reply({ content: "This command can only be used in a server.", ephemeral: true });
  }

  const targetUser = interaction.options.getUser("user", true);
  const roleOption = interaction.options.getRole("role", true); // REQUIRED

  const guild = interaction.guild;
  const member = await guild.members.fetch(targetUser.id);

  const timers = await db.getTimersForUser(targetUser.id);
  const timedRoleIds = timers.map(t => t.role_id);

  if (timedRoleIds.length === 0) {
    return interaction.reply({ content: `${targetUser} has no active timed roles.`, ephemeral: true });
  }

  // Verify the specified role has a timer
  const roleIdToResume = roleOption.id;

  if (!timedRoleIds.includes(roleIdToResume)) {
    return interaction.reply({
      content: `${targetUser} has no saved time for **${roleOption.name}**.`,
      ephemeral: true,
    });
  }

  const roleObj = guild.roles.cache.get(roleIdToResume);
  const roleName = roleObj?.name || "that role";

  const entry = await db.getTimerForRole(targetUser.id, roleIdToResume);

  if (!entry?.paused) {
    return interaction.reply({
      content: `${targetUser}'s timer for **${roleName}** is not paused.`,
      ephemeral: true,
    });
  }

  if (!roleObj) {
    await db.clearRoleTimer(targetUser.id, roleIdToResume);
    return interaction.reply({
      content: `That role no longer exists in this server, so I cleared the saved timer for ${targetUser}.`,
      ephemeral: false,
    });
  }

  const permCheck = await canManageRole(guild, roleObj);
  if (!permCheck.ok) {
    return interaction.reply({ content: permCheck.reason, ephemeral: true });
  }

  const remainingMs = Math.max(0, Number(entry.paused_remaining_ms || 0));

  if (remainingMs <= 0) {
    await db.clearRoleTimer(targetUser.id, roleIdToResume);
    if (member.roles.cache.has(roleIdToResume)) {
      await member.roles.remove(roleIdToResume).catch(() => null);
    }
    return interaction.reply({
      content: `No time remained to resume for ${targetUser} on **${roleName}**. Timer cleared and role removed.`,
      ephemeral: false,
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

return interaction.reply({ embeds: [embed] });

}


 
    // ---------- /settime ----------
    if (interaction.commandName === "settime") {
      if (!interaction.guild) {
        return interaction.reply({ content: "This command can only be used in a server.", ephemeral: true });
      }

      const targetUser = interaction.options.getUser("user", true);
      const minutes = interaction.options.getInteger("minutes", true);
      const targetRole = interaction.options.getRole("role", true);
      const channelOpt = interaction.options.getChannel("channel"); // optional

      const guild = interaction.guild;

      const role = guild.roles.cache.get(targetRole.id);
      if (!role) {
        return interaction.reply({ content: "I couldn't find that role in this server.", ephemeral: true });
      }

      const permCheck = await canManageRole(guild, role);
      if (!permCheck.ok) {
        return interaction.reply({ content: permCheck.reason, ephemeral: true });
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

      const expiresAt = await setMinutesForRole(targetUser.id, role.id, minutes, warnChannelId);
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
    
    return interaction.reply({ embeds: [embed] });
    }

    // ---------- /addtime ----------
    if (interaction.commandName === "addtime") {
      if (!interaction.guild) {
        return interaction.reply({ content: "This command can only be used in a server.", ephemeral: true });
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
          return interaction.reply({
            content: `${targetUser} has no active timed roles. Use /settime with a role first.`,
            ephemeral: true,
          });
        } else {
          return interaction.reply({
            content: `${targetUser} has multiple timed roles. Please specify the role.`,
            ephemeral: true,
          });
        }
      }

      const role = guild.roles.cache.get(roleIdToEdit);
      if (!role) {
        return interaction.reply({ content: "That role no longer exists in this server.", ephemeral: true });
      }

      const permCheck = await canManageRole(guild, role);
      if (!permCheck.ok) {
        return interaction.reply({ content: permCheck.reason, ephemeral: true });
      }

      const expiresAt = await addMinutesForRole(targetUser.id, role.id, minutes);

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

return interaction.reply({
  embeds: [embed],
});
}

// ---------- /removetime ----------
if (interaction.commandName === "removetime") {
  if (!interaction.guild) {
    return interaction.reply({ content: "This command can only be used in a server.", ephemeral: true });
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

    return interaction.reply({ embeds: [embed], ephemeral: true });
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

      return interaction.reply({ embeds: [embed], ephemeral: true });
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

        return interaction.reply({ embeds: [embed], ephemeral: true });
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

      return interaction.reply({ embeds: [embed], ephemeral: true });
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

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  const permCheck = await canManageRole(guild, roleObj);
  if (!permCheck.ok) {
    return interaction.reply({ content: permCheck.reason, ephemeral: true });
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

    return interaction.reply({ embeds: [embed], ephemeral: true });
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

    return interaction.reply({ embeds: [embed], ephemeral: false });
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

  return interaction.reply({ embeds: [embed], ephemeral: false });
}


    // ---------- /cleartime ----------
    if (interaction.commandName === "cleartime") {
      if (!interaction.guild) {
        return interaction.reply({ content: "This command can only be used in a server.", ephemeral: true });
      }

      const targetUser = interaction.options.getUser("user", true);
      const roleOption = interaction.options.getRole("role"); // optional

      const guild = interaction.guild;
      const member = await guild.members.fetch(targetUser.id);

      const timers = await db.getTimersForUser(targetUser.id);
      const timedRoleIds = timers.map(t => t.role_id);

      if (timedRoleIds.length === 0) {
        return interaction.reply({ content: `${targetUser} has no active timed roles.`, ephemeral: true });
      }

      // Pick role to clear
      let roleIdToClear = null;

      if (roleOption) {
        roleIdToClear = roleOption.id;
        if (!timedRoleIds.includes(roleIdToClear)) {
          return interaction.reply({
            content: `${targetUser} has no saved time for **${roleOption.name}**.`,
            ephemeral: true,
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
        return interaction.reply({
          content: `Cleared saved time for ${targetUser}. (Role no longer exists in this server.)`,
          ephemeral: false,
        });
      }

      const permCheck = await canManageRole(guild, roleObj);
      if (!permCheck.ok) {
        return interaction.reply({ content: permCheck.reason, ephemeral: true });
      }

      await db.clearRoleTimer(targetUser.id, roleIdToClear);

      if (member.roles.cache.has(roleIdToClear)) {
        await member.roles.remove(roleIdToClear);
      }

      return interaction.reply({
        content: `Cleared saved time for ${targetUser} on **${roleObj.name}** and removed the role.`,
        ephemeral: false,
      });
    }

    // ---------- /showtime ----------
    if (interaction.commandName === "showtime") {
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
          return interaction.reply({ embeds: [embed] });
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
          return interaction.reply({ embeds: [embed] });
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
        
        return interaction.reply({ embeds: [embed] });
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
        return interaction.reply({ embeds: [embed] });
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
        return interaction.reply({ embeds: [embed] });
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
        return interaction.reply({ embeds: [embed] });
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
      
      return interaction.reply({ embeds: [embed] });
    }

    // ---------- /rolestatus ----------
    if (interaction.commandName === "rolestatus") {
      if (!interaction.guild) {
        return interaction.reply({ content: "This command can only be used in a server.", ephemeral: true });
      }

      // Defer because this can take a while
      await interaction.deferReply().catch(() => null);

      const roleOption = interaction.options.getRole("role", true);
      const guild = interaction.guild;

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

    // ---------- /autopurge ----------
    if (interaction.commandName === "autopurge") {
      if (!interaction.guild) {
        return interaction.reply({ content: "This command can only be used in a server.", ephemeral: true });
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
          return interaction.reply({ content: "Channel must be a text or announcement channel.", ephemeral: true });
        }

        // Check bot permissions in the target channel
        const me = await guild.members.fetchMe();
        const perms = channel.permissionsFor(me);

        if (!perms?.has(PermissionFlagsBits.ManageMessages)) {
          return interaction.reply({
            content: `I don't have **Manage Messages** permission in ${channel}. I need this to delete messages.`,
            ephemeral: true,
          });
        }

        // Save to database
        const intervalSeconds = interval * 60;
        const setting = await db.setAutopurgeSetting(guild.id, channel.id, type, lines, intervalSeconds);

        if (!setting) {
          return interaction.reply({ content: "Failed to save autopurge setting. Try again later.", ephemeral: true });
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

        return interaction.reply({ embeds: [embed] });
      }

      if (subcommand === "disable") {
        const channel = interaction.options.getChannel("channel", true);

        const setting = await db.getAutopurgeSetting(guild.id, channel.id);
        if (!setting) {
          return interaction.reply({
            content: `No auto-purge setting found for ${channel}.`,
            ephemeral: true,
          });
        }

        const disabled = await db.disableAutopurgeSetting(guild.id, channel.id);
        if (!disabled) {
          return interaction.reply({ content: "Failed to disable auto-purge. Try again later.", ephemeral: true });
        }

        const embed = new EmbedBuilder()
          .setColor(0xE74C3C)
          .setAuthor({ name: "BoostMon", iconURL: BOOSTMON_ICON_URL })
          .setTitle("❌ Auto-Purge Disabled")
          .setTimestamp(new Date())
          .addFields({ name: "Channel", value: `${channel}`, inline: true })
          .setFooter({ text: "BoostMon • Auto-Purge Disabled" });

        return interaction.reply({ embeds: [embed] });
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
          return interaction.reply({ embeds: [embed] });
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

        return interaction.reply({ embeds: [embed] });
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

app.use(express.static(path.resolve(__dirname, "public")));
app.use("/", indexRouter);

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

async function trySendToChannel(guild, channelId, content) {
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel) return { ok: false, reason: "Channel not found" };

  if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
    return { ok: false, reason: "Not a text/announcement channel" };
  }

  const me = await guild.members.fetchMe();
  const perms = channel.permissionsFor(me);

  const canView = perms?.has(PermissionFlagsBits.ViewChannel);
  const canSend = perms?.has(PermissionFlagsBits.SendMessages);

  if (!canView || !canSend) {
    return { ok: false, reason: "Missing ViewChannel or SendMessages" };
  }

  await channel.send({ content });
  return { ok: true };
}

async function tryDmUser(userId, content) {
  const user = await client.users.fetch(userId).catch(() => null);
  if (!user) return { ok: false, reason: "User fetch failed" };
  await user.send({ content });
  return { ok: true };
}

async function sendWarningOrDm(guild, userId, roleId, minutesLeft, warnChannelId) {
  const roleObj = guild.roles.cache.get(roleId);
  const roleName = roleObj ? roleObj.name : "that role";

  const content = `<@${userId}> warning: your access for **${roleName}** expires in **${minutesLeft} minute(s)**.`;

  if (warnChannelId) {
    try {
      const res = await trySendToChannel(guild, warnChannelId, content);
      if (res.ok) return;
      console.warn(`[WARN] Could not post warning to channel ${warnChannelId}: ${res.reason}`);
    } catch (e) {
      console.warn(`[WARN] Channel send failed for ${warnChannelId}:`, e?.message || e);
    }
  }

  try {
    const dmRes = await tryDmUser(userId, content);
    if (!dmRes.ok) console.warn(`[WARN] Could not DM user ${userId}: ${dmRes.reason}`);
  } catch (e) {
    console.warn(`[WARN] DM send failed for user ${userId}:`, e?.message || e);
  }
}

async function sendExpiredNoticeOrDm(guild, userId, roleId, warnChannelId) {
  const roleObj = guild.roles.cache.get(roleId);
  const roleName = roleObj ? roleObj.name : "that role";

  const content = `<@${userId}> notice: your access for **${roleName}** has expired.`;

  if (warnChannelId) {
    try {
      const res = await trySendToChannel(guild, warnChannelId, content);
      if (res.ok) return;
      console.warn(`[WARN] Could not post expiry notice to channel ${warnChannelId}: ${res.reason}`);
    } catch (e) {
      console.warn(`[WARN] Channel send failed for ${warnChannelId}:`, e?.message || e);
    }
  }

  try {
    const dmRes = await tryDmUser(userId, content);
    if (!dmRes.ok) console.warn(`[WARN] Could not DM user ${userId}: ${dmRes.reason}`);
  } catch (e) {
    console.warn(`[WARN] DM send failed for user ${userId}:`, e?.message || e);
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

async function cleanupAndWarn() {
  try {
    if (!GUILD_ID) return;
    if (!client.isReady()) return;

    const guild = await client.guilds.fetch(GUILD_ID).catch(() => null);
    if (!guild) return;

    const now = Date.now();
    const me = await guild.members.fetchMe().catch(() => null);
    const canManage = Boolean(me?.permissions?.has(PermissionFlagsBits.ManageRoles));

    // Get all active timers from database
    const allTimers = await db.getAllActiveTimers().catch(() => []);

    for (const entry of allTimers) {
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


