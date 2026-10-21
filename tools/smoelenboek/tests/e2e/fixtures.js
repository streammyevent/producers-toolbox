// Shared Playwright fixtures and helpers for the Speaker Photo Directory characterization tests.
//
// - Every external request (Google Fonts, Google Custom Search, Wikipedia, ...) is stubbed
//   or aborted, so the tests are fast, deterministic and work offline.
// - `seedStorage` writes localStorage entries before the app's scripts run (via page.addInitScript).
// - `consoleErrors` collects console errors and uncaught page errors.
// - Locator helpers prefer stable hooks (ids, data-action, data-id, data-filter) over CSS classes so the
//   tests survive a visual redesign.

const base = require("@playwright/test");

const { expect } = base;

const REGISTRY_KEY = "speaker_projects_registry_v1";
const CURRENT_PROJECT_KEY = "speaker_current_project_id_v1";
const LEGACY_SPEAKERS_KEY = "speaker_photo_directory_v1";
const LEGACY_MICS_KEY = "speaker_mic_inventory_v1";
const LEGACY_TITLE_KEY = "speaker_project_title_v1";
const UI_MODE_KEY = "spd_ui_mode";

// 1x1 transparent PNG used for every external image.
const PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

function isLocalUrl(url) {
  return /^(https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/|data:|blob:|about:)/.test(url);
}

/**
 * Stubs or aborts every request that leaves the local test server.
 * Images get a 1x1 PNG, stylesheets/scripts an empty body, fetch/XHR an empty JSON object (with CORS headers
 * so the app's own fetch error handling is not exercised), everything else is aborted.
 */
async function stubExternalRequests(page) {
  await page.route(
    (url) => !isLocalUrl(url.href),
    async (route) => {
      const type = route.request().resourceType();
      if (type === "image") {
        await route.fulfill({ status: 200, contentType: "image/png", body: PIXEL_PNG });
      } else if (type === "stylesheet") {
        await route.fulfill({ status: 200, contentType: "text/css", body: "" });
      } else if (type === "script") {
        await route.fulfill({ status: 200, contentType: "application/javascript", body: "" });
      } else if (type === "fetch" || type === "xhr") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "access-control-allow-origin": "*" },
          body: "{}",
        });
      } else {
        await route.abort();
      }
    },
  );
}

const test = base.test.extend({
  page: async ({ page }, use) => {
    await stubExternalRequests(page);
    await use(page);
  },

  /**
   * Array of console errors and uncaught page errors seen during the test. Failures caused by the blocked
   * external requests ("Failed to load resource" for a non-local URL) are ignored.
   */
  consoleErrors: async ({ page }, use) => {
    const errors = [];
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      const url = msg.location()?.url || "";
      if (/Failed to load resource/i.test(msg.text()) && url && !isLocalUrl(url)) return;
      errors.push(`console.error: ${msg.text()} (${url})`);
    });
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
    await use(errors);
  },

  /**
   * Seeds localStorage BEFORE the app loads. Pass an object of key -> value (non-strings are JSON-encoded).
   * The seed is applied once per tab (guarded by a sessionStorage flag) so page.reload() keeps what the app
   * saved instead of re-seeding.
   */
  /** Function form of installFakeDesktopSecrets for the current page: `await desktopSecrets({ initial })`. */
  desktopSecrets: async ({ page }, use) => {
    await use((options) => installFakeDesktopSecrets(page, options));
  },

  /** Function form of installFakeSyncFolder for the current page: `await desktopSyncFolder({ files })`. */
  desktopSyncFolder: async ({ page }, use) => {
    await use((options) => installFakeSyncFolder(page, options));
  },

  /** Function form of installOpfsDirectoryPicker for the current page: `await browserSyncFolder({ permission })`. */
  browserSyncFolder: async ({ page }, use) => {
    await use((options) => installOpfsDirectoryPicker(page, options));
  },

  seedStorage: async ({ page }, use) => {
    await use(async (entries) => {
      const serialized = {};
      for (const [key, value] of Object.entries(entries)) {
        serialized[key] = typeof value === "string" ? value : JSON.stringify(value);
      }
      await page.addInitScript((data) => {
        if (window.sessionStorage.getItem("__e2e_seeded")) return;
        for (const [key, value] of Object.entries(data)) window.localStorage.setItem(key, value);
        window.sessionStorage.setItem("__e2e_seeded", "1");
      }, serialized);
    });
  },
});

/**
 * TEST HOOK (fixture only, nothing in src/): makes the renderer believe it runs in the Electron desktop app by
 * defining `window.electronAPI` with a fake `secrets` bridge before the app's scripts run. The fake keeps values in
 * an in-page Map (exposed as `window.__fakeSecrets.store`, with a log of calls in `.calls` that never includes
 * values) instead of encrypting them in the main process. Like the real bridge it only accepts the allowlisted
 * names and string values up to 4096 characters, and with `available: false` it behaves like a desktop app without
 * OS encryption (getAll reports unavailable, set rejects).
 *
 * The Map lives in the page, so it starts over on every navigation/reload from `initial`.
 */
