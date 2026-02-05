#!/usr/bin/env node
/**
 * FORCE CLEANUP: Remove all duplicate slash commands from Discord
 * Run this script once to clean up existing duplicates
 * Usage: node clean-slash-commands.js
 */

require('dotenv').config();
const { REST, Routes } = require('discord.js');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

if (!TOKEN || !CLIENT_ID) {
  console.error('❌ Missing DISCORD_TOKEN or DISCORD_CLIENT_ID in .env');
  process.exit(1);
}

async function cleanupDuplicates() {
  const rest = new REST({ version: "10", timeout: 10000 }).setToken(TOKEN);
  
  const commandRoute = GUILD_ID
    ? Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID)
    : Routes.applicationCommands(CLIENT_ID);
  
  const routeType = GUILD_ID ? `guild (${GUILD_ID})` : "global";
  
  try {
    console.log(`\n🔍 Scanning for duplicate commands (${routeType})...`);
    
    const existingCommands = await rest.get(commandRoute);
    console.log(`📊 Found ${existingCommands.length} total commands\n`);
    
    // Group by name
    const commandMap = new Map();
    existingCommands.forEach(cmd => {
      if (!commandMap.has(cmd.name)) {
        commandMap.set(cmd.name, []);
      }
      commandMap.set(cmd.name, [...commandMap.get(cmd.name), cmd]);
    });
    
    let duplicatesFound = 0;
    const toDelete = [];
    
    // Find duplicates
    commandMap.forEach((cmds, name) => {
      if (cmds.length > 1) {
        duplicatesFound++;
        console.log(`⚠️  Found ${cmds.length} versions of /${name}:`);
        
        // Keep the first one, mark rest for deletion
        cmds.forEach((cmd, idx) => {
          if (idx === 0) {
            console.log(`   ✓ Keeping ID: ${cmd.id}`);
          } else {
            console.log(`   ✗ Will delete ID: ${cmd.id}`);
            toDelete.push({ id: cmd.id, name: cmd.name });
          }
        });
      }
    });
    
    if (duplicatesFound === 0) {
      console.log('✅ No duplicates found! All commands are clean.\n');
      process.exit(0);
    }
    
    console.log(`\n🗑️  Deleting ${toDelete.length} duplicate commands...\n`);
    
    let successCount = 0;
    for (const cmd of toDelete) {
      try {
        await rest.delete(`${commandRoute}/${cmd.id}`);
        console.log(`   ✓ Deleted /${cmd.name} (${cmd.id})`);
        successCount++;
      } catch (err) {
        console.log(`   ✗ Failed to delete /${cmd.name}: ${err.message}`);
      }
    }
    
    console.log(`\n✅ Cleanup complete! Deleted ${successCount}/${toDelete.length} duplicates`);
    console.log('ℹ️  Changes may take up to 60 minutes to sync on global commands\n');
    
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

cleanupDuplicates();
