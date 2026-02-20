// discord/handlers/resumetime.js — /timer resume command handler
const { EmbedBuilder } = require("discord.js");
const db = require("../../db");
const { canManageRole } = require("../../utils/permissions");
const { BOOSTMON_ICON_URL, formatMs } = require("../../utils/helpers");

module.exports = async function handleResumetime(interaction) {
  await interaction.deferReply().catch(() => null);

  if (!interaction.guild) {
    return interaction.editReply({ content: "This command can only be used in a server." });
  }

  const guild = interaction.guild;
  const targetUser = interaction.options.getUser("user", false); // optional
  const roleOption = interaction.options.getRole("role", false); // optional
  const isGlobal = interaction.options.getBoolean("global") || false; // optional

  // ── VALIDATE: Must provide user for user resume, or global flag for global resume ──
  if (!targetUser && !isGlobal) {
    return interaction.editReply({
      content: "You must either specify a **user** to resume their timer(s), or use the **global** flag to resume all globally-paused timers.",
    });
  }

  // ── GLOBAL RESUME (resume only timers paused by global pause, respecting user pauses) ──
  if (isGlobal) {
    // Check if user has Manage Guild permission
    if (!interaction.memberPermissions?.has("ManageGuild")) {
      return interaction.editReply({
        content: "You need **Manage Guild** permission to resume timers globally.",
      });
    }

    // Fetch all PAUSED timers in guild that are paused with "global" type
    const pausedTimers = await db.getGuildPausedTimers(guild.id);
    const filtered = pausedTimers.filter(t => t.pause_type === "global");

    if (filtered.length === 0) {
      return interaction.editReply({
        content: "There are no timers paused globally in this server.",
      });
    }

    // Resume only "global" pauses
    let resumeCount = 0;
    for (const timer of filtered) {
      const resumed = await db.resumeTimerByType(timer.user_id, timer.role_id, "global");
      if (resumed) resumeCount++;
    }

    const embed = new EmbedBuilder()
      .setColor(0x2ECC71) // green = active
      .setAuthor({ name: "BoostMon", iconURL: BOOSTMON_ICON_URL })
      .setTitle("🌍 Global Pause Lifted")
      .setTimestamp(new Date())
      .addFields(
        { name: "Command Run By", value: `${interaction.user}`, inline: true },
        { name: "Type", value: "Global Resume", inline: true },
        { name: "Timers Resumed", value: `**${resumeCount}** timer(s)`, inline: false },
        { name: "Note", value: "User-paused timers remain paused (user pauses take precedence)", inline: false }
      )
      .setFooter({ text: "BoostMon • Global Resume" });

    return interaction.editReply({ embeds: [embed] });
  }

  // ── USER RESUME (resume specific user's timer(s)) ──
  if (!targetUser) {
    return interaction.editReply({
      content: "Target user is required for user resume.",
    });
  }

  let member;
  try {
    member = await guild.members.fetch(targetUser.id);
  } catch {
    return interaction.editReply({
      content: `Could not fetch ${targetUser} from this server.`,
    });
  }

  // Get timers for this user
  const timers = await db.getTimersForUser(targetUser.id);
  const timedRoleIds = timers.map(t => t.role_id);

  if (timedRoleIds.length === 0) {
    return interaction.editReply({ content: `${targetUser} has no active timed roles.` });
  }

  let roleIdToResume = null;

  if (roleOption) {
    roleIdToResume = roleOption.id;
    if (!timedRoleIds.includes(roleIdToResume)) {
      return interaction.editReply({
        content: `${targetUser} has no saved time for **${roleOption.name}**.`,
      });
    }
  } else {
    // Auto-select: prefer a role the member currently has, else first in list
    const matching = timedRoleIds.find((rid) => member.roles.cache.has(rid));
    roleIdToResume = matching || timedRoleIds[0];
  }

  const roleObj = guild.roles.cache.get(roleIdToResume);
  const roleName = roleObj?.name || "that role";

  const entry = await db.getTimerForRole(targetUser.id, roleIdToResume);

  if (!entry?.paused) {
    return interaction.editReply({
      content: `${targetUser}'s timer for **${roleName}** is not paused.`,
    });
  }

  if (!roleObj) {
    await db.clearRoleTimer(targetUser.id, roleIdToResume);
    return interaction.editReply({
      content: `That role no longer exists in this server, so I cleared the saved timer for ${targetUser}.`,
    });
  }

  const permCheck = await canManageRole(guild, roleObj);
  if (!permCheck.ok) {
    return interaction.editReply({ content: permCheck.reason });
  }

  const remainingMs = Math.max(0, Number(entry.paused_remaining_ms || 0));

  if (remainingMs <= 0) {
    await db.clearRoleTimer(targetUser.id, roleIdToResume);
    if (member.roles.cache.has(roleIdToResume)) {
      await member.roles.remove(roleIdToResume).catch(() => null);
    }
    return interaction.editReply({
      content: `No time remained to resume for ${targetUser} on **${roleName}**. Timer cleared and role removed.`,
    });
  }

  // Resume only if pause_type is "user" (or null for legacy), respecting hierarchy
  const resumed = await db.resumeTimerByType(targetUser.id, roleIdToResume, entry.pause_type || "user");

  if (!resumed) {
    // Timer is paused by global pause, not user pause
    return interaction.editReply({
      content: `${targetUser}'s timer for **${roleName}** is paused globally. Use /timer resume global to lift global pauses.`,
    });
  }

  // Ensure role is on the member
  if (!member.roles.cache.has(roleIdToResume)) {
    await member.roles.add(roleIdToResume).catch(() => null);
  }

  const newExpiresAt = await db.getTimerExpiry(targetUser.id, roleIdToResume);

  const embed = new EmbedBuilder()
    .setColor(0x2ECC71) // green = active
    .setAuthor({ name: "BoostMon", iconURL: BOOSTMON_ICON_URL })
    .setTitle("▶️ Timed Role Resumed")
    .setTimestamp(new Date())
    .addFields(
      { name: "Command Run By", value: `${interaction.user}`, inline: true },
      { name: "Time Run", value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
      { name: "Target User", value: `${targetUser}`, inline: true },
      { name: "Role", value: `${roleObj}`, inline: true },
      { name: "Remaining", value: `**${formatMs(remainingMs)}**`, inline: true },
      { name: "Pause Type", value: entry.pause_type ? `${entry.pause_type} pause` : "Legacy pause", inline: true },
      {
        name: "New Expiry",
        value: `<t:${Math.floor(newExpiresAt / 1000)}:F>\n(<t:${Math.floor(newExpiresAt / 1000)}:R>)`,
        inline: false,
      }
    )
    .setFooter({ text: "BoostMon • Active Timer" });

  return interaction.editReply({ embeds: [embed] });
};