async function installFakeDesktopSecrets(page, { initial = {}, available = true } = {}) {
  await page.addInitScript(
    ({ initial: seed, available: canEncrypt }) => {
      const NAMES = ["gsearchApiKey"];
      const store = new Map(Object.entries(seed));
      const calls = [];
      const checkName = (name) => {
        if (!NAMES.includes(name)) throw new Error("Unknown secret name");
      };
      window.__fakeSecrets = { store, calls };
      // Keeps a fake syncFolder bridge installed before this one
      window.electronAPI = {
        ...window.electronAPI,
        isDesktop: true,
        platform: "e2e-fake",
        quitApp() {},
        minimizeApp() {},
        maximizeApp() {},
        showSaveDialog: async () => ({ canceled: true }),
        showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
        notifyAppReady() {},
        secrets: {
          async getAll() {
            calls.push(["getAll"]);
            return canEncrypt
              ? { available: true, values: Object.fromEntries(store) }
              : { available: false, values: {} };
          },
          async set(name, value) {
            calls.push(["set", name]);
            checkName(name);
            if (typeof value !== "string" || !value || value.length > 4096) throw new Error("Invalid secret value");
            if (!canEncrypt) throw new Error("Encrypted storage is not available on this system");
            store.set(name, value);
            return true;
          },
          async remove(name) {
            calls.push(["remove", name]);
            checkName(name);
            store.delete(name);
            return true;
          },
        },
      };
    },
    { initial, available },
  );
}

/**
 * TEST HOOK (fixture only): a fake desktop `window.electronAPI.syncFolder` bridge (the backup folder of
 * src/main/sync-folder.js) backed by an in-page Map, exposed as `window.__fakeSync` ({ files, calls, state }).
 * Like the main process it only accepts the allowlisted file names and refuses I/O while no folder is chosen or the
 * folder is unavailable. `folder: null` starts with no folder chosen; choose() then picks `chooseFolder` (or
 * cancels when that is null). The Map starts over on every navigation/reload.
 */
async function installFakeSyncFolder(
  page,
  {
    folder = "C:\\Fake Drive\\Personal\\Speaker Photo Directory",
    chooseFolder = "C:\\Fake Drive\\Team\\Speaker Photo Directory",
    accessible = true,
    files = {},
  } = {},
) {
  await page.addInitScript(
    ({ folder: initialFolder, chooseFolder: picked, accessible: isAccessible, files: seed }) => {
      const NAME = /^(Backup|RunSheet)_[A-Za-z0-9_-]{1,100}\.(json|csv)$/;
      const files = new Map(
        Object.entries(seed).map(([name, content]) => [name, { content, modifiedTime: "2026-05-01T10:00:00.000Z" }]),
      );
      const state = { folder: initialFolder, accessible: isAccessible };
      const calls = [];
      const status = () => ({
        folder: state.folder || "",
        name: state.folder ? state.folder.split("\\").pop() : "",
        accessible: !!state.folder && state.accessible,
      });
      const ready = () => {
        if (!state.folder) throw new Error("No backup folder chosen");
        if (!state.accessible) throw new Error("The backup folder is not available: " + state.folder);
      };
      const checkName = (name) => {
        if (typeof name !== "string" || !NAME.test(name)) throw new Error("Invalid backup file name");
      };
      window.__fakeSync = { files, calls, state };
      window.electronAPI = {
        isDesktop: true,
        platform: "e2e-fake",
        ...window.electronAPI,
        syncFolder: {
          async get() {
            calls.push(["get"]);
            return status();
          },
          async choose() {
            calls.push(["choose"]);
            if (!picked) return null;
            state.folder = picked;
            state.accessible = true;
            return status();
          },
          async clear() {
            calls.push(["clear"]);
            state.folder = null;
            return status();
          },
          async write(name, content) {
            calls.push(["write", name]);
            ready();
            checkName(name);
            if (typeof content !== "string") throw new Error("Invalid backup content");
            files.set(name, { content, modifiedTime: new Date().toISOString() });
            return true;
          },
          async read(name) {
            calls.push(["read", name]);
            ready();
            checkName(name);
            if (!files.has(name)) throw new Error("ENOENT: no such file");
            return files.get(name).content;
          },
          async list() {
            calls.push(["list"]);
            ready();
            return [...files.entries()]
              .filter(([name]) => NAME.test(name))
              .map(([name, f]) => ({ name, modifiedTime: f.modifiedTime, size: f.content.length }));
          },
          async reveal(name) {
            calls.push(["reveal", name]);
            ready();
            return true;
          },
        },
      };
    },
    { folder, chooseFolder, accessible, files },
  );
}

/**
 * TEST HOOK (fixture only): makes the browser backend's `window.showDirectoryPicker` return a real directory in
 * Chromium's origin private file system (OPFS), so the File System Access code path runs headless. The picked
 * directory is `<OPFS root>/<pickedName>`; `window.__fakePicker` counts the picker and permission calls, and
 * `cancel: true` makes the picker throw an AbortError like a closed dialog. With `permission: "prompt"`, every page
 * load starts with queryPermission reporting "prompt" until the picker or requestPermission grants access (as after
 * a browser restart). OPFS lives in the browser profile, so it survives reloads within a test and starts empty in
 * every new test context.
 */
