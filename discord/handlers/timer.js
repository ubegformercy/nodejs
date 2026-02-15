// discord/handlers/timer.js — /timer command handler (routes subcommands to existing handlers)
const handleSettime = require("./settime");
const handleAddtime = require("./addtime");
const handleRemovetime = require("./removetime");
const handleCleartime = require("./cleartime");
const handlePausetime = require("./pausetime");
const handleResumetime = require("./resumetime");
const handleShowtime = require("./showtime");

const subcommandMap = {
  set:    handleSettime,
  add:    handleAddtime,
  remove: handleRemovetime,
  clear:  handleCleartime,
  pause:  handlePausetime,
  resume: handleResumetime,
  show:   handleShowtime,
};

module.exports = async function handleTimer(interaction) {
  const subcommand = interaction.options.getSubcommand();
  const handler = subcommandMap[subcommand];

  if (!handler) {
    return interaction.reply({ content: `Unknown timer subcommand: ${subcommand}`, ephemeral: true });
  }

  return handler(interaction);
};
