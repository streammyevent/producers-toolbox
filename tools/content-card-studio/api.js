// @ts-check
"use strict";
// Main-process API for Content Card Studio (see apps/desktop/src/types/toolbox.d.ts): the shared-drive folder, PNG
// exports, read-only Rentman access and fetching webshop pages. The Rentman token stays in the main process: the
// page never sends it, and it only ever goes to api.rentman.net.
const fs = require("fs");
const path = require("path");

const UA = "ContentCardStudio";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const RENTMAN = "https://api.rentman.net";
// GET only, and only what the card maker reads: equipment, a set's contents and file (photo) metadata.
const RENTMAN_PATH = /^\/(equipment(\/\d+\/equipmentsetscontent)?|files\/\d+)$/;
const SUBDIRS = ["gear-database", path.join("gear-database", "photos"), "cases", "branding", "exports"];
const MAX_JSON_BYTES = 50 * 1024 * 1024;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_PNG_BYTES = 30 * 1024 * 1024;
const PHOTO_TYPES = { png: "png", jpeg: "jpg", jpg: "jpg", webp: "webp", gif: "gif" };
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IMAGE_CACHE_SIZE = 200;

/** A plain file name: letters, digits, dash and underscore only, never a Windows device name. */
function safeName(value, fallback) {
  const name = String(value || fallback)
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 100);
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(name) ? `_${name}` : name;
}

// ---- settings (the folder itself is chosen in a dialog through window.toolbox.folder) ----

const configFile = (ctx) => path.join(ctx.dataDir, "storage_config.json");

function readConfig(ctx) {
  try {
    const raw = JSON.parse(fs.readFileSync(configFile(ctx), "utf8"));
    return { enabled: raw.enabled !== false, autoSync: raw.autoSync !== false, lastSync: String(raw.lastSync || "") };
  } catch {
    return { enabled: true, autoSync: true, lastSync: "" };
  }
}

function writeConfig(ctx, cfg) {
  fs.mkdirSync(ctx.dataDir, { recursive: true });
  fs.writeFileSync(configFile(ctx), JSON.stringify(cfg, null, 2), "utf8");
}

/** The shared-drive folder with its subfolders, or null when none is chosen or it is not reachable. */
function driveFolder(ctx) {
  let base;
  try {
    base = ctx.folder.requireFolder();
  } catch {
    return null;
  }
  for (const sub of SUBDIRS) fs.mkdirSync(path.join(base, sub), { recursive: true });
  return base;
}

function requireDrive(ctx) {
  const base = driveFolder(ctx);
  if (!base) throw new Error("The Shared Drive folder is not available. Choose it under Shared Drive.");
  return base;
}

function configView(ctx) {
  const cfg = readConfig(ctx);
  const { folder, accessible } = ctx.folder.status();
  return { ...cfg, drivePath: folder, isAccessible: accessible };
}

/** Parses JSON sent by the page, with a size limit. */
function parseJson(text, what) {
  if (typeof text !== "string" || text.length > MAX_JSON_BYTES) throw new Error(`Invalid ${what}`);
  return JSON.parse(text);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

// ---- Rentman ----

async function rentmanFetch(ctx, url, maxBytes) {
  const token = ctx.secrets.get("rentmanToken");
  if (!token) throw new Error("No Rentman token saved.");
  return ctx.net.fetchPublic(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "User-Agent": UA },
    maxBytes,
    timeoutMs: 20000,
  });
}

const imageCache = new Map(); // url -> { type, data }

function remember(url, image) {
  imageCache.delete(url);
  imageCache.set(url, image);
  if (imageCache.size > IMAGE_CACHE_SIZE) imageCache.delete(imageCache.keys().next().value);
}

