#!/usr/bin/env node
/**
 * Force clear and re-register all Discord slash commands
 * Run: node clear-and-register-commands.js
 */

require('dotenv').config();
const { REST, Routes } = require('discord.js');

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID; // Optional: for guild-specific commands

if (!TOKEN || !CLIENT_ID) {
  console.error('❌ Missing DISCORD_BOT_TOKEN or DISCORD_CLIENT_ID in .env');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(TOKEN);

async function clearAndRegister() {
  try {
    console.log('🔄 Clearing all existing commands...');
    
    const routeType = GUILD_ID ? `guild (${GUILD_ID})` : 'global (all servers)';
    const route = GUILD_ID
      ? Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID)
      : Routes.applicationCommands(CLIENT_ID);

    // Get all existing commands
    const existingCommands = await rest.get(route);
    console.log(`Found ${existingCommands.length} existing commands`);

    // Delete each command
    for (const cmd of existingCommands) {
      console.log(`  ❌ Deleting: /${cmd.name}`);
      await rest.delete(`${route}/${cmd.id}`);
    }

    console.log('✅ All commands cleared!');
    console.log('\n📋 Now restart your bot with: npm start or Railway redeploy');
    console.log('💡 This will force the bot to re-register all commands fresh');

  } catch (error) {
    console.error('❌ Error clearing commands:', error);
    process.exit(1);
  }
}

clearAndRegister();
