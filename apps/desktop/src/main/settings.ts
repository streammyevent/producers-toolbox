import fs from "node:fs";
import path from "node:path";

export const THEMES = ["system", "light", "dark"] as const;
type Theme = (typeof THEMES)[number];

export interface Settings {
  theme: Theme;
  startWithWindows: boolean;
  minimizeToTray: boolean;
  autoCheckUpdates: boolean;
  pinnedTools: string[];
  hiddenTools: string[];
}

export const DEFAULTS: Readonly<Settings> = Object.freeze({
  theme: "system",
  startWithWindows: false,
  minimizeToTray: false,
  autoCheckUpdates: true,
  pinnedTools: [],
  hiddenTools: [], // tools the user removed from the launcher
});

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const BOOLEAN_KEYS = ["startWithWindows", "minimizeToTray", "autoCheckUpdates"] as const;

// Coerce anything (corrupt file, odd IPC payload) into valid settings. Only known keys survive; a bad value falls
// back to the given base value.
export function sanitize(input: unknown, base: Readonly<Settings> = DEFAULTS): Settings {
  const src = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const out: Settings = { ...base, pinnedTools: [...base.pinnedTools], hiddenTools: [...base.hiddenTools] };
  if (THEMES.includes(src.theme as Theme)) out.theme = src.theme as Theme;
  for (const k of BOOLEAN_KEYS) {
    if (typeof src[k] === "boolean") out[k] = src[k];
  }
  const ids = (arr: unknown[]) => [
    ...new Set(arr.filter((id): id is string => typeof id === "string" && ID_RE.test(id))),
  ];
  if (Array.isArray(src.pinnedTools)) out.pinnedTools = ids(src.pinnedTools);
  if (Array.isArray(src.hiddenTools)) out.hiddenTools = ids(src.hiddenTools);
  return out;
}

/** JSON settings file with defaults, validation and atomic writes (temp file + rename). */
export function createSettings({ file }: { file: string }) {
  let current = sanitize(null);
  try {
    current = sanitize(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    // missing or unreadable: defaults
  }

  const copy = (): Settings => ({
    ...current,
    pinnedTools: [...current.pinnedTools],
    hiddenTools: [...current.hiddenTools],
  });

  return {
    get: copy,
    /** Merges a partial update; invalid fields are ignored. Returns the new settings. */
    set(patch: unknown): Settings {
      current = sanitize(patch, current);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(current, null, 2));
      fs.renameSync(tmp, file);
      return copy();
    },
  };
}
