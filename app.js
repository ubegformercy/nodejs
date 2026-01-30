//----------------------------------------
// SECTION 0 — Imports & Boot Logging
//----------------------------------------

const express = require("express");
const path = require("path");
const fs = require("fs");
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require("discord.js");
const indexRouter = require("./routes/index");

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
const WARNING_THRESHOLDS_MIN = [10, 1]; // customize as you like
const CHECK_INTERVAL_MS = 30_000;



//----------------------------------------
// SECTION 2 — Storage (data.json)
//----------------------------------------
// Data format:
// {
//   "<userId>": {
//     "roles": {
//       "<roleId>": {
//         "expiresAt": 1234567890000,
//         "warnChannelId": "123..." | null,
//         "warningsSent": { "10": true, "1": true }
//       }
//     }
//   }
// }

const DATA_PATH = path.resolve(__dirname, "data.json");

function readData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  } catch {
    return {};
  }
}

function writeData(obj) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(obj, null, 2), "utf8");
}

function ensureUserRole(data, userId, roleId) {
  if (!data[userId]) data[userId] = { roles: {} };
  if (!data[userId].roles) data[userId].roles = {};
  if (!data[userId].roles[roleId]) {
    data[userId].roles[roleId] = {
      expiresAt: 0,
      warnChannelId: null,
      warningsSent: {},
    };
  }
  if (!data[userId].roles[roleId].warningsSent) data[userId].roles[roleId].warningsSent = {};
  return data;
}

function clearRoleTimer(userId, roleId) {
  const data = readData();
  if (!data[userId]?.roles?.[roleId]) return false;

  delete data[userId].roles[roleId];

  if (Object.keys(data[userId].roles).length === 0) {
    delete data[userId];
  }

  writeData(data);
  return true;
}


//----------------------------------------
// SECTION 3 — Utility Helpers
//----------------------------------------

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
  const data = readData();
  const expiresAt = data[userId]?.roles?.[roleId]?.expiresAt ?? 0;
  return Math.max(0, expiresAt - Date.now());
}

// Helper: when role not specified, choose a role timer deterministically (first key)
function getFirstTimedRoleId(userId) {
  const data = readData();
  const roles = data[userId]?.roles;
  if (!roles) return null;
  const ids = Object.keys(roles);
  if (ids.length === 0) return null;
  return ids[0];
}



//----------------------------------------
// SECTION 4 — Timer Math (set/add/remove)
//----------------------------------------

// Add minutes to a specific role timer (user+role)
function addMinutesForRole(userId, roleId, minutes) {
  const data = readData();
  const now = Date.now();
  ensureUserRole(data, userId, roleId);

  const current = data[userId].roles[roleId]?.expiresAt ?? 0;
  const base = current > now ? current : now;
  const expiresAt = base + minutes * 60 * 1000;

  data[userId].roles[roleId].expiresAt = expiresAt;

  // Clear warnings so they can re-fire after extensions
  data[userId].roles[roleId].warningsSent = {};

  writeData(data);
  return expiresAt;
}

// Set minutes exactly for a role timer (user+role) to now+minutes.
// Also sets warnChannelId (nullable) and resets warningsSent.
function setMinutesForRole(userId, roleId, minutes, warnChannelIdOrNull) {
  const data = readData();
  const now = Date.now();
  ensureUserRole(data, userId, roleId);

  const expiresAt = now + minutes * 60 * 1000;
  data[userId].roles[roleId].expiresAt = expiresAt;
  data[userId].roles[roleId].warnChannelId = warnChannelIdOrNull ?? null;
  data[userId].roles[roleId].warningsSent = {};

  writeData(data);
  return expiresAt;
}

// Remove minutes from a role timer (user+role)
// Returns:
// - 0 if expired/removed
// - new expiresAt timestamp if still active
// - null if no timer existed
function removeMinutesForRole(userId, roleId, minutes) {
  const data = readData();
  if (!data[userId]?.roles?.[roleId]) return null;

  const now = Date.now();
  const current = data[userId].roles[roleId].expiresAt;
  const newExpiry = current - minutes * 60 * 1000;

  if (newExpiry <= now) {
    delete data[userId].roles[roleId];
    if (Object.keys(data[userId].roles).length === 0) {
      delete data[userId];
    }
    writeData(data);
    return 0;
  }

  data[userId].roles[roleId].expiresAt = newExpiry;

  // Clear warnings so it can re-evaluate correctly after reduction
  data[userId].roles[roleId].warningsSent = {};

  writeData(data);
  return newExpiry;
}



