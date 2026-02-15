// discord/handlers/register.js — /register command handler (flat command with optional user param)
const { EmbedBuilder } = require("discord.js");
const db = require("../../db");
const { BOOSTMON_ICON_URL, friendlyDiscordError } = require("../../utils/helpers");

module.exports = async function handleRegister(interaction) {
  await interaction.deferReply().catch(() => null);

  if (!interaction.guild) {
    return interaction.editReply({ content: "This command can only be used in a server." });
  }

  const username = interaction.options.getString("username", true);
  const display = interaction.options.getString("display", true);
  const targetUserOption = interaction.options.getUser("user"); // optional

  // If a target user is specified, require admin/owner
  const isAdminMode = !!targetUserOption && targetUserOption.id !== interaction.user.id;

  if (isAdminMode) {
    if (!interaction.memberPermissions?.has("Administrator") &&
        interaction.user.id !== interaction.guild.ownerId) {
      return interaction.editReply({
        content: "⛔ Only **Server Owner** or users with **Administrator** permission can register other users.",
        ephemeral: true
      });
    }
  }

  const discordUser = targetUserOption || interaction.user;

  try {
    const registration = await db.registerUser({
      guild_id: interaction.guild.id,
      discord_id: discordUser.id,
      discord_username: discordUser.username,
      in_game_username: username,
      display_name: display,
      registered_by: interaction.user.id,
      registered_at: new Date()
    });

    if (!registration) {
      return interaction.editReply({ content: "❌ Failed to register. Please try again." });
    }

    const embed = new EmbedBuilder()
      .setColor(0x2ECC71)
      .setAuthor({ name: "BoostMon", iconURL: BOOSTMON_ICON_URL })
      .setTitle(isAdminMode ? "✅ User Registered" : "✅ Registration Complete")
      .setTimestamp(new Date())
      .addFields(
        { name: "Discord User", value: `${discordUser}`, inline: true },
        { name: "In-Game Username", value: username, inline: true },
        { name: "Display Name", value: display, inline: true }
      );

    if (isAdminMode) {
      embed.addFields({ name: "Registered By", value: `${interaction.user}`, inline: true });
    }

    embed.setFooter({ text: "BoostMon • User Registration" });

    return interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error("Error registering user:", err);
    return interaction.editReply({
      content: "❌ Error during registration: " + friendlyDiscordError(err),
      ephemeral: true
    });
  }
};
