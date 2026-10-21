import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow, dialog, Menu, safeStorage, session, shell } from "electron";
import { createFolderStore, type FolderStore } from "./folder";
import { buildMenu, harden } from "./hardening";
import { handleLauncher, handleTool, setLauncher } from "./ipc";
import { fetchPublic } from "./net-guard";
import { preload } from "./paths";
import { handleProtocol, registerScheme } from "./protocol";
import { createSecretStore } from "./secrets";
import { createSettings } from "./settings";
import {
  allTools,
  getTool,
  listTools,
  loadTools,
  ownerOf,
  startTool,
  stopAll,
  stopAndWait,
  stopTool,
  type Tool,
} from "./tools";
import { createTray, destroyTray } from "./tray";
import { createUpdater } from "./updater";

// Also appId in electron-builder.yml: the id of the installer's shortcuts, so taskbar pins, notifications and the
// "start with Windows" entry all belong to the installed app.
const APP_ID = "com.streammyevent.producers-toolbox";
// File that tells the NSIS uninstaller to delete the user-data folder too (see build/installer.nsh).
const DELETE_DATA_MARKER = ".delete-on-uninstall";
const MAX_CALL_ARGS = 8;

app.setName("Producers Toolbox");
// Lets tests keep all data in a throwaway folder instead of the user's profile. Never in the installed app.
if (!app.isPackaged && process.env.PRODUCERS_TOOLBOX_DATA_DIR) {
  const base = path.resolve(process.env.PRODUCERS_TOOLBOX_DATA_DIR);
  app.setPath("userData", path.join(base, "user"));
  app.setPath("documents", path.join(base, "documents"));
} else if (app.isPackaged) {
  // Fixed location, so the NSIS uninstaller knows which folder "also delete my data" means.
  app.setPath("userData", path.join(app.getPath("appData"), "Producers Toolbox"));
}
if (app.isPackaged && process.platform === "win32") app.setAppUserModelId(APP_ID);
app.enableSandbox();
registerScheme();

let launcher: BrowserWindow | null = null;
let quitting = false;

const userData = (...parts: string[]) => path.join(app.getPath("userData"), ...parts);
const settings = createSettings({ file: userData("settings.json") });
const secrets = createSecretStore({ dir: userData("secrets"), safeStorage });
const folders = new Map<string, FolderStore>();
const updater = createUpdater({ send: (status) => send("updates:status", status) });

function send(channel: string, payload: unknown): void {
  if (launcher && !launcher.isDestroyed()) launcher.webContents.send(channel, payload);
}

const notify = () => send("tools:changed", listTools(settings.get().hiddenTools));

function showLauncher(): void {
  if (!launcher || launcher.isDestroyed()) return createLauncher();
  if (launcher.isMinimized()) launcher.restore();
  launcher.show();
  launcher.focus();
}

function quitApp(): void {
  quitting = true;
  app.quit();
}

/** Settings that live outside the launcher window: login item and tray icon. */
function applySystemSettings(): void {
  const s = settings.get();
  // The setting is "Start with Windows"; on macOS the user adds login items in System Settings
  if (app.isPackaged && process.platform === "win32") app.setLoginItemSettings({ openAtLogin: s.startWithWindows });
  if (s.minimizeToTray) createTray({ onShow: showLauncher, onQuit: quitApp });
  else destroyTray();
}

function folderOf(tool: Tool): FolderStore {
  const store = folders.get(tool.id);
  if (!store) throw new Error("This tool has no folder");
  return store;
}

function contextFor(tool: Tool): ToolContext {
  return {
    toolId: tool.id,
    dataDir: userData("tools", tool.id),
    documentsDir: path.join(app.getPath("documents"), "Producers Toolbox"),
    folder: folders.get(tool.id) ?? null,
    secrets: { get: (name) => secrets.get(tool, name), set: (name, value) => secrets.set(tool, name, value) },
    net: { fetchPublic: (url, options) => fetchPublic(url, options) },
  };
}

/** Everything a tool stored: its data folder (incl. folder choice), its secrets and its page storage. */
async function deleteToolData(id: string): Promise<void> {
  fs.rmSync(userData("tools", id), { recursive: true, force: true });
  fs.rmSync(userData("secrets", `${id}.json`), { force: true });
  await session.defaultSession.clearStorageData({ origin: `app://${id}` });
}

