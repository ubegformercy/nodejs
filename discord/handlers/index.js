// discord/handlers/index.js — Command handler router map
const handlers = {
  timer:      require("./timer"),
  autopurge:  require("./autopurge"),
  setup:      require("./setup"),
  queue:      require("./boostqueue"),
  register:   require("./register"),
  streak:     require("./streak"),
  url:        require("./url"),
};

module.exports = handlers;
