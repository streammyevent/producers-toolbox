// tool.json: the manifest and the whole per-tool policy (window, CSP, permissions, secrets, folder access).
// No Electron here, so it can be unit tested.
import fs from "node:fs";
import path from "node:path";

export const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
// app://shell is the launcher's own origin.
const RESERVED_IDS = new Set(["shell"]);
const SECRET_NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const MAX_FOLDER_BYTES = 50 * 1024 * 1024;

// What a tool may ask for. "camera" grants video capture only.
export const TOOL_PERMISSIONS = ["camera", "clipboard-read"] as const;
export type ToolPermission = (typeof TOOL_PERMISSIONS)[number];

export const DEFAULT_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
].join("; ");

export interface ToolFolderPolicy {
  /** Subfolder the tool keeps its files in; null uses the picked folder as is. */
  subfolder: string | null;
  /** File names the page may read and write; null means the page cannot (only api.js uses the folder). */
  files: RegExp | null;
  maxBytes: number;
}

export interface ToolManifest {
  id: string;
  name: string;
  version: string | null;
  /** Relative to web/. */
  entry: string;
  /** Relative to web/. */
  icon: string | null;
  window: { width: number; height: number };
  csp: string;
  permissions: ToolPermission[];
  secrets: string[];
  folder: ToolFolderPolicy | null;
}

const KNOWN_KEYS = new Set([
  "id",
  "name",
  "version",
  "entry",
  "icon",
  "window",
  "csp",
  "permissions",
  "secrets",
  "folder",
]);

/** Resolves a relative path inside a folder; null when it escapes the folder. */
export function safeJoin(base: string, rel: string): string | null {
  const full = path.normalize(path.join(base, rel));
  return full === base || full.startsWith(base + path.sep) ? full : null;
}

function parseCsp(csp: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const part of csp.split(";")) {
    const [name, ...tokens] = part.trim().split(/\s+/);
    if (name) directives.set(name.toLowerCase(), tokens);
  }
  return directives;
}

/** Why a policy is too weak for a tool page, or null when it is acceptable. */
export function cspProblem(csp: string): string | null {
  const d = parseCsp(csp);
  const scripts = d.get("script-src") ?? d.get("default-src");
  // 'wasm-unsafe-eval' lets a page compile WebAssembly it already has; it does not allow JS eval.
  const allowed = (t: string) => t === "'self'" || t === "'wasm-unsafe-eval'";
  if (!scripts?.includes("'self'") || !scripts.every(allowed)) {
    return "script-src must be 'self', optionally with 'wasm-unsafe-eval'";
  }
  for (const [name, tokens] of d) {
    if (name.startsWith("script-src") && tokens.some((t) => !allowed(t) && t !== "'none'")) {
      return `${name} may only allow 'self' and 'wasm-unsafe-eval'`;
    }
  }
  if (/'unsafe-eval'/i.test(csp)) return "eval is not allowed";
  if (d.get("object-src")?.join(" ") !== "'none'") return "object-src must be 'none'";
  if (!d.has("base-uri")) return "base-uri is required";
  return null;
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function readFolderPolicy(raw: unknown): ToolFolderPolicy | null {
  if (raw === undefined || raw === null) return null;
  if (!isObject(raw)) throw new Error("folder must be an object");
  const { subfolder = null, files = null, maxBytes = 5 * 1024 * 1024 } = raw;
  if (subfolder !== null && (typeof subfolder !== "string" || !/^[\w .-]{1,100}$/.test(subfolder))) {
    throw new Error("folder.subfolder must be a plain folder name");
  }
  if (files !== null && (typeof files !== "string" || !files.startsWith("^") || !files.endsWith("$"))) {
    throw new Error("folder.files must be an anchored regular expression (^...$)");
  }
  if (typeof maxBytes !== "number" || !(maxBytes > 0) || maxBytes > MAX_FOLDER_BYTES) {
    throw new Error("folder.maxBytes is out of range");
  }
  return {
    subfolder: subfolder as string | null,
    files: files === null ? null : new RegExp(files as string),
    maxBytes,
  };
}

/** Parses and checks <dir>/tool.json. The id must equal the folder name. Throws with a readable message. */
export function readManifest(dir: string, folderName: string): ToolManifest {
  let m: unknown;
  try {
    m = JSON.parse(fs.readFileSync(path.join(dir, "tool.json"), "utf8"));
  } catch (err) {
    const missing = (err as NodeJS.ErrnoException).code === "ENOENT";
    throw new Error(missing ? "tool.json is missing" : "tool.json is not valid JSON", { cause: err });
  }
  if (!isObject(m)) throw new Error("tool.json must be an object");
  const unknown = Object.keys(m).filter((k) => !KNOWN_KEYS.has(k));
  if (unknown.length) throw new Error(`unknown field(s): ${unknown.join(", ")}`);

  const { id, name, version = null, entry = "index.html", icon = null, csp = DEFAULT_CSP } = m;
  if (typeof id !== "string" || !ID_RE.test(id)) throw new Error("id must be lowercase letters, digits and dashes");
  if (RESERVED_IDS.has(id)) throw new Error(`id "${id}" is reserved`);
  if (id !== folderName) throw new Error("id must match the folder name");
  if (typeof name !== "string" || !name.trim() || name.length > 100) throw new Error("name is required");
  if (version !== null && typeof version !== "string") throw new Error("version must be a string");

  const webDir = path.join(dir, "web");
  if (typeof entry !== "string" || !safeJoin(webDir, entry)) throw new Error("entry must be a file inside web/");
  if (icon !== null && (typeof icon !== "string" || !safeJoin(webDir, icon))) {
    throw new Error("icon must be a file inside web/");
  }

  const win = isObject(m.window) ? m.window : {};
  const size = (v: unknown, fallback: number) => (typeof v === "number" && v >= 400 && v <= 4000 ? v : fallback);

  if (typeof csp !== "string") throw new Error("csp must be a string");
  const problem = cspProblem(csp);
  if (problem) throw new Error(`csp: ${problem}`);

  const permissions = m.permissions ?? [];
  if (!Array.isArray(permissions) || !permissions.every((p) => TOOL_PERMISSIONS.includes(p))) {
    throw new Error(`permissions may only contain ${TOOL_PERMISSIONS.join(", ")}`);
  }
  const secrets = m.secrets ?? [];
  if (!Array.isArray(secrets) || !secrets.every((s) => typeof s === "string" && SECRET_NAME_RE.test(s))) {
    throw new Error("secrets must be a list of names");
  }

  return {
    id,
    name: name.trim(),
    version,
    entry,
    icon,
    window: { width: size(win.width, 1280), height: size(win.height, 860) },
    csp,
    permissions,
    secrets,
    folder: readFolderPolicy(m.folder),
  };
}
