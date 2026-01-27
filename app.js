const express = require("express");
const path = require("path");
const indexRouter = require("./routes/index");

const { Client, GatewayIntentBits } = require("discord.js");

console.log("=== BoostMon app.js booted ===");
console.log("DISCORD_TOKEN present:", Boolean(process.env.DISCORD_TOKEN));

const app = express();
const PORT = process.env.PORT || 3000;

// =====================
// BoostMon Discord Bot
// =====================
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

client.once("ready", () => {
  console.log(`BoostMon logged in as ${client.user.tag}`);
});

client.on("error", (err) => {
  console.error("Discord client error:", err);
});

if (!process.env.DISCORD_TOKEN) {
  console.error("Missing DISCORD_TOKEN. Add it in Railway -> Variables.");
} else {
  client.login(process.env.DISCORD_TOKEN).catch((err) => {
    console.error("Discord login failed:", err);
  });
}

// =====================
// Express Web Server
// =====================

// Middleware: log request method and url
app.use((req, res, next) => {
  console.info(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Static files
app.use(express.static(path.resolve(__dirname, "public")));

// Main routes
app.use("/", indexRouter);

// 404 handler
app.use((req, res) => {
  res.status(404).sendFile(path.resolve(__dirname, "views", "404.html"));
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send("Internal Server Error");
});

app.listen(PORT, () => {
  console.log(`Server listening: http://localhost:${PORT}`);
});
