const fs = require("fs");
const path = require("path");

const THEMES = ["system", "light", "dark"];
const DEFAULTS = Object.freeze({
  theme: "system",
  startWithWindows: false,
  minimizeToTray: false,
  autoCheckUpdates: true,
  pinnedTools: [],
  hiddenTools: [], // built-in tools the user removed from the launcher
});

// Coerce anything (corrupt file, odd IPC payload) into a valid settings object.
// Only known keys survive; a bad value falls back to the given base value.
function sanitize(input, base = DEFAULTS) {
  const src = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const out = { ...base, pinnedTools: [...base.pinnedTools], hiddenTools: [...base.hiddenTools] };
  if (THEMES.includes(src.theme)) out.theme = src.theme;
  for (const k of ["startWithWindows", "minimizeToTray", "autoCheckUpdates"]) {
    if (typeof src[k] === "boolean") out[k] = src[k];
  }
  const ids = (arr) => [...new Set(arr.filter((id) => typeof id === "string" && /^[a-z0-9][a-z0-9-]*$/.test(id)))];
  if (Array.isArray(src.pinnedTools)) out.pinnedTools = ids(src.pinnedTools);
  if (Array.isArray(src.hiddenTools)) out.hiddenTools = ids(src.hiddenTools);
  return out;
}

// JSON settings file with defaults, validation and atomic writes (temp file + rename).
function createSettings({ file }) {
  let current = sanitize(null);
  try {
    current = sanitize(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    // missing or unreadable: defaults
  }

  function save() {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(current, null, 2));
    fs.renameSync(tmp, file);
  }

  return {
    get: () => ({ ...current, pinnedTools: [...current.pinnedTools], hiddenTools: [...current.hiddenTools] }),
    // Merge a partial update; invalid fields are ignored. Returns the new settings.
    set(patch) {
      current = sanitize(patch, current);
      save();
      return this.get();
    },
  };
}

module.exports = { createSettings, sanitize, DEFAULTS, THEMES };
