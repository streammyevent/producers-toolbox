const fs = require("fs");
const path = require("path");

const NAME_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

// Encrypted per-tool secret store (API keys, access tokens). Values are encrypted with the OS
// keychain (Electron safeStorage: DPAPI on Windows) and kept in <dir>/<toolId>.json, so a copy
// of the user-data folder on another machine or account cannot read them.
// Returns null from get() when a value is missing or cannot be decrypted; set() returns false
// when encryption is unavailable, so the caller can decide what to do instead of storing plaintext.
function createSecretStore({ dir, safeStorage }) {
  const fileFor = (toolId) => path.join(dir, `${toolId}.json`);

  function read(toolId) {
    try {
      const data = JSON.parse(fs.readFileSync(fileFor(toolId), "utf8"));
      return data && typeof data === "object" && !Array.isArray(data) ? data : {};
    } catch {
      return {};
    }
  }

  function write(toolId, data) {
    fs.mkdirSync(dir, { recursive: true });
    const file = fileFor(toolId);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  function check(toolId, name) {
    if (!ID_RE.test(toolId) || !NAME_RE.test(name)) throw new Error("Invalid secret name");
  }

  return {
    available: () => safeStorage.isEncryptionAvailable(),

    get(toolId, name) {
      check(toolId, name);
      const enc = read(toolId)[name];
      if (typeof enc !== "string" || !safeStorage.isEncryptionAvailable()) return null;
      try {
        return safeStorage.decryptString(Buffer.from(enc, "base64"));
      } catch {
        return null;
      }
    },

    set(toolId, name, value) {
      check(toolId, name);
      if (typeof value !== "string" || !safeStorage.isEncryptionAvailable()) return false;
      const data = read(toolId);
      if (value === "") delete data[name];
      else data[name] = safeStorage.encryptString(value).toString("base64");
      write(toolId, data);
      return true;
    },

    remove(toolId, name) {
      check(toolId, name);
      const data = read(toolId);
      if (!(name in data)) return;
      delete data[name];
      write(toolId, data);
    },
  };
}

module.exports = { createSecretStore };
