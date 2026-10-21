// SecretStore: the only place the renderer keeps secrets (the Google Custom Search API key). Classic script, loaded
// after util.js and before the app scripts.
//
// - Desktop app: values are encrypted by the Electron main process (safeStorage) through window.electronAPI.secrets
//   and cached here in memory. Nothing secret ever goes to localStorage.
// - Browser / LAN share (no electronAPI.secrets), or no OS encryption: `available` is false, every write is refused
//   and the features that need a secret are disabled.
//
// Call `await SecretStore.init()` once before anything reads a secret; get() is synchronous from the cache.

const SECRET_NAMES = Object.freeze({ gsearchApiKey: "gsearchApiKey" });

const SECRET_MAX_LENGTH = 4096;

// Where earlier versions kept secrets in plain text. Purged on every start (see migrateLegacy). The Google Drive
// config (with its saved access token) is obsolete since the backup folder replaced the Drive sign-in.
const LEGACY_GDRIVE_CONFIG_KEY = "speaker_gdrive_config_v1";
const LEGACY_GSEARCH_KEY = "spd_gsearch_api_key";

const SecretStore = (() => {
  const cache = new Map();
  let available = false;
  let initPromise = null;

  function bridge() {
    const api = window.electronAPI && window.electronAPI.secrets;
    return api && typeof api.getAll === "function" ? api : null;
  }

  function isKnownName(name) {
    return Object.values(SECRET_NAMES).includes(name);
  }

  async function load() {
    const api = bridge();
    if (!api) return;
    try {
      const result = await api.getAll();
      available = Boolean(result && result.available);
      const values = result && result.values && typeof result.values === "object" ? result.values : {};
      for (const [name, value] of Object.entries(values)) {
        if (isKnownName(name) && typeof value === "string" && value) cache.set(name, value);
      }
    } catch (e) {
      console.warn("Encrypted secret storage is not available", e && e.message);
      available = false;
      cache.clear();
    }
  }

  async function remove(name) {
    if (!isKnownName(name)) return false;
    cache.delete(name);
    if (!available) return false;
    try {
      await bridge().remove(name);
      return true;
    } catch (e) {
      console.warn("Could not remove a stored secret", e && e.message);
      return false;
    }
  }

  async function set(name, value) {
    if (!available || !isKnownName(name)) return false;
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) return remove(name);
    if (text.length > SECRET_MAX_LENGTH) return false;
    try {
      await bridge().set(name, text);
      cache.set(name, text);
      return true;
    } catch (e) {
      console.warn("Could not store a secret", e && e.message);
      return false;
    }
  }

  /**
   * Removes plaintext secrets left in localStorage by earlier versions: the Search API key (moved into the encrypted
   * store when it is available and holds no value yet, otherwise just deleted) and the whole old Google Drive config,
   * which could hold a saved access token. Runs on every start, after init().
   */
  async function migrateLegacy() {
    let storage;
    try {
      storage = window.localStorage;
    } catch {
      return;
    }

    storage.removeItem(LEGACY_GDRIVE_CONFIG_KEY);

    const legacyKey = storage.getItem(LEGACY_GSEARCH_KEY);
    if (legacyKey !== null) {
      storage.removeItem(LEGACY_GSEARCH_KEY);
      if (legacyKey.trim() && !cache.has(SECRET_NAMES.gsearchApiKey)) {
        await set(SECRET_NAMES.gsearchApiKey, legacyKey);
      }
    }
  }

  return {
    get available() {
      return available;
    },
    init() {
      if (!initPromise) initPromise = load();
      return initPromise;
    },
    /** The cached value, or '' when there is none (always '' when unavailable). */
    get(name) {
      return cache.get(name) || "";
    },
    set,
    remove,
    migrateLegacy,
  };
})();