async function installOpfsDirectoryPicker(
  page,
  { pickedName = "My Drive", cancel = false, permission = "granted" } = {},
) {
  await page.addInitScript(
    ({ pickedName: name, cancel: shouldCancel, permission: initialPermission }) => {
      const picker = { calls: 0, requests: 0, permission: initialPermission };
      window.__fakePicker = picker;
      window.showDirectoryPicker = async () => {
        picker.calls++;
        if (shouldCancel) throw new DOMException("The user aborted a request.", "AbortError");
        // Like Chrome: picking a folder in readwrite mode grants access for this page load
        picker.permission = "granted";
        const root = await navigator.storage.getDirectory();
        return root.getDirectoryHandle(name, { create: true });
      };
      FileSystemHandle.prototype.queryPermission = async function () {
        return picker.permission;
      };
      FileSystemHandle.prototype.requestPermission = async function () {
        picker.requests++;
        picker.permission = "granted";
        return "granted";
      };
    },
    { pickedName, cancel, permission },
  );
}

/** Reads a text file from OPFS (where installOpfsDirectoryPicker's folders live), e.g. ["My Drive", "x", "f.json"]. */
async function readOpfsFile(page, pathParts) {
  return page.evaluate(async (parts) => {
    let dir = await navigator.storage.getDirectory();
    for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
    return (await (await dir.getFileHandle(parts[parts.length - 1])).getFile()).text();
  }, pathParts);
}

/** Writes a text file into OPFS, creating the folders on the way (see readOpfsFile). */
async function writeOpfsFile(page, pathParts, text) {
  await page.evaluate(
    async ({ parts, content }) => {
      let dir = await navigator.storage.getDirectory();
      for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create: true });
      const writable = await (await dir.getFileHandle(parts[parts.length - 1], { create: true })).createWritable();
      await writable.write(content);
      await writable.close();
    },
    { parts: pathParts, content: text },
  );
}

/** Waits until the SpeakerDirectoryApp instance (global `app`) and the backup folder controller exist. */
async function waitForApp(page) {
  await page.waitForFunction(() => typeof app !== "undefined" && app !== null && !!window.syncController);
}

/** Navigates to the app and waits until it has initialised and rendered. */
async function gotoApp(page, path = "/") {
  await page.goto(path);
  await waitForApp(page);
}

/** Speaker cards: the only elements in the grid that carry a data-id without a data-action. */
function speakerCards(page) {
  return page.locator("#speakers-container [data-id]:not([data-action])");
}

function speakerCard(page, name) {
  return speakerCards(page).filter({ hasText: name });
}

function filterChip(page, filter) {
  return page.locator(`[data-filter="${filter}"]`);
}

async function readStorage(page, key) {
  return page.evaluate((k) => window.localStorage.getItem(k), key);
}

async function readJsonStorage(page, key) {
  const raw = await readStorage(page, key);
  return raw === null ? null : JSON.parse(raw);
}

async function readRegistry(page) {
  return readJsonStorage(page, REGISTRY_KEY);
}

async function readCurrentProject(page) {
  const registry = (await readRegistry(page)) || [];
  const currentId = await readStorage(page, CURRENT_PROJECT_KEY);
  return registry.find((p) => p.id === currentId) || null;
}

/** Accepts the next native dialog (confirm/alert/prompt) and records its message. */
function acceptNextDialog(page) {
  return new Promise((resolve) => {
    page.once("dialog", async (dialog) => {
      const message = dialog.message();
      await dialog.accept();
      resolve(message);
    });
  });
}

/** A minimal speaker object in the app's stored shape. */
function makeSpeaker(overrides = {}) {
  return {
    id: "spk-test-1",
    fullName: "Test Speaker",
    title: "Tester, QA Inc",
    mic: "Lav 1 (Channel A)",
    micType: "lav",
    photo: "https://images.example.test/portrait.jpg",
    notes: "",
    ...overrides,
  };
}

/** A project object in the registry shape, for seeding. */
function makeProject(overrides = {}) {
  return {
    id: "proj-test-1",
    title: "Seeded Project",
    speakers: [makeSpeaker()],
    micInventory: [
      { name: "Lav 1 (Channel A)", type: "lav" },
      { name: "Handheld 1", type: "handheld" },
    ],
    lastModified: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

module.exports = {
  test,
  expect,
  REGISTRY_KEY,
  CURRENT_PROJECT_KEY,
  LEGACY_SPEAKERS_KEY,
  LEGACY_MICS_KEY,
  LEGACY_TITLE_KEY,
  UI_MODE_KEY,
  PIXEL_PNG,
  isLocalUrl,
  stubExternalRequests,
  installFakeDesktopSecrets,
  installFakeSyncFolder,
  installOpfsDirectoryPicker,
  readOpfsFile,
  writeOpfsFile,
  waitForApp,
  gotoApp,
  speakerCards,
  speakerCard,
  filterChip,
  readStorage,
  readJsonStorage,
  readRegistry,
  readCurrentProject,
  acceptNextDialog,
  makeSpeaker,
  makeProject,
};