async function hideTool(id: string) {
  const tool = getTool(id);
  if (!tool || !launcher) return { ok: false, error: "Unknown tool" };
  const { response, checkboxChecked } = await dialog.showMessageBox(launcher, {
    type: "warning",
    title: "Remove tool",
    message: `Remove "${tool.name}"?`,
    detail: "This tool comes with the Toolbox, so it is hidden rather than deleted. You can show it again in Settings.",
    checkboxLabel: "Also delete saved data (settings, files and keys this tool stored)",
    checkboxChecked: false,
    buttons: ["Remove", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  });
  if (response !== 0) return { ok: false, canceled: true };
  await stopAndWait(id);
  try {
    const s = settings.get();
    settings.set({ hiddenTools: [...s.hiddenTools, id], pinnedTools: s.pinnedTools.filter((p) => p !== id) });
    if (checkboxChecked) await deleteToolData(id);
  } catch (err) {
    const detail = (err as Error).message;
    await dialog.showMessageBox(launcher, {
      type: "error",
      title: "Remove tool",
      message: "The tool could not be removed.",
      detail,
    });
    return { ok: false, error: detail };
  }
  notify();
  return { ok: true, deletedData: checkboxChecked };
}

/** Runs the NSIS uninstaller and quits. Only the installed Windows app has one. */
async function uninstallToolbox() {
  if (!launcher) return { ok: false };
  const uninstaller = path.join(path.dirname(process.execPath), `Uninstall ${app.getName()}.exe`);
  if (!app.isPackaged || process.platform !== "win32" || !fs.existsSync(uninstaller)) {
    await dialog.showMessageBox(launcher, {
      type: "info",
      title: "Uninstall Toolbox",
      message: "Uninstall is only available in the installed Windows app.",
      detail:
        process.platform === "darwin"
          ? "Move Producers Toolbox from Applications to the Trash."
          : "Remove Producers Toolbox from Windows Settings > Apps instead.",
    });
    return { ok: false, unsupported: true };
  }
  const { response, checkboxChecked } = await dialog.showMessageBox(launcher, {
    type: "warning",
    title: "Uninstall Toolbox",
    message: "Uninstall Producers Toolbox?",
    detail: "The Toolbox will close and the Windows uninstaller will start.",
    checkboxLabel: "Also delete my data (settings and saved tool data)",
    checkboxChecked: false,
    buttons: ["Uninstall", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  });
  if (response !== 0) return { ok: false, canceled: true };
  const marker = userData(DELETE_DATA_MARKER);
  if (checkboxChecked) fs.writeFileSync(marker, "");
  else fs.rmSync(marker, { force: true });
  spawn(uninstaller, [], { detached: true, stdio: "ignore" }).unref();
  quitApp();
  return { ok: true };
}

function createLauncher(): void {
  const win = new BrowserWindow({
    width: 960,
    height: 640,
    minWidth: 640,
    minHeight: 420,
    title: "Producers Toolbox",
    autoHideMenuBar: true,
    webPreferences: {
      preload: preload("launcher-preload"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !app.isPackaged,
      spellcheck: false,
    },
  });
  launcher = win;
  setLauncher(win.webContents);
  win.loadURL("app://shell/index.html");
  win.on("close", (e) => {
    if (!quitting && settings.get().minimizeToTray) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on("closed", () => {
    launcher = null;
    setLauncher(null);
    stopAll();
  });
}

function registerToolHandlers(): void {
  handleTool("tool:close", (tool) => stopTool(tool.id));

  handleTool("secrets:getAll", (tool) => secrets.getAll(tool));
  handleTool("secrets:set", (tool, name, value) => secrets.set(tool, name, value));
  handleTool("secrets:remove", (tool, name) => secrets.remove(tool, name));

  handleTool("folder:get", (tool) => folderOf(tool).status());
  handleTool("folder:choose", (tool) => folderOf(tool).choose(BrowserWindow.getFocusedWindow()));
  handleTool("folder:clear", (tool) => folderOf(tool).clear());
  handleTool("folder:write", (tool, name, content) => folderOf(tool).write(name, content));
  handleTool("folder:read", (tool, name) => folderOf(tool).read(name));
  handleTool("folder:list", (tool) => folderOf(tool).list());
  handleTool("folder:reveal", (tool, name) => folderOf(tool).reveal(name));

  handleTool("tool:call", (tool, method, args) => {
    if (typeof method !== "string" || !tool.api || !Object.hasOwn(tool.api, method)) {
      throw new Error(`Unknown method: ${String(method).slice(0, 100)}`);
    }
    if (!Array.isArray(args) || args.length > MAX_CALL_ARGS) throw new Error("Invalid arguments");
    return tool.api[method](contextFor(tool), ...args);
  });
}

function registerLauncherHandlers(): void {
  handleLauncher("launcher:list-tools", () => listTools(settings.get().hiddenTools));
  handleLauncher("launcher:start-tool", (id) => startTool(String(id), notify));
  handleLauncher("launcher:stop-tool", (id) => stopTool(String(id)));
  handleLauncher("launcher:remove-tool", (id) => hideTool(String(id)));
  handleLauncher("settings:get", () => settings.get());
  handleLauncher("settings:set", (patch) => {
    const next = settings.set(patch);
    applySystemSettings();
    notify(); // hidden tools may have changed
    return next;
  });
  handleLauncher("app:info", () => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    packaged: app.isPackaged,
    platform: process.platform,
  }));
  handleLauncher("app:uninstall", () => uninstallToolbox());
  handleLauncher("app:quit", () => quitApp());
  handleLauncher("updates:status", () => updater.status());
  handleLauncher("updates:check", () => updater.check());
  handleLauncher("updates:restart", () => updater.restart());
}

// One app at a time; a second start just focuses the first.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => showLauncher());
  app.on("before-quit", () => {
    quitting = true;
  });
  app.on("window-all-closed", () => app.quit());

  app.whenReady().then(() => {
    loadTools();
    for (const tool of allTools()) {
      secrets.purge(tool);
      if (tool.folder) {
        folders.set(
          tool.id,
          createFolderStore({
            configPath: userData("tools", tool.id, "folder.json"),
            policy: tool.folder,
            defaultPath: () => app.getPath("documents"),
            dialog,
            shell,
          }),
        );
      }
    }
    // The app is running again, so an earlier "Uninstall Toolbox" was cancelled: forget its "also delete my data"
    // choice, or a later uninstall from Windows Settings would wipe the data.
    fs.rmSync(userData(DELETE_DATA_MARKER), { force: true });

    harden({ ownerOf });
    handleProtocol();
    Menu.setApplicationMenu(buildMenu());
    registerToolHandlers();
    registerLauncherHandlers();
    updater.startAuto(() => settings.get().autoCheckUpdates);
    applySystemSettings();
    createLauncher();
  });
}
