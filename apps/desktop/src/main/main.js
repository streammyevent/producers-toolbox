const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { app, BrowserWindow, dialog, ipcMain, safeStorage, session } = require("electron");
const { registerScheme, handleProtocol } = require("./protocol");
const tools = require("./tool-manager");
const { createSecretStore } = require("./secrets");
const { createSettings } = require("./settings");
const { createTray, destroyTray } = require("./tray");
const { createUpdater } = require("./updater");

const APP_ID = "com.streammyevent.producers-toolbox";

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
// Same id as the installer's shortcuts (electron-builder.yml appId), so taskbar pins, notifications
// and the "start with Windows" Run entry all belong to the installed app.
if (app.isPackaged && process.platform === "win32") app.setAppUserModelId(APP_ID);
registerScheme();

let launcher = null;
let settings = null;
let updater = null;
let quitting = false;

// File that tells the NSIS uninstaller to delete the user-data folder too (see build/installer.nsh).
const DELETE_DATA_MARKER = ".delete-on-uninstall";

const showLauncher = () => {
  if (!launcher || launcher.isDestroyed()) return createLauncher();
  if (launcher.isMinimized()) launcher.restore();
  launcher.show();
  launcher.focus();
};

const quitApp = () => {
  quitting = true;
  app.quit();
};

// Apply settings that live outside the launcher window: login item and tray icon.
function applySystemSettings() {
  const s = settings.get();
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: s.startWithWindows });
  if (s.minimizeToTray) createTray({ onShow: showLauncher, onQuit: quitApp });
  else destroyTray();
}

const listTools = () => tools.list({ hidden: settings ? settings.get().hiddenTools : [] });
const send = (channel, payload) => {
  if (launcher && !launcher.isDestroyed()) launcher.webContents.send(channel, payload);
};
const notify = () => send("tools:changed", listTools());
const reloadTools = () => {
  tools.loadTools();
  notify();
};

// Everything a tool stored: its data folder, its secrets and its page storage (localStorage etc.).
async function deleteToolData(id) {
  const userData = app.getPath("userData");
  fs.rmSync(path.join(userData, "tools", id), { recursive: true, force: true });
  fs.rmSync(path.join(userData, "secrets", `${id}.json`), { force: true });
  await session.defaultSession.clearStorageData({ origin: `app://${id}` });
}

async function removeTool(id) {
  const tool = tools.getTool(id);
  if (!tool) return { ok: false, error: "Unknown tool" };
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
  await tools.stopAndWait(id);
  try {
    settings.set({ hiddenTools: [...settings.get().hiddenTools, id] });
    if (checkboxChecked) await deleteToolData(id);
  } catch (err) {
    await dialog.showMessageBox(launcher, {
      type: "error",
      title: "Remove tool",
      message: "The tool could not be removed.",
      detail: err.message,
    });
    return { ok: false, error: err.message };
  }
  settings.set({ pinnedTools: settings.get().pinnedTools.filter((p) => p !== id) });
  reloadTools();
  return { ok: true, deletedData: checkboxChecked };
}

