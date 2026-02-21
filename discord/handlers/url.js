// discord/handlers/url.js — /url command handler for role-based server URLs
const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, PermissionFlagsBits } = require("discord.js");
const db = require("../../db");
const { BOOSTMON_ICON_URL } = require("../../utils/helpers");

module.exports = async function handleUrl(interaction) {
  if (!interaction.guild) {
    return interaction.reply({ content: "This command can only be used in a server.", ephemeral: true });
  }

  const subcommand = interaction.options.getSubcommand();
  const guild = interaction.guild;

  // ── /url put ──
  if (subcommand === "put") {
    // Check admin permission
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({
        content: "⛔ Only **Server Owner** or users with **Administrator** permission can set server URLs.",
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true }).catch(() => null);

    const url = interaction.options.getString("url", true);
    const role = interaction.options.getRole("role", true);

    // Validate URL format
    try {
      new URL(url);
    } catch (err) {
      return interaction.editReply({
        content: "❌ Invalid URL format. Please provide a valid URL starting with http:// or https://",
      });
    }

    // Store the URL
    const result = await db.setServerUrl(guild.id, role.id, url, interaction.user.id);

    const embed = new EmbedBuilder()
      .setColor(0x2ECC71)
      .setAuthor({ name: "BoostMon", iconURL: BOOSTMON_ICON_URL })
      .setTitle("✅ Server URL Saved")
      .setTimestamp(new Date())
      .addFields(
        { name: "Role", value: `${role}`, inline: true },
        { name: "Set By", value: `${interaction.user}`, inline: true },
        { name: "URL Preview", value: url.length > 100 ? url.substring(0, 97) + "..." : url, inline: false }
      )
      .setFooter({ text: "BoostMon • Server URLs" });

    return interaction.editReply({ embeds: [embed] });
  }

  // ── /url get ──
  if (subcommand === "get") {
    await interaction.deferReply({ ephemeral: true }).catch(() => null);

    const member = await guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member) {
      return interaction.editReply({ content: "❌ Could not fetch your member info." });
    }

    // Get all role IDs the user has
    const userRoleIds = Array.from(member.roles.cache.keys());

    if (userRoleIds.length === 0) {
      const embed = new EmbedBuilder()
        .setColor(0x95A5A6)
        .setAuthor({ name: "BoostMon", iconURL: BOOSTMON_ICON_URL })
        .setTitle("🔗 Your Server URLs")
        .setTimestamp(new Date())
        .addFields({ name: "Status", value: "You don't have any roles assigned.", inline: false })
        .setFooter({ text: "BoostMon • Server URLs" });

      return interaction.editReply({ embeds: [embed] });
    }

    // Fetch URLs for user's roles
    const urls = await db.getUserServerUrls(guild.id, userRoleIds);

    if (urls.length === 0) {
      const embed = new EmbedBuilder()
        .setColor(0x95A5A6)
        .setAuthor({ name: "BoostMon", iconURL: BOOSTMON_ICON_URL })
        .setTitle("🔗 Your Server URLs")
        .setTimestamp(new Date())
        .addFields({
          name: "Status",
          value: "None of your roles have server URLs assigned.",
          inline: false,
        })
        .setFooter({ text: "BoostMon • Server URLs" });

      return interaction.editReply({ embeds: [embed] });
    }

    // Build embeds and buttons for each URL
    const embeds = [];
    const rows = [];

    urls.forEach((urlEntry, index) => {
      const role = guild.roles.cache.get(urlEntry.role_id);
      const roleName = role ? role.name : `Unknown Role (${urlEntry.role_id})`;

      const embed = new EmbedBuilder()
        .setColor(0x3498DB)
        .setAuthor({ name: "BoostMon", iconURL: BOOSTMON_ICON_URL })
        .setTitle(`🔗 ${roleName} Server URL`)
        .setTimestamp(new Date())
        .addFields(
          { name: "Role", value: role ? `${role}` : roleName, inline: true },
          {
            name: "Last Updated",
            value: `<t:${Math.floor(new Date(urlEntry.updated_at).getTime() / 1000)}:R>`,
            inline: true,
          }
        )
        .setFooter({ text: "BoostMon • Server URLs" });

      embeds.push(embed);

      // Create button for this URL
      const button = new ButtonBuilder()
        .setLabel(`Open ${roleName} URL`)
        .setURL(urlEntry.url)
        .setStyle(ButtonStyle.Link);

      const row = new ActionRowBuilder().addComponents(button);
      rows.push(row);
    });

    // Send all embeds with their corresponding buttons
    const response = { embeds };
    if (rows.length > 0) {
      response.components = rows;
    }

    return interaction.editReply(response);
  }
};
