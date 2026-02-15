// discord/commands.js — All SlashCommandBuilder definitions (7 consolidated commands)
const { SlashCommandBuilder, ChannelType } = require("discord.js");

function getCommands() {
  return [
    // ── /timer (consolidates settime, addtime, removetime, cleartime, pausetime, resumetime, showtime) ──
    new SlashCommandBuilder()
      .setName("timer")
      .setDescription("Manage timed roles for users.")
      .addSubcommand((s) =>
        s
          .setName("set")
          .setDescription("Set a user's timed role time to exactly N minutes from now and assign the role.")
          .addUserOption((o) => o.setName("user").setDescription("User to set time for").setRequired(true))
          .addIntegerOption((o) =>
            o.setName("minutes").setDescription("Minutes to set").setRequired(true).setMinValue(1)
          )
          .addRoleOption((o) => o.setName("role").setDescription("Role to grant").setRequired(true))
          .addChannelOption((o) =>
            o
              .setName("channel")
              .setDescription("Where expiry warnings should be sent (optional). If omitted, warnings are DMed.")
              .setRequired(false)
              .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          )
      )
      .addSubcommand((s) =>
        s
          .setName("add")
          .setDescription("Add minutes to a user's timed role and assign the role.")
          .addUserOption((o) => o.setName("user").setDescription("User to add time to").setRequired(true))
          .addIntegerOption((o) =>
            o.setName("minutes").setDescription("Minutes to add").setRequired(true).setMinValue(1)
          )
          .addRoleOption((o) => o.setName("role").setDescription("Role to add time to (optional)").setRequired(false))
      )
      .addSubcommand((s) =>
        s
          .setName("remove")
          .setDescription("Remove minutes from a user's timed role.")
          .addUserOption((o) => o.setName("user").setDescription("User to modify").setRequired(true))
          .addIntegerOption((o) =>
            o.setName("minutes").setDescription("Minutes to remove").setRequired(true).setMinValue(1)
          )
          .addRoleOption((o) => o.setName("role").setDescription("Role to remove time from (optional)").setRequired(false))
      )
      .addSubcommand((s) =>
        s
          .setName("clear")
          .setDescription("Clear a user's timed role timer and remove the role.")
          .addUserOption((o) => o.setName("user").setDescription("User to clear").setRequired(true))
          .addRoleOption((o) => o.setName("role").setDescription("Role to clear (optional)").setRequired(false))
      )
      .addSubcommand((s) =>
        s
          .setName("pause")
          .setDescription("Pause a user's timed role timer (stops countdown until resumed).")
          .addUserOption((o) => o.setName("user").setDescription("User to pause").setRequired(true))
          .addRoleOption((o) => o.setName("role").setDescription("Role to pause (optional)").setRequired(false))
      )
      .addSubcommand((s) =>
        s
          .setName("resume")
          .setDescription("Resume a paused timed role (continues from where it was paused).")
          .addUserOption((o) => o.setName("user").setDescription("User to resume").setRequired(true))
          .addRoleOption((o) => o.setName("role").setDescription("Role to resume").setRequired(true))
      )
      .addSubcommand((s) =>
        s
          .setName("show")
          .setDescription("Show remaining timed role time for a user (and optional role).")
          .addUserOption((o) => o.setName("user").setDescription("User to check (default: you)").setRequired(false))
          .addRoleOption((o) => o.setName("role").setDescription("Role to check (optional)").setRequired(false))
      ),

    // ── /rolestatus (unchanged) ──
    new SlashCommandBuilder()
      .setName("rolestatus")
      .setDescription("View role members or manage automated role status reports.")
      .addSubcommand((s) =>
        s
          .setName("view")
          .setDescription("Show all users with a specific role and their remaining times.")
          .addRoleOption((o) => o.setName("role").setDescription("Role to check").setRequired(true))
      )
      .addSubcommandGroup((g) =>
        g
          .setName("schedule")
          .setDescription("Manage automated role status reports")
          .addSubcommand((s) =>
            s
              .setName("set")
              .setDescription("Start automatic role status reports")
              .addRoleOption((o) => o.setName("role").setDescription("Role to monitor").setRequired(true))
              .addChannelOption((o) => o.setName("channel").setDescription("Channel to post reports").setRequired(true))
              .addIntegerOption((o) =>
                o
                  .setName("interval")
                  .setDescription("Minutes between reports")
                  .setRequired(true)
                  .setMinValue(1)
              )
              .addIntegerOption((o) =>
                o
                  .setName("purge")
                  .setDescription("Lines to purge before posting (0-100, optional)")
                  .setRequired(false)
                  .setMinValue(0)
                  .setMaxValue(100)
              )
          )
          .addSubcommand((s) =>
            s
              .setName("disable")
              .setDescription("Stop automated reports for a role")
              .addRoleOption((o) => o.setName("role").setDescription("Role to stop monitoring").setRequired(true))
          )
          .addSubcommand((s) =>
            s
              .setName("list")
              .setDescription("Show all active automated role status reports in this server")
          )
      ),

    // ── /autopurge (unchanged) ──
    new SlashCommandBuilder()
      .setName("autopurge")
      .setDescription("Automatically purge bot or user messages from a channel at set intervals.")
      .addSubcommand((s) =>
        s
          .setName("set")
          .setDescription("Set up auto-purge for a channel")
          .addChannelOption((o) => o.setName("channel").setDescription("Channel to auto-purge").setRequired(true))
          .addStringOption((o) =>
            o
              .setName("type")
              .setDescription("Message type to purge")
              .setRequired(true)
              .addChoices(
                { name: "Bot messages only", value: "bot" },
                { name: "User messages only", value: "user" },
                { name: "Both bot and user messages", value: "both" }
              )
          )
          .addIntegerOption((o) =>
            o
              .setName("lines")
              .setDescription("Number of messages to purge per interval (1-100)")
              .setRequired(true)
              .setMinValue(1)
              .setMaxValue(100)
          )
          .addIntegerOption((o) =>
            o
              .setName("interval")
              .setDescription("Minutes between purges (15-10080)")
              .setRequired(true)
              .setMinValue(15)
              .setMaxValue(10080)
          )
      )
      .addSubcommand((s) =>
        s
          .setName("disable")
          .setDescription("Disable auto-purge for a channel")
          .addChannelOption((o) => o.setName("channel").setDescription("Channel to disable").setRequired(true))
      )
      .addSubcommand((s) =>
        s
          .setName("status")
          .setDescription("Show all auto-purge settings in this server")
      ),

    // ── /setup (reports, streak-roles, streak-leaderboard-size — dashboard access removed) ──
    new SlashCommandBuilder()
      .setName("setup")
      .setDescription("Configure server settings for BoostMon.")
      .addSubcommand((s) =>
        s
          .setName("reports")
          .setDescription("Configure leaderboard report settings for this server")
          .addStringOption((o) =>
            o
              .setName("filter")
              .setDescription("Sort order for leaderboard reports")
              .setRequired(true)
              .addChoices(
                { name: "🔼 Ascending (expires soonest first)", value: "ascending" },
                { name: "🔽 Descending (expires latest first)", value: "descending" }
              )
          )
      )
      .addSubcommand((s) =>
        s
          .setName("streak-roles")
          .setDescription("Configure roles for streak thresholds")
          .addIntegerOption((o) =>
            o.setName("days")
              .setDescription("Day threshold for the role (e.g., 3, 7, 14, 30, 60, 90)")
              .setRequired(true)
              .setMinValue(1)
          )
          .addRoleOption((o) =>
            o.setName("role")
              .setDescription("Role to assign at this threshold")
              .setRequired(true)
          )
          .addStringOption((o) =>
            o.setName("action")
              .setDescription("Add or remove this threshold")
              .setRequired(false)
              .addChoices(
                { name: "Add/Update", value: "add" },
                { name: "Remove", value: "remove" }
              )
          )
      )
      .addSubcommand((s) =>
        s
          .setName("streak-leaderboard-size")
          .setDescription("Set how many members to show on the streak leaderboard")
          .addIntegerOption((o) =>
            o.setName("size")
              .setDescription("Number of members to display (1-50)")
              .setRequired(true)
              .setMinValue(1)
              .setMaxValue(50)
          )
      ),

    // ── /streak (status, leaderboard, admin grant-save/remove-save/set — list-size moved to /setup) ──
    new SlashCommandBuilder()
      .setName("streak")
      .setDescription("View or manage boost streaks")
      .addSubcommand((s) =>
        s.setName("status")
          .setDescription("View your current streak status or another user's")
          .addUserOption((o) => o.setName("user").setDescription("User to check (default: you)").setRequired(false))
      )
      .addSubcommand((s) =>
        s.setName("leaderboard")
          .setDescription("View the longest boost streaks in the server")
      )
      .addSubcommandGroup((g) =>
        g.setName("admin")
          .setDescription("Admin streak management")
          .addSubcommand((s) =>
            s.setName("grant-save")
              .setDescription("Grant a streak save token to a user")
              .addUserOption((o) => o.setName("user").setDescription("User to grant save to").setRequired(true))
              .addIntegerOption((o) => o.setName("amount").setDescription("Number of saves (default: 1)").setRequired(false).setMinValue(1))
          )
          .addSubcommand((s) =>
            s.setName("remove-save")
              .setDescription("Remove a streak save token from a user")
              .addUserOption((o) => o.setName("user").setDescription("User to remove save from").setRequired(true))
              .addIntegerOption((o) => o.setName("amount").setDescription("Number of saves (default: 1)").setRequired(false).setMinValue(1))
          )
          .addSubcommand((s) =>
            s.setName("set")
              .setDescription("Set a user's streak to a specific number of days")
              .addUserOption((o) => o.setName("user").setDescription("User to set streak for").setRequired(true))
              .addIntegerOption((o) => o.setName("days").setDescription("Number of streak days to set").setRequired(true).setMinValue(0))
          )
      ),

    // ── /boostqueue (unchanged) ──
    new SlashCommandBuilder()
      .setName("boostqueue")
      .setDescription("Manage the boost queue for users waiting for boosts.")
      .addSubcommand((s) =>
        s
          .setName("add")
          .setDescription("Add a user to the boost queue (admin can add others)")
          .addStringOption((o) =>
            o.setName("note").setDescription("Optional note or reason (max 255 chars)").setRequired(false)
          )
          .addUserOption((o) =>
            o.setName("user").setDescription("User to add (optional, defaults to you)").setRequired(false)
          )
      )
      .addSubcommand((s) =>
        s
          .setName("remove")
          .setDescription("Remove yourself or someone else from the queue (admin only for others)")
          .addUserOption((o) =>
            o.setName("user").setDescription("User to remove (optional, defaults to you)").setRequired(false)
          )
      )
      .addSubcommand((s) =>
        s
          .setName("view")
          .setDescription("View the entire boost queue")
      )
      .addSubcommand((s) =>
        s
          .setName("status")
          .setDescription("Check your position in the boost queue")
      )
      .addSubcommand((s) =>
        s
          .setName("complete")
          .setDescription("Mark a user as completed (admin only)")
          .addUserOption((o) =>
            o.setName("user").setDescription("User who received their boost").setRequired(true)
          )
      ),

    // ── /register (merged: flat command with optional user param) ──
    new SlashCommandBuilder()
      .setName("register")
      .setDescription("Register yourself (or another user) with in-game info")
      .addStringOption((o) =>
        o.setName("username").setDescription("In-game username").setRequired(true)
      )
      .addStringOption((o) =>
        o.setName("display").setDescription("Display name").setRequired(true)
      )
      .addUserOption((o) =>
        o.setName("user").setDescription("User to register (admin only, defaults to yourself)").setRequired(false)
      ),
  ];
}

module.exports = { getCommands };
