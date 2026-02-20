// discord/handlers/pausetime.js — /timer pause command handler
const { EmbedBuilder } = require("discord.js");
const db = require("../../db");
const { canManageRole } = require("../../utils/permissions");
const { BOOSTMON_ICON_URL, formatMs } = require("../../utils/helpers");

module.exports = async function handlePausetime(interaction) {
  await interaction.deferReply().catch(() => null);

  if (!interaction.guild) {
    return interaction.editReply({ content: "This command can only be used in a server." });
  }

  const guild = interaction.guild;
  const targetUser = interaction.options.getUser("user", false); // optional
  const roleOption = interaction.options.getRole("role", false); // optional
  const durationMinutes = interaction.options.getInteger("duration"); // optional
  const isGlobal = interaction.options.getBoolean("global") || false; // optional

  // ── VALIDATE: Must provide user for user pause, or global flag for global pause ──
  if (!targetUser && !isGlobal) {
    return interaction.editReply({
      content: "You must either specify a **user** to pause their timer(s), or use the **global** flag to pause all timers in this server.",
    });
  }

  // ── GLOBAL PAUSE (pause all or all with a specific role) ──
  if (isGlobal) {
    // Check if user has Manage Guild permission
    if (!interaction.memberPermissions?.has("ManageGuild")) {
      return interaction.editReply({
        content: "You need **Manage Guild** permission to pause timers globally.",
      });
    }

    // Fetch all timers in guild
    const allTimers = await db.getGuildTimers(guild.id);

    if (allTimers.length === 0) {
      return interaction.editReply({ content: "There are no active timers in this server." });
    }

    let filteredTimers = allTimers;
    if (roleOption) {
      filteredTimers = allTimers.filter(t => t.role_id === roleOption.id);
      if (filteredTimers.length === 0) {
        return interaction.editReply({
          content: `No active timers found for **${roleOption.name}**.`,
        });
      }
    }

    // Pause all filtered timers with "global" type
    const pauseCount = filteredTimers.length;
    for (const timer of filteredTimers) {
      await db.pauseTimerWithType(timer.user_id, timer.role_id, "global", durationMinutes);
    }

    const roleInfo = roleOption ? ` for **${roleOption.name}**` : "";
    const durationInfo = durationMinutes ? ` for ${durationMinutes} minute(s)` : " indefinitely";

    const embed = new EmbedBuilder()
      .setColor(0xF1C40F) // yellow = paused
      .setAuthor({ name: "BoostMon", iconURL: BOOSTMON_ICON_URL })
      .setTitle("🌍 Global Pause Applied")
      .setTimestamp(new Date())
      .addFields(
        { name: "Command Run By", value: `${interaction.user}`, inline: true },
        { name: "Type", value: "Global Pause", inline: true },
        { name: "Timers Paused", value: `**${pauseCount}** timer(s)${roleInfo}`, inline: false },
        { name: "Duration", value: `**${durationInfo}**`, inline: false }
      )
      .setFooter({ text: "BoostMon • Global Pause" });

    return interaction.editReply({ embeds: [embed] });
  }

  // ── USER PAUSE (pause specific user's timer(s)) ──
  if (!targetUser) {
    return interaction.editReply({
      content: "Target user is required for user pause.",
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

  let roleIdToPause = null;

  if (roleOption) {
    roleIdToPause = roleOption.id;
    if (!timedRoleIds.includes(roleIdToPause)) {
      return interaction.editReply({
        content: `${targetUser} has no saved time for **${roleOption.name}**.`,
      });
    }
  } else {
    // Auto-select: prefer a role the member currently has, else first in list
    const matching = timedRoleIds.find((rid) => member.roles.cache.has(rid));
    roleIdToPause = matching || timedRoleIds[0];
  }

  const roleObj = guild.roles.cache.get(roleIdToPause);
  const roleName = roleObj?.name || "that role";

  if (!roleObj) {
    return interaction.editReply({
      content: `That role no longer exists in this server, but a timer is stored for it. Use /timer clear to remove the stored timer.`,
    });
  }

  const permCheck = await canManageRole(guild, roleObj);
  if (!permCheck.ok) {
    return interaction.editReply({ content: permCheck.reason });
  }

  const entry = await db.getTimerForRole(targetUser.id, roleIdToPause);

  if (entry?.paused) {
    return interaction.editReply({
      content: `${targetUser}'s timer for **${roleName}** is already paused.`,
    });
  }

  // Pause with "user" type and get the pause result with remaining time
  const pauseResult = await db.pauseTimerWithType(targetUser.id, roleIdToPause, "user", durationMinutes);
  
  if (!pauseResult) {
    return interaction.editReply({
      content: `Failed to pause ${targetUser}'s timer for **${roleName}**. The timer may already be paused.`,
    });
  }

  const remainingMs = Number(pauseResult.remainingMs || 0);
  const durationInfo = durationMinutes ? ` for ${durationMinutes} minute(s)` : " indefinitely";

  const embed = new EmbedBuilder()
    .setColor(0xF1C40F) // yellow = paused
    .setAuthor({ name: "BoostMon", iconURL: BOOSTMON_ICON_URL })
    .setTitle("⏸️ Timed Role Paused")
    .setTimestamp(new Date())
    .addFields(
      { name: "Command Run By", value: `${interaction.user}`, inline: true },
      { name: "Time Run", value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
      { name: "Target User", value: `${targetUser}`, inline: true },
      { name: "Role", value: `${roleObj}`, inline: true },
      { name: "Remaining", value: `**${formatMs(remainingMs)}**`, inline: true },
      { name: "Pause Type", value: "User Pause", inline: true },
      { name: "Duration", value: durationInfo, inline: false }
    )
    .setFooter({ text: "BoostMon • Paused Timer" });

  return interaction.editReply({ embeds: [embed] });
};
