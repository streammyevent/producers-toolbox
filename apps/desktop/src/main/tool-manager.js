const fs = require("fs");
const path = require("path");
const { BrowserWindow, shell } = require("electron");
const { toolsDir } = require("./paths");
const { readManifest } = require("./tool-manifest");

const windows = new Map(); // tool id -> BrowserWindow
let tools = new Map(); // tool id -> manifest + dir

// Every tool ships with the app, in the built-in tools folder (read-only once packaged).
function loadTools() {
  const found = new Map();
  const root = toolsDir();
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const dir = path.join(root, entry.name);
    if (!fs.existsSync(path.join(dir, "tool.json"))) continue;
    try {
      const m = readManifest(dir, { folderName: entry.name });
      found.set(m.id, { ...m, dir, builtIn: true, permissions: m.permissions || [] });
    } catch (err) {
      console.warn(`[tools] skipped ${entry.name}: ${err.message}`);
    }
  }
  tools = found;
  return tools;
}

const getTool = (id) => tools.get(id);
const all = () => [...tools.values()];

// Launcher view of the tools; hidden ones are left out.
function list({ hidden = [] } = {}) {
  const skip = new Set(hidden);
  return [...tools.values()]
    .filter((t) => !skip.has(t.id))
    .map((t) => ({
      id: t.id,
      name: t.name,
      version: t.version,
      builtIn: t.builtIn,
      running: windows.has(t.id),
      icon: t.icon ? `app://${t.id}/${t.icon}` : null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function start(id, onChange) {
  const tool = tools.get(id);
  if (!tool) throw new Error(`Unknown tool: ${id}`);
  const existing = windows.get(id);
  if (existing) {
    if (existing.isMinimized()) existing.restore();
    existing.focus();
    return;
  }
  const win = new BrowserWindow({
    width: tool.window?.width || 1280,
    height: tool.window?.height || 860,
    title: tool.name,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "tool-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [`--tool-id=${id}`],
    },
  });
  windows.set(id, win);
  win.on("closed", () => {
    windows.delete(id);
    onChange();
  });
  // Links to other sites open in the system browser, never inside a tool window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(`app://${id}/`)) {
      e.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });
  win.loadURL(`app://${id}/${tool.entry}`);
  onChange();
}

function stop(id) {
  const win = windows.get(id);
  if (win) win.close();
}

// Close a tool's window and wait until it is gone (before deleting its data).
function stopAndWait(id) {
  const win = windows.get(id);
  if (!win || win.isDestroyed()) return Promise.resolve();
  return new Promise((resolve) => {
    win.once("closed", resolve);
    win.destroy();
  });
}

function stopAll() {
  for (const win of windows.values()) win.close();
}

module.exports = { loadTools, getTool, all, list, start, stop, stopAndWait, stopAll };
