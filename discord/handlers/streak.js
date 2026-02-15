// discord/handlers/streak.js — /streak command handler
const { EmbedBuilder } = require("discord.js");
const db = require("../../db");
const { BOOSTMON_ICON_URL } = require("../../utils/helpers");

module.exports = async function handleStreak(interaction) {
  const guild = interaction.guild;
  if (!guild) {
    return interaction.reply({ content: "This command can only be used in a server.", ephemeral: true });
  }

  const subcommand = interaction.options.getSubcommand();
  const group = interaction.options.getSubcommandGroup(false);

  if (group === "admin") {
    await interaction.deferReply().catch(() => null);
    if (!interaction.memberPermissions?.has("Administrator")) {
      return interaction.editReply({ content: "⛔ Only administrators can use this command.", ephemeral: true });
    }

    const targetUser = interaction.options.getUser("user", true);
    const amount = interaction.options.getInteger("amount") || 1;

    if (subcommand === "grant-save") {
      await db.updateUserStreakSaves(guild.id, targetUser.id, amount);
      return interaction.editReply({ content: `✅ Granted ${amount} save token(s) to ${targetUser}.` });
    } else if (subcommand === "remove-save") {
      await db.updateUserStreakSaves(guild.id, targetUser.id, -amount);
      return interaction.editReply({ content: `✅ Removed ${amount} save token(s) from ${targetUser}.` });
    } else if (subcommand === "set") {
      const days = interaction.options.getInteger("days", true);
      const now = new Date();
      const streakStart = days > 0
        ? new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
        : null;

      await db.upsertUserStreak(guild.id, targetUser.id, {
        streak_start_at: streakStart,
        degradation_started_at: null,
      });

      // Sync streak roles if applicable
      const streakRoles = await db.getStreakRoles(guild.id);
      if (streakRoles.length > 0) {
        const member = await guild.members.fetch(targetUser.id).catch(() => null);
        if (member) {
          const { syncStreakRoles } = require("../../services/streak");
          await syncStreakRoles(member, days, streakRoles);
        }
      }

      if (days === 0) {
        return interaction.editReply({ content: `✅ Reset ${targetUser}'s boost streak to **0 days**.` });
      }
      return interaction.editReply({ content: `✅ Set ${targetUser}'s boost streak to **${days} days** (started <t:${Math.floor(streakStart.getTime() / 1000)}:D>).` });
    }
  }

  if (subcommand === "status") {
    await interaction.deferReply().catch(() => null);
    const targetUser = interaction.options.getUser("user") || interaction.user;
    const streak = await db.getUserStreak(guild.id, targetUser.id);

    const embed = new EmbedBuilder()
      .setColor(0x3498DB)
      .setAuthor({ name: "BoostMon", iconURL: BOOSTMON_ICON_URL })
      .setTitle(`🔥 Streak Status: ${targetUser.username}`)
      .setTimestamp(new Date());

    if (!streak || !streak.streak_start_at) {
      embed.setDescription(`${targetUser} does not have an active boost streak.`);
    } else {
      const days = Math.floor((Date.now() - new Date(streak.streak_start_at)) / (24 * 60 * 60 * 1000));
      const saves = streak.save_tokens || 0;

      embed.addFields(
        { name: "Current Streak", value: `**${days} days**`, inline: true },
        { name: "Streak Saves", value: `**${saves}**`, inline: true },
        { name: "Started On", value: `<t:${Math.floor(new Date(streak.streak_start_at).getTime() / 1000)}:D>`, inline: true }
      );

      if (streak.grace_period_until && new Date(streak.grace_period_until) > new Date()) {
        embed.addFields({ name: "🛡️ Grace Period", value: `Ends <t:${Math.floor(new Date(streak.grace_period_until).getTime() / 1000)}:R>`, inline: false });
      }
    }

    return interaction.editReply({ embeds: [embed] });
  }

  if (subcommand === "leaderboard") {
    await interaction.deferReply().catch(() => null);
    const listSize = await db.getStreakLeaderboardSize(guild.id);
    const leaderboard = await db.getStreakLeaderboard(guild.id, listSize);

    if (leaderboard.length === 0) {
      return interaction.editReply({ content: "No active boost streaks found in this server." });
    }

    const lines = [];
    for (let index = 0; index < leaderboard.length; index++) {
      const entry = leaderboard[index];
      const days = Math.floor((Date.now() - new Date(entry.streak_start_at)) / (24 * 60 * 60 * 1000));
      const medal = index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : "🔹";

      // Resolve display name the same way /rolestatus view does
      let displayName = entry.display_name || entry.username || `<@${entry.user_id}>`;
      let inGameUsername = null;
      try {
        const member = await guild.members.fetch(entry.user_id).catch(() => null);
        if (member) {
          displayName = member.nickname || member.user.globalName || member.user.username;
          const registration = await db.getUserRegistration(guild.id, entry.user_id).catch(() => null);
          inGameUsername = registration?.in_game_username || null;
        }
      } catch (_) { /* keep fallback */ }

      const nameText = inGameUsername
        ? `${displayName} - (${inGameUsername})`
        : displayName;

      lines.push(`${medal} **#${index + 1}** • **${days} Days** • ${entry.save_tokens} Saves • ${nameText}`);
    }

    // Split into chunks that fit Discord's 4096-char description limit
    const chunks = [];
    let current = [];
    let currentLen = 0;
    for (const line of lines) {
      const lineLen = line.length + 1; // +1 for the newline
      if (currentLen + lineLen > 3900 && current.length > 0) {
        chunks.push(current);
        current = [];
        currentLen = 0;
      }
      current.push(line);
      currentLen += lineLen;
    }
    if (current.length > 0) chunks.push(current);

    const embeds = chunks.map((chunk, i) => {
      const embed = new EmbedBuilder()
        .setColor(0xF1C40F)
        .setAuthor({ name: "BoostMon", iconURL: BOOSTMON_ICON_URL })
        .setDescription(chunk.join("\n"))
        .setTimestamp(new Date());

      if (i === 0) {
        embed.setTitle("🏆 Streak Leaderboard");
      }
      if (i === chunks.length - 1) {
        embed.setFooter({ text: `BoostMon • Showing ${leaderboard.length} members` });
      }
      return embed;
    });

    return interaction.editReply({ embeds });
  }
};
