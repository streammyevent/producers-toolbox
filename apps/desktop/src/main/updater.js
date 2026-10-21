const fs = require("fs");
const path = require("path");
const { app } = require("electron");

const AUTO_DELAY = 10 * 1000;
const AUTO_EVERY = 6 * 60 * 60 * 1000;

// Toolbox updates come from GitHub Releases through electron-updater, only in the installed app.
// Tools ship inside the app, so they update with it. Status is pushed to the launcher as 'updates:status'.
function createUpdater({ send }) {
  // The installer ships app-update.yml (the GitHub feed); an unpacked --dir build has none.
  const hasFeed = app.isPackaged && fs.existsSync(path.join(process.resourcesPath, "app-update.yml"));
  const status = {
    app: hasFeed ? { state: "idle" } : { state: "unsupported", packaged: app.isPackaged },
    checkedAt: null,
  };
  let autoUpdater = null;
  let checking = null;

  const push = () => send(getStatus());
  const setApp = (s) => {
    status.app = s;
    push();
  };

  if (hasFeed) {
    ({ autoUpdater } = require("electron-updater"));
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on("checking-for-update", () => setApp({ state: "checking" }));
    autoUpdater.on("update-available", (i) => setApp({ state: "downloading", version: i.version, percent: 0 }));
    autoUpdater.on("update-not-available", () => setApp({ state: "up-to-date", version: app.getVersion() }));
    autoUpdater.on("download-progress", (p) =>
      setApp({ ...status.app, state: "downloading", percent: Math.round(p.percent || 0) }),
    );
    autoUpdater.on("update-downloaded", (i) => setApp({ state: "downloaded", version: i.version }));
    autoUpdater.on("error", (err) =>
      setApp({ state: "error", message: String(err && err.message ? err.message : err).split("\n")[0] }),
    );
  }

  function check() {
    if (checking) return checking;
    checking = (async () => {
      if (autoUpdater && status.app.state !== "downloading" && status.app.state !== "downloaded") {
        try {
          await autoUpdater.checkForUpdates();
        } catch (err) {
          setApp({ state: "error", message: err.message.split("\n")[0] });
        }
      }
      status.checkedAt = new Date().toISOString();
      push();
      return getStatus();
    })().finally(() => {
      checking = null;
    });
    return checking;
  }

  function restart() {
    if (autoUpdater && status.app.state === "downloaded") autoUpdater.quitAndInstall();
  }

  function startAuto(getSettings) {
    if (!hasFeed) return; // nothing to update against in development or unpacked builds
    const tick = () => {
      if (getSettings().autoCheckUpdates) check().catch(() => {});
    };
    setTimeout(tick, AUTO_DELAY).unref?.();
    setInterval(tick, AUTO_EVERY).unref?.();
  }

  function getStatus() {
    return { ...status, app: { ...status.app } };
  }

  return { check, restart, startAuto, status: getStatus };
}

module.exports = { createUpdater };
