// Backup folder: project backups (JSON) and run sheets (CSV) are saved as files in a folder the user picks, usually
// inside Google Drive for desktop, OneDrive or Dropbox, which syncs them. No Google sign-in, no token, no secret.
//
// Two backends with the same async interface (status, choose, reconnect, clear, write, read, list, reveal):
// - DesktopSyncBackend: the Electron main process does the file I/O (src/main/sync-folder.js) and owns the path.
// - BrowserSyncBackend: the File System Access API (Chrome/Edge, secure contexts only: file://, localhost). The
//   folder handle is kept in IndexedDB (a handle cannot go in localStorage); after a reload the browser may ask for
//   permission again, which needs a click (reconnect).
// Elsewhere (Firefox, Safari, a plain-http LAN address) there is no backend and the panel is disabled.
//
// status() resolves to { state, name, path } with state "none" (no folder chosen), "ready", "needsPermission"
// (browser) or "unavailable" (desktop: the folder is gone, e.g. Google Drive is not running).

const SYNC_CONFIG_KEY = "spd_sync_folder_v1";

/** The message of an Electron IPC error without the "Error invoking remote method 'x': Error:" prefix. */
function syncErrorMessage(err) {
  const text = String((err && err.message) || err || "Unknown error");
  return text.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
}

class DesktopSyncBackend {
  constructor(api) {
    this.api = api;
    this.kind = "desktop";
    this.canReveal = true;
  }

  static toStatus(raw) {
    if (!raw || !raw.folder) return { state: "none", name: "", path: "" };
    return { state: raw.accessible ? "ready" : "unavailable", name: String(raw.name || ""), path: String(raw.folder) };
  }

  async call(fn) {
    try {
      return await fn();
    } catch (err) {
      throw new Error(syncErrorMessage(err), { cause: err });
    }
  }

  async status() {
    return DesktopSyncBackend.toStatus(await this.call(() => this.api.get()));
  }

  async choose() {
    const raw = await this.call(() => this.api.choose());
    return raw ? DesktopSyncBackend.toStatus(raw) : null;
  }

  async reconnect() {
    return this.status();
  }

  async clear() {
    await this.call(() => this.api.clear());
  }

  async write(name, text) {
    await this.call(() => this.api.write(name, text));
  }

  async read(name) {
    return this.call(() => this.api.read(name));
  }

  async list() {
    const files = await this.call(() => this.api.list());
    return Array.isArray(files) ? files : [];
  }

  async reveal(name) {
    await this.call(() => this.api.reveal(name));
  }
}

class BrowserSyncBackend {
  constructor() {
    this.kind = "browser";
    this.canReveal = false;
    this.handle = null;
    this.loaded = false;
  }

  static isAvailable() {
    return typeof window.showDirectoryPicker === "function" && window.isSecureContext === true;
  }

  // --- IndexedDB (db spd_sync_folder, store handles, key folder). Failures mean "no folder chosen". ---

  openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("spd_sync_folder", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("handles");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async dbRequest(mode, run) {
    const db = await this.openDb();
    try {
      return await new Promise((resolve, reject) => {
        const request = run(db.transaction("handles", mode).objectStore("handles"));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  }

  async loadHandle() {
    if (this.loaded) return this.handle;
    try {
      const stored = await this.dbRequest("readonly", (store) => store.get("folder"));
      this.handle = stored && stored.kind === "directory" ? stored : null;
    } catch (e) {
      console.warn("Could not read the backup folder from IndexedDB", e && e.message);
      this.handle = null;
    }
    this.loaded = true;
    return this.handle;
  }

  async saveHandle(handle) {
    this.handle = handle;
    this.loaded = true;
    try {
      if (handle) await this.dbRequest("readwrite", (store) => store.put(handle, "folder"));
      else await this.dbRequest("readwrite", (store) => store.delete("folder"));
    } catch (e) {
      // Still works until the page is reloaded
      console.warn("Could not store the backup folder in IndexedDB", e && e.message);
    }
  }

  async permission(handle, request) {
    const fn = request ? handle.requestPermission : handle.queryPermission;
    if (typeof fn !== "function") return "granted";
    try {
      return await fn.call(handle, { mode: "readwrite" });
    } catch {
      return "denied";
    }
  }

  async statusOf(handle) {
    if (!handle) return { state: "none", name: "", path: "" };
    const granted = (await this.permission(handle, false)) === "granted";
    return { state: granted ? "ready" : "needsPermission", name: handle.name, path: "" };
  }

  async status() {
    return this.statusOf(await this.loadHandle());
  }

  async choose() {
    let picked;
    try {
      picked = await window.showDirectoryPicker({ id: "spd-sync", mode: "readwrite" });
    } catch (err) {
      if (err && err.name === "AbortError") return null;
      throw err;
    }
    // Picking the app's own subfolder (e.g. on a second computer) uses it as is
    const folder =
      picked.name === SYNC_SUBFOLDER ? picked : await picked.getDirectoryHandle(SYNC_SUBFOLDER, { create: true });
    await this.saveHandle(folder);
    return this.statusOf(folder);
  }

  /** Asks the browser for access again. Must run inside a click handler. */
  async reconnect() {
    const handle = await this.loadHandle();
    if (handle) await this.permission(handle, true);
    return this.statusOf(handle);
  }

  async clear() {
    await this.saveHandle(null);
  }

  async readyFolder() {
    const handle = await this.loadHandle();
    if (!handle) throw new Error("No backup folder chosen");
    if ((await this.permission(handle, false)) !== "granted") {
      throw new Error("The browser needs permission for the backup folder again: click Reconnect folder.");
    }
    return handle;
  }

  async write(name, text) {
    if (!isSyncFileName(name)) throw new Error("Invalid backup file name");
    if (typeof text !== "string" || new Blob([text]).size > SYNC_MAX_BYTES) throw new Error("Invalid backup content");
    const fileHandle = await (await this.readyFolder()).getFileHandle(name, { create: true });
    // createWritable() writes to a temporary file that replaces the original on close()
    const writable = await fileHandle.createWritable();
    try {
      await writable.write(text);
      await writable.close();
    } catch (err) {
      await writable.abort().catch(() => {});
      throw err;
    }
  }

  async read(name) {
    if (!isSyncFileName(name)) throw new Error("Invalid backup file name");
    const file = await (await (await this.readyFolder()).getFileHandle(name)).getFile();
    if (file.size > SYNC_MAX_BYTES) throw new Error("Backup file is too large");
    return file.text();
  }

  async list() {
    const folder = await this.readyFolder();
    const files = [];
    for await (const entry of folder.values()) {
      if (entry.kind !== "file" || !isSyncFileName(entry.name)) continue;
      try {
        const file = await entry.getFile();
        files.push({ name: entry.name, modifiedTime: new Date(file.lastModified).toISOString(), size: file.size });
      } catch {
        // Removed while listing
      }
    }
    return files.sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));
  }

  async reveal() {
    // Browsers cannot open a file manager
  }
}

class SyncFolderService {
  constructor() {
    const api = window.electronAPI && window.electronAPI.syncFolder;
    if (api && typeof api.get === "function") this.backend = new DesktopSyncBackend(api);
    else if (BrowserSyncBackend.isAvailable()) this.backend = new BrowserSyncBackend();
    else this.backend = null;

    this.config = this.loadConfig();
    // Last known folder status; refresh() updates it
    this.folder = { state: "none", name: "", path: "" };
  }

  get supported() {
    return !!this.backend;
  }

  get kind() {
    return this.backend ? this.backend.kind : null;
  }

  get canReveal() {
    return !!this.backend && this.backend.canReveal;
  }

  get isReady() {
    return this.folder.state === "ready";
  }

  loadConfig() {
    try {
      return normalizeSyncConfig(JSON.parse(localStorage.getItem(SYNC_CONFIG_KEY) || "{}"));
    } catch {
      return normalizeSyncConfig({});
    }
  }

  saveConfig() {
    try {
      localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(normalizeSyncConfig(this.config)));
    } catch (e) {
      console.warn("Could not save the backup folder settings", e && e.message);
    }
  }

  setAutoSync(enabled) {
    this.config.autoSync = !!enabled;
    this.saveConfig();
  }

  markSynced() {
    this.config.lastSyncTime = new Date().toISOString();
    this.saveConfig();
  }

  async refresh() {
    if (!this.backend) return this.folder;
    try {
      this.folder = await this.backend.status();
    } catch (e) {
      console.warn("Could not check the backup folder", e && e.message);
      this.folder = { state: "unavailable", name: "", path: "" };
    }
    return this.folder;
  }

  /** Lets the user pick a folder. Resolves to false when they cancel. */
  async choose() {
    if (!this.backend) return false;
    const result = await this.backend.choose();
    if (!result) return false;
    this.folder = result;
    return true;
  }

  async reconnect() {
    if (!this.backend) return this.folder;
    this.folder = await this.backend.reconnect();
    return this.folder;
  }

  async clear() {
    if (!this.backend) return;
    await this.backend.clear();
    this.folder = { state: "none", name: "", path: "" };
  }

  requireBackend() {
    if (!this.backend) throw new Error("Backup folders are not supported here");
    return this.backend;
  }

  async write(name, text) {
    await this.requireBackend().write(name, text);
  }

  async read(name) {
    return this.requireBackend().read(name);
  }

  async list() {
    return this.requireBackend().list();
  }

  async reveal(name) {
    await this.requireBackend().reveal(name);
  }
}

window.syncFolderService = new SyncFolderService();
