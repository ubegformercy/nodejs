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
} = require("discord.js");
const indexRouter = require("./routes/index");

console.log("=== BoostMon app.js booted ===");
console.log("DISCORD_TOKEN present:", Boolean(process.env.DISCORD_TOKEN));
console.log("DISCORD_CLIENT_ID present:", Boolean(process.env.DISCORD_CLIENT_ID));
console.log("DISCORD_GUILD_ID present:", Boolean(process.env.DISCORD_GUILD_ID));
console.log("WHITELIST_ROLE_ID present:", Boolean(process.env.WHITELIST_ROLE_ID));

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const WHITELIST_ROLE_ID = process.env.WHITELIST_ROLE_ID;

// ---------------- Storage ----------------
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

function addMinutes(userId, minutes) {
  const data = readData();
  const now = Date.now();
  const current = data[userId]?.expiresAt ?? 0;
  const base = current > now ? current : now;
  const expiresAt = base + minutes * 60 * 1000;
  data[userId] = { expiresAt };
  writeData(data);
  return expiresAt;
}

function getTimeLeftMs(userId) {
  const data = readData();
  const expiresAt = data[userId]?.expiresAt ?? 0;
  return Math.max(0, expiresAt - Date.now());
}

function formatMs(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h}h ${m}m ${s}s`;
}

function friendlyDiscordError(err) {
  // discord.js REST errors often have: err.code, err.status, err.rawError?.message
  const rawMsg = err?.rawError?.message || err?.message || "Unknown error";
  const code = err?.code ? ` (code ${err.code})` : "";
  const status = err?.status ? ` (HTTP ${err.status})` : "";
  return `${rawMsg}${code}${status}`;
}

// ---------------- Discord Bot ----------------
if (!TOKEN) {
  console.error("FATAL: DISCORD_TOKEN is missing.");
} else {
  console.log("Discord token loaded.");
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once("clientReady", async () => {
  console.log(`BoostMon logged in as ${client.user.tag}`);

  // Register slash commands (guild commands)
  if (!CLIENT_ID || !GUILD_ID) {
    console.log("Missing DISCORD_CLIENT_ID or DISCORD_GUILD_ID; skipping command registration.");
    return;
  }

  const commands = [
    new SlashCommandBuilder()
      .setName("addtime")
      .setDescription("Add minutes to a user's whitelist time and give the role.")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
      .addUserOption((o) =>
        o.setName("user").setDescription("User to add time to").setRequired(true)
      )
      .addIntegerOption((o) =>
        o
          .setName("minutes")
          .setDescription("Minutes to add")
          .setRequired(true)
          .setMinValue(1)
      ),
    new SlashCommandBuilder()
      .setName("timeleft")
      .setDescription("Show remaining whitelist time for a user.")
      .addUserOption((o) =>
        o.setName("user").setDescription("User to check (default: you)").setRequired(false)
      ),
  ].map((c) => c.toJSON());

  try {
    const rest = new REST({ version: "10" }).setToken(TOKEN);
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log("Slash commands registered.");
  } catch (err) {
    console.error("Failed to register slash commands:", err);
  }
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === "addtime") {
      // Basic env var checks
      if (!WHITELIST_ROLE_ID) {
        return interaction.reply({
          content: "WHITELIST_ROLE_ID is not set in Railway Variables.",
          ephemeral: true,
        });
      }
      if (!interaction.guild) {
        return interaction.reply({ content: "This command can only be used in a server.", ephemeral: true });
      }

      const target = interaction.options.getUser("user", true);
      const minutes = interaction.options.getInteger("minutes", true);

      // Fetch member & role objects
      const guild = interaction.guild;

      const role = guild.roles.cache.get(WHITELIST_ROLE_ID);
      if (!role) {
        return interaction.reply({
          content:
            "I can't find the whitelist role in this server. Double-check WHITELIST_ROLE_ID (it must be the Role ID number, not the name).",
          ephemeral: true,
        });
      }

      const me = await guild.members.fetchMe();

      // Permission check: bot must have Manage Roles
      if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
        return interaction.reply({
          content: "I don't have the **Manage Roles** permission in this server.",
          ephemeral: true,
        });
      }

      // Hierarchy check: bot's highest role must be above the target role
      if (me.roles.highest.position <= role.position) {
        return interaction.reply({
          content:
            `I can't assign **${role.name}** because my highest role is not above it.\n` +
            `Move my bot role higher than **${role.name}** in the server role list.`,
          ephemeral: true,
        });
      }

      // Fetch target member and add role
      const member = await guild.members.fetch(target.id);

      // Add time first (storage)
      const expiresAt = addMinutes(target.id, minutes);

      // Add role
      await member.roles.add(role.id);

      return interaction.reply({
        content:
          `Added **${minutes} minutes** to ${target} and gave **${role.name}**.\n` +
          `New expiry: <t:${Math.floor(expiresAt / 1000)}:F> (in <t:${Math.floor(expiresAt / 1000)}:R>).`,
        ephemeral: false,
      });
    }

    if (interaction.commandName === "timeleft") {
      const target = interaction.options.getUser("user") ?? interaction.user;
      const left = getTimeLeftMs(target.id);

      if (left <= 0) {
        return interaction.reply({ content: `${target} has **0 time left**.`, ephemeral: true });
      }

      return interaction.reply({
        content: `${target} has **${formatMs(left)}** remaining (expires <t:${Math.floor((Date.now() + left) / 1000)}:R>).`,
        ephemeral: true,
      });
    }
  } catch (err) {
    console.error("Command error:", err);

    const msg =
      "Error running command.\n" +
      "Details: " +
      friendlyDiscordError(err);

    // Always try to reply/follow-up without crashing
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

// Avoid unhandled errors killing the process
client.on("error", (err) => console.error("Discord client error:", err));
process.on("unhandledRejection", (reason) => console.error("Unhandled rejection:", reason));

client.login(TOKEN).catch((err) => console.error("Login failed:", err));

// ---------------- Express Web Server ----------------
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