//----------------------------------------
// SECTION 5 — Discord Client + Slash Command Registration
//----------------------------------------

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once("ready", async () => {
  console.log(`BoostMon logged in as ${client.user.tag}`);

  if (!CLIENT_ID || !GUILD_ID) {
    console.log("Missing DISCORD_CLIENT_ID or DISCORD_GUILD_ID; skipping command registration.");
    return;
  }

  const commands = [
    new SlashCommandBuilder()
      .setName("settime")
      .setDescription("Set a user's timed role time to exactly N minutes from now and assign the role.")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
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
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
      .addUserOption((o) => o.setName("user").setDescription("User to add time to").setRequired(true))
      .addIntegerOption((o) =>
        o.setName("minutes").setDescription("Minutes to add").setRequired(true).setMinValue(1)
      )
      .addRoleOption((o) => o.setName("role").setDescription("Role to add time to (optional)").setRequired(false)),

    new SlashCommandBuilder()
      .setName("removetime")
      .setDescription("Remove minutes from a user's timed role.")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
      .addUserOption((o) => o.setName("user").setDescription("User to modify").setRequired(true))
      .addIntegerOption((o) =>
        o.setName("minutes").setDescription("Minutes to remove").setRequired(true).setMinValue(1)
      )
      .addRoleOption((o) => o.setName("role").setDescription("Role to remove time from (optional)").setRequired(false)),

    new SlashCommandBuilder()
      .setName("cleartime")
      .setDescription("Clear a user's timed role timer and remove the role.")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
      .addUserOption((o) => o.setName("user").setDescription("User to clear").setRequired(true))
      .addRoleOption((o) => o.setName("role").setDescription("Role to clear (optional)").setRequired(false)),

    new SlashCommandBuilder()
      .setName("timeleft")
      .setDescription("Show remaining timed role time for a user (and optional role).")
      .addUserOption((o) => o.setName("user").setDescription("User to check (default: you)").setRequired(false))
      .addRoleOption((o) => o.setName("role").setDescription("Role to check (optional)").setRequired(false)),
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

      const expiresAt = setMinutesForRole(targetUser.id, role.id, minutes, warnChannelId);
      await member.roles.add(role.id);

      return interaction.reply({
        content:
          `Set **${minutes} minutes** for ${targetUser} on **${role.name}** and assigned the role.\n` +
          `${warnModeText}\n` +
          `Expiry: <t:${Math.floor(expiresAt / 1000)}:F> (in <t:${Math.floor(expiresAt / 1000)}:R>).`,
        ephemeral: false,
      });
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

      const data = readData();
      const timers = data[targetUser.id]?.roles || {};
      const timedRoleIds = Object.keys(timers);

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

      const expiresAt = addMinutesForRole(targetUser.id, role.id, minutes);

      if (!member.roles.cache.has(role.id)) {
        await member.roles.add(role.id);
      }

      return interaction.reply({
        content:
          `Added **${minutes} minutes** to ${targetUser} for **${role.name}**.\n` +
          `New expiry: <t:${Math.floor(expiresAt / 1000)}:F> (in <t:${Math.floor(expiresAt / 1000)}:R>).`,
        ephemeral: false,
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

      const data = readData();
      const timers = data[targetUser.id]?.roles || {};
      const timedRoleIds = Object.keys(timers);

      if (timedRoleIds.length === 0) {
        return interaction.reply({ content: `${targetUser} has no active timed roles.`, ephemeral: true });
      }

      let roleIdToEdit = null;

      if (roleOption) {
        roleIdToEdit = roleOption.id;
        if (!timers[roleIdToEdit]) {
          return interaction.reply({
            content: `${targetUser} has no saved time for **${roleOption.name}**.`,
            ephemeral: true,
          });
        }
      } else {
        const matching = timedRoleIds.filter((rid) => member.roles.cache.has(rid));

        if (matching.length === 1) {
          roleIdToEdit = matching[0];
        } else if (matching.length === 0) {
          if (timedRoleIds.length === 1) {
            roleIdToEdit = timedRoleIds[0];
          } else {
            return interaction.reply({
              content:
                `${targetUser} has multiple timed roles stored, but none clearly matches their current roles.\n` +
                `Please specify which role to remove time from.`,
              ephemeral: true,
            });
          }
        } else {
          const names = matching
            .map((rid) => guild.roles.cache.get(rid)?.name || rid)
            .slice(0, 10)
            .join(", ");

          return interaction.reply({
            content:
              `${targetUser} currently has multiple timed roles. Please specify the role to remove time from.\n` +
              `Possible: ${names}`,
            ephemeral: true,
          });
        }
      }

      const roleObj = guild.roles.cache.get(roleIdToEdit);
      if (!roleObj) {
        return interaction.reply({ content: "That role no longer exists in this server.", ephemeral: true });
      }

      const permCheck = await canManageRole(guild, roleObj);
      if (!permCheck.ok) {
        return interaction.reply({ content: permCheck.reason, ephemeral: true });
      }

      const result = removeMinutesForRole(targetUser.id, roleIdToEdit, minutes);

      if (result === null) {
        return interaction.reply({
          content: `${targetUser} has no saved time for **${roleObj.name}**.`,
          ephemeral: true,
        });
      }

      if (result === 0) {
        if (member.roles.cache.has(roleIdToEdit)) {
          await member.roles.remove(roleIdToEdit);
        }
        return interaction.reply({
          content:
            `Removed **${minutes} minutes** from ${targetUser} for **${roleObj.name}**.\n` +
            `Time expired — **${roleObj.name}** has been removed.`,
          ephemeral: false,
        });
      }

      const leftMs = Math.max(0, result - Date.now());
      return interaction.reply({
        content:
          `Removed **${minutes} minutes** from ${targetUser} for **${roleObj.name}**.\n` +
          `Remaining: **${formatMs(leftMs)}** (expires <t:${Math.floor(result / 1000)}:R>).`,
        ephemeral: false,
      });
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

      const data = readData();
      const timers = data[targetUser.id]?.roles || {};
      const timedRoleIds = Object.keys(timers);

      if (timedRoleIds.length === 0) {
        return interaction.reply({ content: `${targetUser} has no active timed roles.`, ephemeral: true });
      }

      // Pick role to clear
      let roleIdToClear = null;

      if (roleOption) {
        roleIdToClear = roleOption.id;
        if (!timers[roleIdToClear]) {
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
        clearRoleTimer(targetUser.id, roleIdToClear);
        return interaction.reply({
          content: `Cleared saved time for ${targetUser}. (Role no longer exists in this server.)`,
          ephemeral: false,
        });
      }

      const permCheck = await canManageRole(guild, roleObj);
      if (!permCheck.ok) {
        return interaction.reply({ content: permCheck.reason, ephemeral: true });
      }

      const cleared = clearRoleTimer(targetUser.id, roleIdToClear);

      if (member.roles.cache.has(roleIdToClear)) {
        await member.roles.remove(roleIdToClear);
      }

      return interaction.reply({
        content: cleared
          ? `Cleared saved time for ${targetUser} on **${roleObj.name}** and removed the role.`
          : `No saved time existed for ${targetUser} on **${roleObj.name}**.`,
        ephemeral: false,
      });
    }

    // ---------- /timeleft ----------
    if (interaction.commandName === "timeleft") {
      const targetUser = interaction.options.getUser("user") ?? interaction.user;
      const role = interaction.options.getRole("role"); // optional

      if (role) {
        const left = getTimeLeftMsForRole(targetUser.id, role.id);
        if (left <= 0) {
          return interaction.reply({
            content: `${targetUser} has 0 time left for ${role.name}.`,
            ephemeral: true,
          });
        }
        return interaction.reply({
          content: `${targetUser} has ${formatMs(left)} remaining for ${role.name} (expires <t:${Math.floor((Date.now() + left) / 1000)}:R>).`,
          ephemeral: true,
        });
      }

      const currentRoleId = getFirstTimedRoleId(targetUser.id);
      if (!currentRoleId) {
        return interaction.reply({ content: `${targetUser} has 0 time left.`, ephemeral: true });
      }

      const left = getTimeLeftMsForRole(targetUser.id, currentRoleId);
      const roleObj = interaction.guild?.roles?.cache?.get(currentRoleId);

      if (left <= 0) {
        return interaction.reply({ content: `${targetUser} has 0 time left.`, ephemeral: true });
      }

      return interaction.reply({
        content:
          `${targetUser} has ${formatMs(left)} remaining` +
          (roleObj ? ` for ${roleObj.name}` : "") +
          ` (expires <t:${Math.floor((Date.now() + left) / 1000)}:R>).`,
        ephemeral: true,
      });
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

async function cleanupAndWarn() {
  try {
    if (!GUILD_ID) return;
    if (!client.isReady()) return;

    const guild = await client.guilds.fetch(GUILD_ID).catch(() => null);
    if (!guild) return;

    const data = readData();
    const now = Date.now();
    let changed = false;

    const me = await guild.members.fetchMe().catch(() => null);
    const canManage = Boolean(me?.permissions?.has(PermissionFlagsBits.ManageRoles));

    for (const userId of Object.keys(data)) {
      const roles = data[userId]?.roles || {};

      for (const roleId of Object.keys(roles)) {
        const entry = roles[roleId];
        const expiresAt = entry?.expiresAt ?? 0;
        const warnChannelId = entry?.warnChannelId ?? null;

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

          delete data[userId].roles[roleId];
          changed = true;
          continue;
        }

        // Warnings (use actual minutes left)
        const leftMin = Math.ceil(leftMs / 60_000);

        if (!entry.warningsSent) entry.warningsSent = {};

        for (const thresholdMin of WARNING_THRESHOLDS_MIN) {
          const key = String(thresholdMin);

          if (leftMin <= thresholdMin && !entry.warningsSent[key]) {
            await sendWarningOrDm(guild, userId, roleId, leftMin, warnChannelId).catch(() => null);
            entry.warningsSent[key] = true;
            changed = true;
          }
        }
      }

      if (data[userId] && Object.keys(data[userId].roles || {}).length === 0) {
        delete data[userId];
        changed = true;
      }
    }

    if (changed) writeData(data);
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

if (!TOKEN) {
  console.error("DISCORD_TOKEN is missing. Bot cannot log in.");
} else {
  client.login(TOKEN).then(() => {
    console.log("Discord login() called.");
  }).catch((err) => {
    console.error("Discord login failed:", err);
  });
}