module.exports = {
  /** @param {ToolContext} ctx */
  "storage.getConfig"(ctx) {
    return configView(ctx);
  },

  /** @param {ToolContext} ctx @param {{ enabled?: unknown, autoSync?: unknown } | null} patch */
  "storage.setConfig"(ctx, patch) {
    const cfg = readConfig(ctx);
    if (patch && typeof patch === "object") {
      if (typeof patch.enabled === "boolean") cfg.enabled = patch.enabled;
      if (typeof patch.autoSync === "boolean") cfg.autoSync = patch.autoSync;
    }
    cfg.lastSync = new Date().toISOString();
    writeConfig(ctx, cfg);
    driveFolder(ctx);
    return configView(ctx);
  },

  /** The gear database (JSON text of an array); its base64 photos are also written out as image files. */
  "storage.saveDatabase"(ctx, json) {
    const items = parseJson(json, "gear database");
    if (!Array.isArray(items)) throw new Error("Invalid gear database");
    const base = requireDrive(ctx);
    fs.writeFileSync(path.join(base, "gear-database", "gear_inventory.json"), json, "utf8");
    for (const item of items) {
      const m = item && typeof item.image === "string" && item.image.match(/^data:image\/([a-z]+);base64,(.+)$/i);
      const ext = m && PHOTO_TYPES[m[1].toLowerCase()];
      if (!ext) continue; // only plain raster images, never SVG or anything that could run
      const photo = Buffer.from(m[2], "base64");
      if (photo.length > MAX_IMAGE_BYTES) continue;
      const name = safeName(item.code || item.name || item.id, "gear");
      fs.writeFileSync(path.join(base, "gear-database", "photos", `${name}.${ext}`), photo);
    }
    return { success: true };
  },

  /** One saved card (JSON text of an object). */
  "storage.saveCase"(ctx, json) {
    const data = parseJson(json, "card");
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid card");
    const base = requireDrive(ctx);
    const fileName = `${safeName(data.title || data.name, "case")}.json`;
    fs.writeFileSync(path.join(base, "cases", fileName), json, "utf8");
    return { success: true, fileName };
  },

  /** Everything on the drive: the gear database and all saved cards. */
  "storage.syncAll"(ctx) {
    const base = requireDrive(ctx);
    const gearDatabase = readJson(path.join(base, "gear-database", "gear_inventory.json"), []);
    let cases = [];
    try {
      cases = fs
        .readdirSync(path.join(base, "cases"))
        .filter((f) => f.endsWith(".json"))
        .map((f) => readJson(path.join(base, "cases", f), null))
        .filter(Boolean);
    } catch {
      // no cases yet
    }
    return { gearDatabase, cases };
  },

  /** An exported card (PNG data URL): saved to Documents and, when the drive is on, to its exports folder. */
  "storage.saveExport"(ctx, filename, dataUrl) {
    const png = Buffer.from(String(dataUrl || "").replace(/^data:image\/png;base64,/, ""), "base64");
    if (png.length > MAX_PNG_BYTES || !png.subarray(0, 8).equals(PNG_MAGIC)) throw new Error("Not a PNG image");
    const name = `${safeName(String(filename || "").replace(/\.png$/i, ""), "card")}.png`;
    const local = path.join(ctx.documentsDir, "Content Card Studio", "exports");
    fs.mkdirSync(local, { recursive: true });
    fs.writeFileSync(path.join(local, name), png);
    const base = readConfig(ctx).enabled ? driveFolder(ctx) : null;
    if (base) fs.writeFileSync(path.join(base, "exports", name), png);
    return { success: true, fileName: name, onDrive: !!base };
  },

  /** Read-only Rentman API call, e.g. "/equipment?limit=10". Returns the parsed JSON. */
  async "rentman.get"(ctx, endpoint) {
    const url = new URL(String(endpoint || ""), RENTMAN);
    if (url.origin !== RENTMAN || !RENTMAN_PATH.test(url.pathname))
      throw new Error("This Rentman endpoint is not allowed.");
    const res = await rentmanFetch(ctx, url.href, 20 * 1024 * 1024);
    if (!res.ok) throw new Error(`Rentman API (${res.status})`);
    return JSON.parse(res.body.toString("utf8"));
  },

  /** An image for a card: a Rentman file (resolved with the token) or a public image URL. */
  async "rentman.image"(ctx, url) {
    const key = String(url || "");
    const cached = imageCache.get(key);
    if (cached) return cached;
    let target = new URL(key);
    if (target.origin === RENTMAN) {
      if (!/^\/files\/\d+$/.test(target.pathname)) throw new Error("Not a Rentman file");
      const meta = await rentmanFetch(ctx, target.href, 1024 * 1024);
      const body = meta.ok ? JSON.parse(meta.body.toString("utf8")) : null;
      const resolved = body && body.data && (body.data.url || body.data.proxy_url);
      if (!resolved) throw new Error("Image not found in Rentman");
      target = new URL(resolved);
    }
    const res = await ctx.net.fetchPublic(target.href, {
      headers: { "User-Agent": UA },
      maxBytes: MAX_IMAGE_BYTES,
      timeoutMs: 20000,
    });
    const type = String(res.headers["content-type"] || "").split(";")[0];
    if (!res.ok || !/^image\/(png|jpeg|gif|webp|svg\+xml)$/.test(type)) throw new Error("Not an image");
    const image = { type, data: new Uint8Array(res.body) };
    remember(key, image);
    return image;
  },

  /** The HTML (or JSON) of a public webshop page, for importing a product. */
  async "webshop.fetch"(ctx, url) {
    const res = await ctx.net.fetchPublic(String(url || ""), {
      headers: { "User-Agent": BROWSER_UA, Accept: "text/html,application/xhtml+xml,application/json" },
      maxBytes: 3 * 1024 * 1024,
      truncate: true,
      timeoutMs: 15000,
    });
    if (!res.ok) throw new Error(`The site answered ${res.status}.`);
    return res.body.toString("utf8");
  },
};
