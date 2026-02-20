// services/cleanup.js — cleanupAndWarn background loop for timer expiration, warnings, autopurge, reports
const { PermissionFlagsBits } = require("discord.js");
const db = require("../db");
const { syncStreakRoles } = require("./streak");
const { sendWarningOrDm, sendExpiredNoticeOrDm } = require("./notifications");
const { executeScheduledRolestatus, executeAutopurges, executeQueueNotifications } = require("./scheduled-reports");

const WARNING_THRESHOLDS_MIN = [60, 10, 1];
const CHECK_INTERVAL_MS = 30_000;

let _client = null;
let _GUILD_ID = null;

function start(client, GUILD_ID) {
  _client = client;
  _GUILD_ID = GUILD_ID;

  setInterval(() => {
    cleanupAndWarn();
  }, CHECK_INTERVAL_MS);
}

async function cleanupAndWarn() {
  try {
    if (!_client.isReady()) return;

    const now = Date.now();

    const allTimers = await db.getAllActiveTimers().catch(() => []);

    const timersByGuild = {};
    for (const timer of allTimers) {
      const gId = timer.guild_id || _GUILD_ID;
      if (!gId) continue;
      if (!timersByGuild[gId]) timersByGuild[gId] = [];
      timersByGuild[gId].push(timer);
    }

    const guildIdsWithSchedules = await db.getAllGuildIdsWithSchedules().catch(() => []);
    for (const guildId of guildIdsWithSchedules) {
      if (!timersByGuild[guildId]) {
        timersByGuild[guildId] = [];
      }
    }

    const queueNotifyGuilds = await db.getAllQueueNotifyGuilds().catch(() => []);
    for (const row of queueNotifyGuilds) {
      if (!timersByGuild[row.guild_id]) {
        timersByGuild[row.guild_id] = [];
      }
    }

    for (const guildId in timersByGuild) {
      const guild = await _client.guilds.fetch(guildId).catch(() => null);
      if (!guild) continue;

      const me = await guild.members.fetchMe().catch(() => null);
      const canManage = Boolean(me?.permissions?.has(PermissionFlagsBits.ManageRoles));

      // ── AUTO-RESUME EXPIRED PAUSES ──
      await db.autoResumeExpiredPauses(guildId).catch(err => {
        console.error(`[Cleanup] autoResumeExpiredPauses failed for guild ${guildId}:`, err);
      });

      for (const entry of timersByGuild[guildId]) {
        const userId = entry.user_id;
        const roleId = entry.role_id;
        const expiresAt = Number(entry.expires_at);
        const warnChannelId = entry.warn_channel_id;
        const isPaused = entry.paused;

        if (isPaused) continue;
        if (!expiresAt || expiresAt <= 0) continue;

        const leftMs = expiresAt - now;

        if (leftMs <= 0) {
          const streak = await db.getUserStreak(guild.id, userId);
          const member = await guild.members.fetch(userId).catch(() => null);
          const roleObj = guild.roles.cache.get(roleId);

          if (streak && streak.streak_start_at) {
            if (streak.save_tokens > 0) {
              const gracePeriodUntil = new Date(now + 24 * 60 * 60 * 1000);
              await db.upsertUserStreak(guild.id, userId, {
                save_tokens: streak.save_tokens - 1,
                grace_period_until: gracePeriodUntil,
              });

              const newExpiresAt = now + 24 * 60 * 60 * 1000;
              await db.pool.query("UPDATE role_timers SET expires_at = $1 WHERE id = $2", [newExpiresAt, entry.id]);
              console.log(`[Streak] Save used for ${userId} in ${guild.id}. 24h grace period granted.`);
              continue;
            } else {
              const streakDays = Math.floor((now - new Date(streak.streak_start_at).getTime()) / (24 * 60 * 60 * 1000));
              const streakRoles = await db.getStreakRoles(guild.id);

              let currentTierDays = 0;
              for (const sr of streakRoles) {
                if (streakDays >= sr.day_threshold && sr.day_threshold > currentTierDays) {
                  currentTierDays = sr.day_threshold;
                }
              }

              let nextTierDown = 0;
              for (const sr of streakRoles) {
                if (sr.day_threshold < currentTierDays && sr.day_threshold > nextTierDown) {
                  nextTierDown = sr.day_threshold;
                }
              }

              if (currentTierDays > 0) {
                const newStreakStart = new Date(now - nextTierDown * 24 * 60 * 60 * 1000);
                await db.upsertUserStreak(guild.id, userId, {
                  streak_start_at: newStreakStart,
                  degradation_started_at: new Date(now),
                });

                if (member) await syncStreakRoles(member, nextTierDown, streakRoles);

                const newExpiresAt = now + 24 * 60 * 60 * 1000;
                await db.pool.query("UPDATE role_timers SET expires_at = $1 WHERE id = $2", [newExpiresAt, entry.id]);
                console.log(`[Streak] Degraded ${userId} to ${nextTierDown} day tier.`);
                continue;
              } else {
                await db.upsertUserStreak(guild.id, userId, { streak_start_at: null, degradation_started_at: null });
              }
            }
          }

          if (canManage && member && roleObj && me.roles.highest.position > roleObj.position) {
            await member.roles.remove(roleId).catch(() => null);
          }

          await sendExpiredNoticeOrDm(guild, userId, roleId, warnChannelId).catch(() => null);
          await db.clearRoleTimer(userId, roleId).catch(() => null);
          continue;
        }

        const leftMin = Math.ceil(leftMs / 60_000);
        const warningsSent = entry.warnings_sent || {};

        for (const thresholdMin of WARNING_THRESHOLDS_MIN) {
          const key = String(thresholdMin);
          if (leftMin <= thresholdMin && !warningsSent[key]) {
            await sendWarningOrDm(guild, userId, roleId, leftMin, warnChannelId).catch(() => null);
            await db.markWarningAsSent(userId, roleId, thresholdMin).catch(() => null);
          }
        }
      }

      await executeAutopurges(guild, now);
      await executeScheduledRolestatus(guild, now);
      await executeQueueNotifications(guild, now);
    }
  } catch (e) {
    console.error("cleanupAndWarn error:", e);
  }
}

module.exports = { start, cleanupAndWarn };
