const { contextBridge, ipcRenderer } = require("electron");

// Tool-facing API. The tool-sdk (storage, export, fetch) grows here.
const toolId = (process.argv.find((a) => a.startsWith("--tool-id=")) || "").slice("--tool-id=".length);

// Encrypted storage for API keys and tokens (OS keychain, this machine and user only).
// Synchronous on purpose: the tools read their settings synchronously at startup.
const secrets = {
  available: () => ipcRenderer.sendSync("secrets:available") === true,
  get: (name) => ipcRenderer.sendSync("secrets:get", String(name)),
  set: (name, value) => ipcRenderer.sendSync("secrets:set", String(name), String(value)) === true,
  remove: (name) => {
    ipcRenderer.sendSync("secrets:remove", String(name));
  },
};

contextBridge.exposeInMainWorld("producersToolbox", { toolId, platform: process.platform, secrets });
