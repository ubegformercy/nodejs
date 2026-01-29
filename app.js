const express = require("express");
const path = require("path");
const fs = require("fs");
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const indexRouter = require("./routes/index");

console.log("=== BoostMon app.js booted ===");
console.log("DISCORD_TOKEN present:", Boolean(process.env.DISCORD_TOKEN));

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID; // add in Railway Variables
const GUILD_ID = process.env.DISCORD_GUILD_ID;   // add in Railway Variables
const WHITELIST_ROLE_ID = process.env.WHITELIST_ROLE_ID; // add in Railway Variables

// --------- Simple JSON storage (dev mode) ----------
const DATA_PATH = path.resolve(__dirname, "data.json");
function readData() {
  try { return JSON.parse(fs.readFileSync(DATA_PATH, "utf8")); }
  catch { return {}; }
}
function writeData(obj) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(obj, null, 2), "utf8");
}

// remaining time tracked as "expiresAt" (ms epoch)
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

// ---------------- Discord Bot ----------------
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once("clientReady", async () => {
  console.log(`BoostMon logged in as ${client.user.tag}`);

  // Register slash commands to your server (guild)
  if (!CLIENT_ID || !GUILD_ID) {
    console.log("Missing DISCORD_CLIENT_ID or DISCORD_GUILD_ID; skipping command registration.");
    return;
  }

  const commands = [
    new SlashCommandBuilder()
      .setName("addtime")
      .setDescription("Add minutes to a user's whitelist time and give the role.")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
      .addUserOption(o => o.setName("user").setDescription("User to add time to").setRequired(true))
      .addIntegerOption(o => o.setName("minutes").setDescription("Minutes to add").setRequired(true).setMinValue(1)),
    new SlashCommandBuilder()
      .setName("timeleft")
      .setDescription("Show remaining whitelist time for a user.")
      .addUserOption(o => o.setName("user").setDescription("User to check (default: you)").setRequired(false)),
  ].map(c => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log("Slash commands registered.");
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === "addtime") {
      if (!WHITELIST_ROLE_ID) {
        return interaction.reply({ content: "WHITELIST_ROLE_ID is not set in Railway Variables.", ephemeral: true });
      }

      const target = interaction.options.getUser("user", true);
      const minutes = interaction.options.getInteger("minutes", true);

      const expiresAt = addMinutes(target.id, minutes);

      const guild = interaction.guild;
      const member = await guild.members.fetch(target.id);
      await member.roles.add(WHITELIST_ROLE_ID);

      return interaction.reply({
        content: `Added **${minutes} minutes** to ${target}. New expiry: <t:${Math.floor(expiresAt / 1000)}:F> (in <t:${Math.floor(expiresAt / 1000)}:R>).`,
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
    console.error(err);
    if (interaction.deferred || interaction.replied) {
      return interaction.followUp({ content: "Error running command.", ephemeral: true });
    }
    return interaction.reply({ content: "Error running command.", ephemeral: true });
  }
});

client.login(TOKEN);

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
