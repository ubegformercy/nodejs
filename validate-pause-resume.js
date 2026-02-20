#!/usr/bin/env node
/**
 * Validation script for pause/resume system implementation
 * Checks that all components are in place
 */

const fs = require("fs");
const path = require("path");

function checkFileExists(filePath) {
  return fs.existsSync(filePath);
}

function checkFileContains(filePath, searchString) {
  const content = fs.readFileSync(filePath, "utf-8");
  return content.includes(searchString);
}

console.log("\n📋 PAUSE/RESUME SYSTEM VALIDATION\n");

const checks = [];

// 1. Check Database Functions
console.log("🔍 Database Functions:");
const dbFunctions = [
  { name: "pauseTimerWithType", exported: true },
  { name: "resumeTimerByType", exported: true },
  { name: "autoResumeExpiredPauses", exported: true },
  { name: "getGuildTimers", exported: true },
  { name: "getTimerRemaining", exported: true },
  { name: "getTimerExpiry", exported: true }
];

for (const func of dbFunctions) {
  const exists = checkFileContains("/workspaces/nodejs/db.js", `async function ${func.name}`);
  const exported = checkFileContains("/workspaces/nodejs/db.js", func.name);
  const status = exists && exported ? "✓" : "✗";
  console.log(`  ${status} ${func.name}`);
  checks.push({ name: func.name, ok: exists && exported });
}

// 2. Check Handler Files
console.log("\n🔍 Handler Files:");
const handlers = [
  { path: "/workspaces/nodejs/discord/handlers/pausetime.js", name: "pausetime.js" },
  { path: "/workspaces/nodejs/discord/handlers/resumetime.js", name: "resumetime.js" }
];

for (const handler of handlers) {
  const exists = checkFileExists(handler.path);
  const status = exists ? "✓" : "✗";
  console.log(`  ${status} ${handler.name}`);
  checks.push({ name: `Handler: ${handler.name}`, ok: exists });
}

// 3. Check Command Definitions
console.log("\n🔍 Command Definitions:");
const pauseDefExists = checkFileContains("/workspaces/nodejs/discord/commands.js", ".setName(\"pause\")");
const resumeDefExists = checkFileContains("/workspaces/nodejs/discord/commands.js", ".setName(\"resume\")");
console.log(`  ${pauseDefExists ? "✓" : "✗"} /timer pause subcommand`);
console.log(`  ${resumeDefExists ? "✓" : "✗"} /timer resume subcommand`);
checks.push({ name: "pause subcommand", ok: pauseDefExists });
checks.push({ name: "resume subcommand", ok: resumeDefExists });

// 4. Check for duration option
const durationOptExists = checkFileContains("/workspaces/nodejs/discord/commands.js", ".setName(\"duration\")");
const globalOptExists = checkFileContains("/workspaces/nodejs/discord/commands.js", ".setName(\"global\")");
console.log(`  ${durationOptExists ? "✓" : "✗"} duration option in commands`);
console.log(`  ${globalOptExists ? "✓" : "✗"} global option in commands`);
checks.push({ name: "duration option", ok: durationOptExists });
checks.push({ name: "global option", ok: globalOptExists });

// 5. Check pause_type schema
console.log("\n🔍 Database Schema:");
const pauseTypeExists = checkFileContains("/workspaces/nodejs/db.js", "pause_type VARCHAR(50)");
const pauseExpiresExists = checkFileContains("/workspaces/nodejs/db.js", "pause_expires_at BIGINT");
console.log(`  ${pauseTypeExists ? "✓" : "✗"} pause_type column`);
console.log(`  ${pauseExpiresExists ? "✓" : "✗"} pause_expires_at column`);
checks.push({ name: "pause_type column", ok: pauseTypeExists });
checks.push({ name: "pause_expires_at column", ok: pauseExpiresExists });

// 6. Handler Logic Checks
console.log("\n🔍 Handler Logic:");
const pauseGlobalLogic = checkFileContains("/workspaces/nodejs/discord/handlers/pausetime.js", "if (isGlobal)");
const resumeGlobalLogic = checkFileContains("/workspaces/nodejs/discord/handlers/resumetime.js", "if (isGlobal)");
const pauseTypeInPause = checkFileContains("/workspaces/nodejs/discord/handlers/pausetime.js", "pauseTimerWithType");
const pauseTypeInResume = checkFileContains("/workspaces/nodejs/discord/handlers/resumetime.js", "resumeTimerByType");
console.log(`  ${pauseGlobalLogic ? "✓" : "✗"} Global pause logic in pausetime.js`);
console.log(`  ${resumeGlobalLogic ? "✓" : "✗"} Global resume logic in resumetime.js`);
console.log(`  ${pauseTypeInPause ? "✓" : "✗"} pauseTimerWithType call in pausetime.js`);
console.log(`  ${pauseTypeInResume ? "✓" : "✗"} resumeTimerByType call in resumetime.js`);
checks.push({ name: "Global pause logic", ok: pauseGlobalLogic });
checks.push({ name: "Global resume logic", ok: resumeGlobalLogic });
checks.push({ name: "pauseTimerWithType usage", ok: pauseTypeInPause });
checks.push({ name: "resumeTimerByType usage", ok: pauseTypeInResume });

// Summary
console.log("\n📊 SUMMARY:");
const passCount = checks.filter(c => c.ok).length;
const totalCount = checks.length;
const percentage = Math.round((passCount / totalCount) * 100);

console.log(`  ✓ ${passCount} / ${totalCount} checks passed (${percentage}%)`);

if (passCount === totalCount) {
  console.log("\n✅ All checks passed! Pause/Resume system is ready.\n");
  process.exit(0);
} else {
  console.log("\n⚠️  Some checks failed. Please review the implementation.\n");
  process.exit(1);
}
