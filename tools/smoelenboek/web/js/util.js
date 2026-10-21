// Shared helpers for the renderer: HTML escaping, URL allowlisting, CSV parsing and normalization of
// speaker/project data that comes from storage, imports or the backup folder. Classic script (no modules): it
// defines globals that the other scripts use, so it must load before them.

const MIC_TYPES = ["lav", "handheld", "headset", "podium", "none"];

// Maximum lengths for user text. Longer values are cut off when data is imported or loaded.
const FIELD_LIMITS = { id: 100, name: 200, title: 200, notes: 1000, mic: 100, projectTitle: 200 };

const DEFAULT_PROJECT_TITLE = "Speaker Photo Directory";

const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" };

/** Escapes text for use in HTML text and in quoted attribute values. null/undefined become ''. */
function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[&<>"'`]/g, (ch) => HTML_ESCAPES[ch]);
}

/**
 * Returns the trimmed URL when its scheme is http: or https: (or, with allowData, a data:image/ URL).
 * Anything else (javascript:, file:, relative paths, non-strings) returns ''.
 */
function safeUrl(value, { allowData = false } = {}) {
  if (typeof value !== "string") return "";
  const url = value.trim();
  if (/^https?:\/\//i.test(url)) return url;
  if (allowData && /^data:image\//i.test(url)) return url;
  return "";
}

/** Returns the mic type when it is one of the known categories, else 'none'. */
function safeMicType(value) {
  return MIC_TYPES.includes(value) ? value : "none";
}

/**
 * Generated initials avatar, used when a speaker has no (valid) photo or the photo fails to load. Built locally as
 * an SVG data URL, so speaker names never leave the machine.
 */
function defaultAvatarUrl(name, size = 512) {
  const initials =
    String(name || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => Array.from(word)[0])
      .join("")
      .toUpperCase() || "?";
  const px = Math.round(Number(size)) || 512;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 100 100">` +
    `<rect width="100" height="100" fill="#6366f1"/>` +
    `<text x="50" y="50" dy=".35em" text-anchor="middle" font-family="sans-serif" font-size="40" font-weight="700" fill="#fff">${escapeHtml(initials)}</text>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

let generatedIdCounter = 0;

/** Unique-enough id such as "spk-1760000000000-3k9x". */
function generateId(prefix) {
  generatedIdCounter += 1;
  return `${prefix}-${Date.now()}-${generatedIdCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Coerces a string/number/boolean to a trimmed string of at most `max` characters. Objects become ''. */
function cleanText(value, max) {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return "";
  return String(value).trim().slice(0, max);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Returns a speaker in the stored shape {id, fullName, title, mic, micType, photo, notes}, or null when `raw` is not
 * an object or has no name. Unknown keys are dropped. A missing id is left empty (normalizeSpeakers fills it in).
 */
function normalizeSpeaker(raw) {
  if (!isPlainObject(raw)) return null;
  const fullName = cleanText(raw.fullName, FIELD_LIMITS.name);
  if (!fullName) return null;
  return {
    id: cleanText(raw.id, FIELD_LIMITS.id),
    fullName,
    title: cleanText(raw.title, FIELD_LIMITS.title),
    mic: cleanText(raw.mic, FIELD_LIMITS.mic),
    micType: safeMicType(raw.micType),
    photo: safeUrl(raw.photo, { allowData: true }) || defaultAvatarUrl(fullName),
    notes: cleanText(raw.notes, FIELD_LIMITS.notes),
  };
}

/** Normalizes a list of speakers: drops invalid rows and gives every speaker a unique id. Non-arrays give []. */
function normalizeSpeakers(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const result = [];
  for (const raw of list) {
    const spk = normalizeSpeaker(raw);
    if (!spk) continue;
    if (!spk.id || seen.has(spk.id)) spk.id = generateId("spk");
    seen.add(spk.id);
    result.push(spk);
  }
  return result;
}

/** Returns a mic inventory item {name, type}, or null when it is not an object or has no name. */
function normalizeMicItem(raw) {
  if (!isPlainObject(raw)) return null;
  const name = cleanText(raw.name, FIELD_LIMITS.mic);
  if (!name) return null;
  return { name, type: safeMicType(raw.type) };
}

/** Normalizes a mic inventory. Returns null when `list` is not an array, so callers can fall back to defaults. */
function normalizeMicInventory(list) {
  if (!Array.isArray(list)) return null;
  return list.map(normalizeMicItem).filter(Boolean);
}

/**
 * Returns a project {id, title, speakers, micInventory, lastModified}, or null when `raw` is not an object.
 * `defaultMicInventory` (a function) supplies the inventory when the project has none.
 */
function normalizeProject(raw, { defaultMicInventory = () => [] } = {}) {
  if (!isPlainObject(raw)) return null;
  const lastModified = cleanText(raw.lastModified, 40);
  return {
    id: cleanText(raw.id, FIELD_LIMITS.id) || generateId("proj"),
    title: cleanText(raw.title, FIELD_LIMITS.projectTitle) || DEFAULT_PROJECT_TITLE,
    speakers: normalizeSpeakers(raw.speakers),
    micInventory: normalizeMicInventory(raw.micInventory) || defaultMicInventory(),
    lastModified: lastModified && !isNaN(Date.parse(lastModified)) ? lastModified : new Date().toISOString(),
  };
}

/** Normalizes the projects registry: drops invalid entries and makes project ids unique. Non-arrays give []. */
function normalizeProjects(list, options) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const result = [];
  for (const raw of list) {
    const proj = normalizeProject(raw, options);
    if (!proj) continue;
    if (seen.has(proj.id)) proj.id = generateId("proj");
    seen.add(proj.id);
    result.push(proj);
  }
  return result;
}

/**
 * RFC 4180 style CSV parser. Handles quoted fields (with commas, newlines and "" escapes), CRLF or LF line ends
 * and a leading BOM. A quote that does not start a field is kept as a literal character. Returns an array of rows,
 * each an array of strings.
 */
function parseCsv(text) {
  let src = String(text ?? "");
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);

  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let atFieldStart = true;

  const endField = () => {
    row.push(field);
    field = "";
    atFieldStart = true;
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"' && atFieldStart) {
      inQuotes = true;
      atFieldStart = false;
    } else if (ch === ",") {
      endField();
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      endRow();
    } else {
      field += ch;
      atFieldStart = false;
    }
  }
  // Last row without a trailing newline
  if (field !== "" || row.length > 0 || !atFieldStart) endRow();
  return rows;
}

// Spreadsheet apps (Excel, LibreOffice, Google Sheets) run a cell that starts with one of these characters as a formula
const CSV_FORMULA_START = /^[=+\-@\t\r]/;

/**
 * Quotes one CSV value (always quoted, quotes doubled), matching the app's export format. A value a spreadsheet would
 * run as a formula (e.g. "=HYPERLINK(...)" from an imported file) gets a leading apostrophe so it is shown as text
 * (OWASP CSV injection advice); csvUnescapeFormula() removes that apostrophe again on import.
 */
function csvQuote(value) {
  let text = String(value ?? "");
  if (CSV_FORMULA_START.test(text)) text = "'" + text;
  return `"${text.replace(/"/g, '""')}"`;
}

/** Reverses the formula guard of csvQuote(): "'=SUM(1)" becomes "=SUM(1)". Other values are returned unchanged. */
function csvUnescapeFormula(value) {
  const text = String(value ?? "");
  return text.startsWith("'") && CSV_FORMULA_START.test(text.slice(1)) ? text.slice(1) : text;
}

// Field names that hold (or look like they hold) a token or API key. Secrets live only in the encrypted SecretStore
// (desktop app); these keys are removed from anything stored, imported, restored or exported.
const SECRET_FIELD_NAMES = [
  "savedAccessToken",
  "accessToken",
  "access_token",
  "apiKey",
  "api_key",
  "gsearchApiKey",
  "token",
  "clientSecret",
  "client_secret",
];

/** Deep copy of plain data without any secret-named keys (case-insensitive). Arrays and nested objects included. */
function stripSecretFields(value) {
  if (Array.isArray(value)) return value.map(stripSecretFields);
  if (!isPlainObject(value)) return value;
  const secretNames = SECRET_FIELD_NAMES.map((n) => n.toLowerCase());
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (secretNames.includes(key.toLowerCase())) continue;
    out[key] = stripSecretFields(item);
  }
  return out;
}

// Backup folder files: only these names are written, listed and restored. Keep in sync with SYNC_FILE_NAME in
// src/main/sync-folder.js (the desktop app checks it again in the main process).
const SYNC_FILE_NAME_PATTERN = /^(Backup|RunSheet)_[A-Za-z0-9_-]{1,100}\.(json|csv)$/;
const SYNC_MAX_BYTES = 5 * 1024 * 1024;
// The app's own subfolder inside the folder the user picks
const SYNC_SUBFOLDER = "Speaker Photo Directory";

/** True for a file name the backup folder may hold (Backup_<title>.json, RunSheet_<title>.csv). */
function isSyncFileName(name) {
  return typeof name === "string" && SYNC_FILE_NAME_PATTERN.test(name);
}

/** Backup file name for a project title: `syncFileName("Backup", "Gala 2026", "json")` -> "Backup_Gala_2026.json". */
function syncFileName(prefix, title, extension) {
  const clean = String(title ?? "")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 100);
  return `${prefix}_${clean || "Speaker_Directory"}.${extension}`;
}

/** The stored backup-folder settings (spd_sync_folder_v1): only {autoSync, lastSyncTime}, never a path or handle. */
function normalizeSyncConfig(raw) {
  const src = isPlainObject(raw) ? raw : {};
  return {
    autoSync: src.autoSync !== false,
    lastSyncTime: cleanText(src.lastSyncTime, 40) || null,
  };
}
