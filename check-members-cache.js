#!/usr/bin/env node
require('dotenv').config();
const db = require('./db');

async function checkDatabase() {
  try {
    console.log('\n🔍 Checking Guild Members Cache...\n');
    
    // Check total count
    const totalResult = await db.query(
      'SELECT COUNT(*) as total FROM guild_members_cache'
    );
    const totalCount = parseInt(totalResult.rows[0].total);
    
    if (totalCount === 0) {
      console.log('❌ No members synced yet');
      console.log('⏳ The sync service should start automatically within 5-10 seconds of bot startup');
      console.log('📋 Check the app logs for "[Guild Sync]" messages\n');
      process.exit(0);
    }
    
    // Check per guild
    const guildResult = await db.query(
      'SELECT guild_id, COUNT(*) as member_count FROM guild_members_cache GROUP BY guild_id ORDER BY member_count DESC'
    );
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 GUILD MEMBERS IN DATABASE\n');
    
    let totalMembers = 0;
    guildResult.rows.forEach((row, index) => {
      const count = parseInt(row.member_count);
      totalMembers += count;
      console.log(`  ${index + 1}. Guild ID: ${row.guild_id}`);
      console.log(`     Members: ${count.toLocaleString()}`);
      console.log('');
    });
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`✅ TOTAL: ${totalMembers.toLocaleString()} members cached`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    // Show sample members
    const sampleResult = await db.query(
      'SELECT user_id, username, display_name, guild_id FROM guild_members_cache LIMIT 5'
    );
    
    if (sampleResult.rows.length > 0) {
      console.log('📋 Sample Members:\n');
      sampleResult.rows.forEach(member => {
        console.log(`  • ${member.username} (${member.user_id})`);
        console.log(`    Guild: ${member.guild_id}`);
      });
      console.log('');
    }
    
    process.exit(0);
  } catch (err) {
    console.error('❌ Error checking database:', err.message);
    process.exit(1);
  }
}

checkDatabase();
