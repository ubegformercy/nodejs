// discord/handlers/index.js — Command handler router map
const handlers = {
  timer:      require("./timer"),
  autopurge:  require("./autopurge"),
  setup:      require("./setup"),
  boostqueue: require("./boostqueue"),
  register:   require("./register"),
  streak:     require("./streak"),
};

module.exports = handlers;