// Runs the NSIS uninstaller and quits. Only the installed app has one.
async function uninstallToolbox() {
  if (!app.isPackaged) {
    await dialog.showMessageBox(launcher, {
      type: "info",
      title: "Uninstall Toolbox",
      message: "Uninstall is only available in the installed app.",
      detail: "This copy runs from source (development mode). To remove it, delete the project folder.",
    });
    return { ok: false, unsupported: true };
  }
  const uninstaller = path.join(path.dirname(process.execPath), `Uninstall ${app.getName()}.exe`);
  if (!fs.existsSync(uninstaller)) {
    await dialog.showMessageBox(launcher, {
      type: "error",
      title: "Uninstall Toolbox",
      message: "The uninstaller was not found.",
      detail: "Remove Producers Toolbox from Windows Settings > Apps instead.",
    });
    return { ok: false, error: "not found" };
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
  const marker = path.join(app.getPath("userData"), DELETE_DATA_MARKER);
  if (checkboxChecked) fs.writeFileSync(marker, "");
  else fs.rmSync(marker, { force: true });
  spawn(uninstaller, [], { detached: true, stdio: "ignore" }).unref();
  quitApp();
  return { ok: true };
}

function createLauncher() {
  launcher = new BrowserWindow({
    width: 960,
    height: 640,
    minWidth: 640,
    minHeight: 420,
    title: "Producers Toolbox",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "launcher-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  launcher.loadURL("app://shell/index.html");
  launcher.on("close", (e) => {
    if (!quitting && settings && settings.get().minimizeToTray) {
      e.preventDefault();
      launcher.hide();
    }
  });
  launcher.on("closed", () => {
    launcher = null;
    tools.stopAll();
  });
}

// One launcher at a time; a second start just focuses the first.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (launcher) showLauncher();
  });
  app.on("before-quit", () => {
    quitting = true;
  });

  // The calling tool is taken from the page's own app:// origin, never from what the page claims.
  // Only a tool's top-level page may use its secrets.
  function secretsOwner(e) {
    if (e.senderFrame !== e.sender.mainFrame) return null;
    try {
      const url = new URL(e.senderFrame.url);
      return url.protocol === "app:" && tools.getTool(url.hostname) ? url.hostname : null;
    } catch {
      return null;
    }
  }

  app.whenReady().then(() => {
    tools.loadTools();
    handleProtocol();
    // The app is running again, so an earlier "Uninstall Toolbox" was cancelled: forget its
    // "also delete my data" choice, or a later uninstall from Windows Settings would wipe the data.
    fs.rmSync(path.join(app.getPath("userData"), DELETE_DATA_MARKER), { force: true });
    const secrets = createSecretStore({
      dir: path.join(app.getPath("userData"), "secrets"),
      safeStorage,
    });
    const secretCall =
      (fn) =>
      (e, ...args) => {
        const owner = secretsOwner(e);
        try {
          e.returnValue = owner ? fn(owner, ...args.map(String)) : null;
        } catch {
          e.returnValue = null;
        }
      };
    ipcMain.on("secrets:available", (e) => {
      e.returnValue = secretsOwner(e) ? secrets.available() : false;
    });
    ipcMain.on(
      "secrets:get",
      secretCall((id, name) => secrets.get(id, name)),
    );
    ipcMain.on(
      "secrets:set",
      secretCall((id, name, value) => secrets.set(id, name, value)),
    );
    ipcMain.on(
      "secrets:remove",
      secretCall((id, name) => {
        secrets.remove(id, name);
        return true;
      }),
    );
    ipcMain.handle("tools:list", () => listTools());
    ipcMain.handle("tools:remove", (_e, id) => removeTool(String(id)));
    ipcMain.handle("tools:start", (_e, id) => tools.start(String(id), notify));
    ipcMain.handle("tools:stop", (_e, id) => tools.stop(String(id)));
    settings = createSettings({ file: path.join(app.getPath("userData"), "settings.json") });
    ipcMain.handle("settings:get", () => settings.get());
    ipcMain.handle("settings:set", (_e, patch) => {
      const next = settings.set(patch);
      applySystemSettings();
      notify(); // hidden tools may have changed
      return next;
    });
    ipcMain.handle("app:info", () => ({
      name: app.getName(),
      version: app.getVersion(),
      electron: process.versions.electron,
      packaged: app.isPackaged,
    }));
    ipcMain.handle("app:uninstall", () => uninstallToolbox());
    updater = createUpdater({ send: (s) => send("updates:status", s) });
    ipcMain.handle("updates:status", () => updater.status());
    ipcMain.handle("updates:check", () => updater.check());
    ipcMain.handle("updates:restart", () => updater.restart());
    updater.startAuto(() => settings.get());
    ipcMain.handle("app:quit", () => quitApp());
    applySystemSettings();
    createLauncher();
  });

  app.on("window-all-closed", () => app.quit());
}
