#!/usr/bin/env node

/**
 * migrate.js - Migrate existing BoostMon timers from data.json to PostgreSQL
 * 
 * Usage: node migrate.js [--data-file=path/to/data.json]
 * 
 * This script:
 * 1. Reads timers from data.json
 * 2. Connects to PostgreSQL (via DATABASE_URL)
 * 3. Inserts all timers into role_timers table
 * 4. Skips duplicates (user_id + role_id must be unique)
 * 5. Reports migration summary
 */

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

// Parse arguments
let dataFile = path.join(__dirname, "data.json");
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith("--data-file=")) {
    dataFile = arg.split("=")[1];
  }
}

async function migrate() {
  console.log("=== BoostMon JSON → PostgreSQL Migration ===\n");

  // Step 1: Check DATABASE_URL
  if (!process.env.DATABASE_URL) {
    console.error("❌ ERROR: DATABASE_URL environment variable not set");
    console.error("   Set it before running: export DATABASE_URL=postgresql://...");
    process.exit(1);
  }
  console.log("✓ DATABASE_URL found");

  // Step 2: Check data.json exists
  if (!fs.existsSync(dataFile)) {
    console.error(`❌ ERROR: ${dataFile} not found`);
    process.exit(1);
  }
  console.log(`✓ Found ${dataFile}`);

  // Step 3: Parse data.json
  let data;
  try {
    const jsonText = fs.readFileSync(dataFile, "utf8");
    data = JSON.parse(jsonText);
    console.log(`✓ Parsed data.json`);
  } catch (err) {
    console.error(`❌ ERROR: Failed to parse data.json: ${err.message}`);
    process.exit(1);
  }

  // Step 4: Connect to database
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let client;
  
  try {
    client = await pool.connect();
    console.log("✓ Connected to PostgreSQL");
  } catch (err) {
    console.error(`❌ ERROR: Failed to connect to database: ${err.message}`);
    await pool.end();
    process.exit(1);
  }

  try {
    // Step 5: Initialize schema if needed
    await client.query(`
      CREATE TABLE IF NOT EXISTS role_timers (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        role_id VARCHAR(255) NOT NULL,
        expires_at BIGINT NOT NULL,
        warn_channel_id VARCHAR(255),
        paused BOOLEAN DEFAULT false,
        paused_at BIGINT,
        paused_remaining_ms BIGINT DEFAULT 0,
        warnings_sent JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, role_id)
      );
    `);
    console.log("✓ Database schema ready\n");

    // Step 6: Migrate data
    let totalCount = 0;
    let migratedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    const errors = [];

    console.log("Migrating timers...");

    for (const userId in data) {
      const userData = data[userId];
      
      if (!userData || !userData.roles) {
        continue;
      }

      for (const roleId in userData.roles) {
        totalCount++;
        
        try {
          const entry = userData.roles[roleId];
          
          // Convert old data format
          const expiresAt = entry.expiresAt || 0;
          const warnChannelId = entry.warnChannelId || null;
          const warningsSent = entry.warningsSent || {};
          const paused = entry.paused || false;
          const pausedAt = entry.paused_at || null;
          const pausedRemainingMs = entry.paused_remaining_ms || 0;

          // Insert or skip on conflict
          const result = await client.query(
            `INSERT INTO role_timers 
              (user_id, role_id, expires_at, warn_channel_id, warnings_sent, paused, paused_at, paused_remaining_ms)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (user_id, role_id) DO NOTHING
             RETURNING id`,
            [userId, roleId, expiresAt, warnChannelId, JSON.stringify(warningsSent), paused, pausedAt, pausedRemainingMs]
          );

          if (result.rows.length > 0) {
            migratedCount++;
          } else {
            skippedCount++;
          }
        } catch (err) {
          errorCount++;
          errors.push(`  User ${userId}, Role ${roleId}: ${err.message}`);
        }
      }
    }

    // Step 7: Report results
    console.log("\n=== Migration Summary ===");
    console.log(`Total timers:    ${totalCount}`);
    console.log(`Migrated:        ${migratedCount} ✓`);
    console.log(`Skipped (dupe):  ${skippedCount}`);
    console.log(`Errors:          ${errorCount} ❌`);

    if (errors.length > 0) {
      console.log("\nErrors encountered:");
      errors.forEach(e => console.log(e));
    }

    if (errorCount === 0) {
      console.log("\n✅ Migration completed successfully!");
      
      // Verify data
      const checkResult = await client.query("SELECT COUNT(*) FROM role_timers");
      const count = parseInt(checkResult.rows[0].count);
      console.log(`   Database now contains ${count} timer(s)`);
      
      console.log("\nNext steps:");
      console.log("1. Verify timers in Discord with /timeleft command");
      console.log("2. Archive data.json: mv data.json data.json.backup");
      console.log("3. Restart the bot to apply changes");
    } else {
      console.log("\n⚠️  Migration completed with errors. Review above.");
      process.exit(1);
    }

  } catch (err) {
    console.error(`❌ ERROR during migration: ${err.message}`);
    process.exit(1);
  } finally {
    if (client) client.release();
    await pool.end();
  }
}

migrate().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
