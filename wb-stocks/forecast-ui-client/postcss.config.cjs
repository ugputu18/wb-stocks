const path = require("node:path");

module.exports = {
  plugins: {
    "@pandacss/dev/postcss": {
      configPath: path.join(__dirname, "panda.config.ts"),
    },
  },
};
