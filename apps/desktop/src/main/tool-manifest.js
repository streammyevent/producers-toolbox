const fs = require("fs");
const path = require("path");

// Rules for tool.json. No Electron here, so it can be unit tested.
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
// app://shell is the launcher's own origin.
const RESERVED_IDS = new Set(["shell"]);

// Resolve a relative path inside a base folder; null when it escapes the folder.
function safeJoin(base, rel) {
  const full = path.normalize(path.join(base, rel));
  return full === base || full.startsWith(base + path.sep) ? full : null;
}

// Parse and check <dir>/tool.json. `folderName` (when given) must equal the id.
// Throws with a readable message; returns the manifest otherwise.
function readManifest(dir, { folderName } = {}) {
  const file = path.join(dir, "tool.json");
  let m;
  try {
    m = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(err.code === "ENOENT" ? "tool.json is missing" : "tool.json is not valid JSON", { cause: err });
  }
  if (!m || typeof m !== "object" || Array.isArray(m)) throw new Error("tool.json must be an object");
  if (typeof m.id !== "string" || !ID_RE.test(m.id) || m.id.length > 64)
    throw new Error("id must be lowercase letters, digits and dashes");
  if (RESERVED_IDS.has(m.id)) throw new Error(`id "${m.id}" is reserved`);
  if (folderName !== undefined && m.id !== folderName) throw new Error("id must match folder name");
  if (typeof m.name !== "string" || !m.name.trim() || typeof m.entry !== "string" || !m.entry) {
    throw new Error("name and entry are required");
  }
  if (!safeJoin(dir, m.entry)) throw new Error("entry must stay inside the tool folder");
  if (m.version !== undefined && typeof m.version !== "string") throw new Error("version must be a string");
  return m;
}

module.exports = { ID_RE, safeJoin, readManifest };
