const path = require("path");
const { app } = require("electron");

// Tools live in the repo's tools/ folder; packaged builds copy them to resources/tools.
const toolsDir = () =>
  app.isPackaged ? path.join(process.resourcesPath, "tools") : path.join(__dirname, "..", "..", "..", "..", "tools");

const rendererDir = () => path.join(__dirname, "..", "renderer");

module.exports = { toolsDir, rendererDir };
