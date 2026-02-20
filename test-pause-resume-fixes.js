#!/usr/bin/env node
/**
 * test-pause-resume-fixes.js
 * Validates all pause/resume system fixes for v2.4.14
 */

const fs = require('fs');
const path = require('path');

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

function check(condition, message) {
  if (!condition) {
    console.log(`  ✗ ${message}`);
    return false;
  }
  console.log(`  ✓ ${message}`);
  return true;
}

// ==================== TEST CASES ====================

test("Database - getGuildTimers query fixed", () => {
  const dbPath = path.join(__dirname, 'db.js');
  const dbContent = fs.readFileSync(dbPath, 'utf-8');
  
  let success = true;
  success &= check(
    dbContent.includes('SELECT * FROM role_timers WHERE guild_id = $1 AND expires_at > $2 AND paused = false'),
    'getGuildTimers uses millisecond timestamp comparison'
  );
  success &= check(
    dbContent.includes('async function getGuildPausedTimers(guildId)'),
    'getGuildPausedTimers function exists'
  );
  return success;
});

test("Database - pauseTimerWithType implements hierarchy", () => {
  const dbPath = path.join(__dirname, 'db.js');
  const dbContent = fs.readFileSync(dbPath, 'utf-8');
  
  let success = true;
  success &= check(
    dbContent.includes('HIERARCHY: global > user'),
    'Pause type hierarchy documented'
  );
  success &= check(
    dbContent.includes('if (timer.paused && timer.pause_type === "global" && pauseType !== "global")'),
    'Prevents user pause from overriding global pause'
  );
  return success;
});

test("Database - autoResumeExpiredPauses exported", () => {
  const dbPath = path.join(__dirname, 'db.js');
  const dbContent = fs.readFileSync(dbPath, 'utf-8');
  
  let success = true;
  success &= check(
    dbContent.includes('autoResumeExpiredPauses,'),
    'autoResumeExpiredPauses is exported'
  );
  success &= check(
    dbContent.includes('getGuildPausedTimers,'),
    'getGuildPausedTimers is exported'
  );
  return success;
});

test("Cleanup Service - autoResumeExpiredPauses integrated", () => {
  const cleanupPath = path.join(__dirname, 'services', 'cleanup.js');
  const cleanupContent = fs.readFileSync(cleanupPath, 'utf-8');
  
  let success = true;
  success &= check(
    cleanupContent.includes('await db.autoResumeExpiredPauses(guildId)'),
    'autoResumeExpiredPauses is called in cleanup loop'
  );
  success &= check(
    cleanupContent.includes('AUTO-RESUME EXPIRED PAUSES'),
    'Auto-resume section is documented'
  );
  return success;
});

test("Pausetime Handler - uses correct pause result", () => {
  const pausetimePath = path.join(__dirname, 'discord', 'handlers', 'pausetime.js');
  const pausetimeContent = fs.readFileSync(pausetimePath, 'utf-8');
  
  let success = true;
  success &= check(
    pausetimeContent.includes('const pauseResult = await db.pauseTimerWithType'),
    'pauseResult captures return value from pauseTimerWithType'
  );
  success &= check(
    pausetimeContent.includes('const remainingMs = Number(pauseResult.remainingMs || 0)'),
    'remainingMs extracted from pauseResult'
  );
  success &= check(
    pausetimeContent.includes('if (!pauseResult) {'),
    'Error handling for failed pause'
  );
  return success;
});

test("Resumetime Handler - uses getGuildPausedTimers", () => {
  const resumetimePath = path.join(__dirname, 'discord', 'handlers', 'resumetime.js');
  const resumetimeContent = fs.readFileSync(resumetimePath, 'utf-8');
  
  let success = true;
  success &= check(
    resumetimeContent.includes('const pausedTimers = await db.getGuildPausedTimers(guild.id)'),
    'Global resume uses getGuildPausedTimers'
  );
  success &= check(
    resumetimeContent.includes('const filtered = pausedTimers.filter(t => t.pause_type === "global")'),
    'Filters for global pause type'
  );
  return success;
});

test("Syntax Validation - All files parse correctly", () => {
  let success = true;
  
  const files = [
    path.join(__dirname, 'db.js'),
    path.join(__dirname, 'discord', 'handlers', 'pausetime.js'),
    path.join(__dirname, 'discord', 'handlers', 'resumetime.js'),
    path.join(__dirname, 'services', 'cleanup.js'),
  ];
  
  for (const file of files) {
    try {
      require.cache = {}; // Clear cache
      require(file);
      success &= check(true, `${path.basename(file)} syntax OK`);
    } catch (err) {
      success &= check(false, `${path.basename(file)} has syntax error: ${err.message}`);
    }
  }
  
  return success;
});

test("Integration Logic - Pause hierarchy workflow", () => {
  // Verify the expected flow:
  // 1. Global pause prevents user pause (hierarchy)
  // 2. Auto-resume calls resumeTimerByType with pause_type
  // 3. getGuildTimers returns non-paused timers
  // 4. getGuildPausedTimers returns paused timers
  
  let success = true;
  const dbPath = path.join(__dirname, 'db.js');
  const dbContent = fs.readFileSync(dbPath, 'utf-8');
  
  success &= check(
    dbContent.includes('pause_type') && dbContent.includes('pause_expires_at'),
    'Pause tracking columns used throughout'
  );
  success &= check(
    dbContent.includes('resumeTimerByType(timer.user_id, timer.role_id, timer.pause_type)'),
    'autoResumeExpiredPauses preserves pause_type when resuming'
  );
  
  return success;
});

// ==================== RUN TESTS ====================

console.log('\n' + '='.repeat(60));
console.log('  PAUSE/RESUME SYSTEM FIX VALIDATION (v2.4.14)');
console.log('='.repeat(60) + '\n');

for (const { name, fn } of tests) {
  console.log(`Testing: ${name}`);
  try {
    const result = fn();
    if (result === false) {
      failed++;
    } else {
      passed++;
    }
  } catch (err) {
    console.log(`  ✗ Test crashed: ${err.message}`);
    failed++;
  }
  console.log();
}

// ==================== SUMMARY ====================

console.log('='.repeat(60));
console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));

if (failed > 0) {
  console.log('\n⚠️  Some fixes need review!');
  process.exit(1);
} else {
  console.log('\n✅ All fixes validated successfully!');
  process.exit(0);
}
