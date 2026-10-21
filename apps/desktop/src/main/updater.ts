import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import type { AppUpdater } from "electron-updater";

const AUTO_DELAY = 10 * 1000;
const AUTO_EVERY = 6 * 60 * 60 * 1000;

type AppState =
  | { state: "idle" | "checking" }
  | { state: "unsupported"; packaged: boolean }
  | { state: "up-to-date"; version: string }
  | { state: "downloading"; version?: string; percent: number }
  | { state: "downloaded"; version: string }
  | { state: "error"; message: string };

export interface UpdateStatus {
  app: AppState;
  checkedAt: string | null;
}

const firstLine = (err: unknown) => String(err instanceof Error ? err.message : err).split("\n")[0];

// Updates come from GitHub Releases through electron-updater, only in the installed app. Tools ship inside the app,
// so they update with it. Status is pushed to the launcher as 'updates:status'.
export function createUpdater({ send }: { send: (status: UpdateStatus) => void }) {
  // The installer ships app-update.yml (the GitHub feed); an unpacked --dir build has none.
  const hasFeed = app.isPackaged && fs.existsSync(path.join(process.resourcesPath, "app-update.yml"));
  const status: UpdateStatus = {
    app: hasFeed ? { state: "idle" } : { state: "unsupported", packaged: app.isPackaged },
    checkedAt: null,
  };
  let updater: AppUpdater | null = null;
  let checking: Promise<UpdateStatus> | null = null;

  const getStatus = (): UpdateStatus => ({ ...status, app: { ...status.app } });
  const setApp = (s: AppState) => {
    status.app = s;
    send(getStatus());
  };

  if (hasFeed) {
    updater = require("electron-updater").autoUpdater as AppUpdater;
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    updater.on("checking-for-update", () => setApp({ state: "checking" }));
    updater.on("update-available", (i) => setApp({ state: "downloading", version: i.version, percent: 0 }));
    updater.on("update-not-available", () => setApp({ state: "up-to-date", version: app.getVersion() }));
    updater.on("download-progress", (p) => {
      const version = status.app.state === "downloading" ? status.app.version : undefined;
      setApp({ state: "downloading", version, percent: Math.round(p.percent || 0) });
    });
    updater.on("update-downloaded", (i) => setApp({ state: "downloaded", version: i.version }));
    updater.on("error", (err) => setApp({ state: "error", message: firstLine(err) }));
  }

  function check(): Promise<UpdateStatus> {
    checking ??= (async () => {
      if (updater && status.app.state !== "downloading" && status.app.state !== "downloaded") {
        try {
          await updater.checkForUpdates();
        } catch (err) {
          setApp({ state: "error", message: firstLine(err) });
        }
      }
      status.checkedAt = new Date().toISOString();
      send(getStatus());
      return getStatus();
    })().finally(() => {
      checking = null;
    });
    return checking;
  }

  return {
    check,
    status: getStatus,
    restart(): void {
      if (updater && status.app.state === "downloaded") updater.quitAndInstall();
    },
    startAuto(autoCheck: () => boolean): void {
      if (!hasFeed) return; // nothing to update against in development or unpacked builds
      const tick = () => {
        if (autoCheck()) check().catch(() => {});
      };
      setTimeout(tick, AUTO_DELAY).unref();
      setInterval(tick, AUTO_EVERY).unref();
    },
  };
}
