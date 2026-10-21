"use strict";
// Main-process API for Content Card Studio. Replaces the old local server (serve.js):
// the page still calls fetch('/api/...') and the shell routes it here.
const fs = require("fs");
const path = require("path");

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const UA = "FlightCaseStudio/0.7";
const SUBDIRS = ["gear-database", path.join("gear-database", "photos"), "cases", "branding", "exports"];

const json = (status, obj) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
const plain = (status, msg) => new Response(msg, { status, headers: { "Content-Type": "text/plain" } });
const safeName = (s, fallback) => String(s || fallback).replace(/[^a-zA-Z0-9_-]/g, "_");

// ---- storage config (per-user, outside the app so updates never wipe it) ----

const paths = (ctx) => ({
  config: path.join(ctx.dataDir, "storage_config.json"),
  exports: path.join(ctx.documentsDir, "Content Card Studio", "exports"),
  // Older homes of the config, newest first: the standalone app, then the "CaseCard Studio" name
  legacy: [
    path.join(ctx.appDataDir, "Content Card Studio", "storage_config.json"),
    path.join(ctx.appDataDir, "CaseCard Studio", "storage_config.json"),
  ],
});

// One-time copy of the standalone app's config, so existing Shared Drive settings carry over.
function migrateLegacyConfig(ctx) {
  const p = paths(ctx);
  try {
    const legacy = p.legacy.find((f) => fs.existsSync(f));
    if (!fs.existsSync(p.config) && legacy) {
      fs.mkdirSync(ctx.dataDir, { recursive: true });
      fs.copyFileSync(legacy, p.config);
    }
  } catch (e) {
    console.error("[content-card-studio] config migration failed:", e.message);
  }
}

function getConfig(ctx) {
  const defaults = {
    enabled: false,
    drivePath: "",
    autoSync: true,
    lastSync: "",
    subfolders: { gearDatabase: "gear-database", cases: "cases", branding: "branding", exports: "exports" },
  };
  try {
    return { ...defaults, ...JSON.parse(fs.readFileSync(paths(ctx).config, "utf-8")) };
  } catch {
    return defaults;
  }
}

function saveConfig(ctx, cfg) {
  fs.mkdirSync(ctx.dataDir, { recursive: true });
  fs.writeFileSync(paths(ctx).config, JSON.stringify(cfg, null, 2), "utf-8");
}

function ensureDriveFolders(base) {
  if (!base) return false;
  try {
    for (const sub of ["", ...SUBDIRS]) fs.mkdirSync(path.join(base, sub), { recursive: true });
    return fs.existsSync(base);
  } catch (e) {
    console.error(`[content-card-studio] cannot prepare ${base}:`, e.message);
    return false;
  }
}

const notAccessible = (drivePath) =>
  json(400, { error: `Shared drive folder is not accessible at path: ${drivePath}` });

// ---- route handlers ----

function configGet(ctx) {
  const cfg = getConfig(ctx);
  return json(200, {
    enabled: cfg.enabled !== false,
    drivePath: cfg.drivePath || "",
    autoSync: cfg.autoSync !== false,
    isAccessible: !!(cfg.drivePath && fs.existsSync(cfg.drivePath)),
    lastSync: cfg.lastSync || "",
    subfolders: cfg.subfolders,
  });
}

async function configPost(request, ctx) {
  const incoming = JSON.parse((await request.text()) || "{}");
  const cfg = getConfig(ctx);
  if (incoming.enabled !== undefined) cfg.enabled = incoming.enabled;
  if (incoming.drivePath !== undefined) cfg.drivePath = String(incoming.drivePath).trim();
  if (incoming.autoSync !== undefined) cfg.autoSync = incoming.autoSync;
  const isAccessible = cfg.drivePath ? ensureDriveFolders(cfg.drivePath) : false;
  cfg.lastSync = new Date().toISOString();
  saveConfig(ctx, cfg);
  return json(200, { success: true, isAccessible, config: cfg });
}

async function saveDatabase(request, ctx) {
  const { drivePath } = getConfig(ctx);
  if (!drivePath || !ensureDriveFolders(drivePath)) return notAccessible(drivePath);
  const body = await request.text();
  const dbFile = path.join(drivePath, "gear-database", "gear_inventory.json");
  fs.writeFileSync(dbFile, body, "utf-8");

  // Base64 equipment photos are also written out as individual image files.
  try {
    const items = JSON.parse(body || "[]");
    if (Array.isArray(items)) {
      const photosDir = path.join(drivePath, "gear-database", "photos");
      for (const item of items) {
        const m = typeof item.image === "string" && item.image.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
        if (!m) continue;
        const ext = m[1] === "jpeg" ? "jpg" : m[1];
        const name = safeName(item.code || item.name || item.id, "gear");
        fs.writeFileSync(path.join(photosDir, `${name}.${ext}`), Buffer.from(m[2], "base64"));
      }
    }
  } catch {
    /* a bad photo must not fail the database save */
  }
  return json(200, { success: true, path: dbFile });
}

async function saveCase(request, ctx) {
  const { drivePath } = getConfig(ctx);
  if (!drivePath || !ensureDriveFolders(drivePath)) return notAccessible(drivePath);
  const body = await request.text();
  const data = JSON.parse(body || "{}");
  const fileName = `${safeName(data.title || data.name, "case")}.json`;
  fs.writeFileSync(path.join(drivePath, "cases", fileName), body, "utf-8");
  return json(200, { success: true, fileName });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return fallback;
  }
}

function syncAll(ctx) {
  const { drivePath } = getConfig(ctx);
  if (!drivePath || !fs.existsSync(drivePath))
    return json(404, { error: `Shared Drive not found at path: ${drivePath}` });
  const gearDatabase = readJson(path.join(drivePath, "gear-database", "gear_inventory.json"), []);
  const casesDir = path.join(drivePath, "cases");
  let cases = [];
  try {
    cases = fs
      .readdirSync(casesDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => readJson(path.join(casesDir, f), null))
      .filter(Boolean);
  } catch {
    /* no cases folder yet */
  }
  return json(200, { success: true, drivePath, gearDatabase, cases });
}

async function downloadPng(request, ctx) {
  const data = JSON.parse((await request.text()) || "{}");
  // Bare file name only, so a crafted name can't write outside the exports folders.
  let filename =
    path
      .basename(String(data.filename || "flightcase_card.png").replace(/\\/g, "/"))
      // eslint-disable-next-line no-control-regex -- control characters are not allowed in file names
      .replace(/[<>:"|?*\x00-\x1f]/g, "_")
      .replace(/^\.+/, "") || "flightcase_card.png";
  if (!filename.endsWith(".png")) filename += ".png";
  let b64 = String(data.base64 || "");
  if (b64.includes(",")) b64 = b64.split(",")[1];
  const img = Buffer.from(b64, "base64");

  const local = paths(ctx).exports;
  fs.mkdirSync(local, { recursive: true });
  fs.writeFileSync(path.join(local, filename), img);

  const { drivePath } = getConfig(ctx);
  if (drivePath && fs.existsSync(drivePath)) {
    const driveExports = path.join(drivePath, "exports");
    fs.mkdirSync(driveExports, { recursive: true });
    fs.writeFileSync(path.join(driveExports, filename), img);
  }
  return new Response(img, {
    status: 200,
    headers: { "Content-Type": "image/png", "Content-Disposition": `attachment; filename="${filename}"` },
  });
}

// ---- Rentman proxies ----

// Strictly read-only: only GET is ever sent to Rentman.
async function rentmanProxy(request, url) {
  if (request.method !== "GET") {
    return json(405, {
      error: "Rentman integration is strictly READ-ONLY. Modifying or editing items in Rentman is not permitted.",
    });
  }
  const endpoint = url.searchParams.get("endpoint") || "/equipment";
  const target = new URL(`https://api.rentman.net${endpoint.startsWith("/") ? "" : "/"}${endpoint}`);
  if (target.hostname !== "api.rentman.net") return json(400, { error: "Bad endpoint" });
  url.searchParams.forEach((v, k) => {
    if (k !== "endpoint") target.searchParams.set(k, v);
  });
  try {
    const up = await fetch(target, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: request.headers.get("authorization") || "",
        "User-Agent": UA,
      },
    });
    return new Response(up.body, {
      status: up.status,
      headers: { "Content-Type": up.headers.get("content-type") || "application/json" },
    });
  } catch (e) {
    return json(502, { error: e.message });
  }
}

const imageCache = new Map(); // url -> { type, buf }

// The page registers its Rentman token here (app:// pages have no cookies). Memory only, never saved.
let rentmanToken = "";
async function setRentmanToken(request) {
  const { token } = JSON.parse((await request.text()) || "{}");
  rentmanToken = typeof token === "string" ? token : "";
  return json(200, { success: true });
}

async function fetchImage(urlStr, netGuard) {
  const res = await netGuard.guardedFetch(urlStr, {
    signal: AbortSignal.timeout(20000),
    headers: { "User-Agent": UA },
  });
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_IMAGE_BYTES) throw new Error("Image too large");
  return { status: res.status, type: res.headers.get("content-type") || "image/jpeg", buf };
}

const imageResponse = (status, type, buf) =>
  new Response(buf, { status, headers: { "Content-Type": type, "Cache-Control": "public, max-age=86400" } });

async function rentmanImage(request, url, ctx) {
  const imgUrl = url.searchParams.get("url");
  if (!imgUrl) return plain(400, "Missing url");
  if (imageCache.has(imgUrl)) {
    const c = imageCache.get(imgUrl);
    return imageResponse(200, c.type, c.buf);
  }
  try {
    let target = imgUrl;
    // /files/{id} on Rentman's API resolves to a CDN URL. The token only ever goes to Rentman itself.
    const u = new URL(imgUrl);
    if (u.protocol === "https:" && u.hostname === "api.rentman.net" && u.pathname.startsWith("/files/")) {
      const token = rentmanToken || (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
      const headers = { "User-Agent": UA };
      if (token) headers.Authorization = `Bearer ${token}`;
      const meta = await fetch(u, { headers, signal: AbortSignal.timeout(15000) });
      const body = await meta.json().catch(() => null);
      target = body?.data?.url || body?.data?.proxy_url;
      if (!target) return json(404, { error: "Image URL not found in Rentman file response" });
    }
    const img = await fetchImage(target, ctx.sdk.netGuard);
    if (img.status === 200 && img.buf.length > 0) imageCache.set(imgUrl, { type: img.type, buf: img.buf });
    return imageResponse(img.status, img.type, img.buf);
  } catch (e) {
    return plain(502, e.message);
  }
}

// ---- entry point ----

async function handle(request, pathname, ctx) {
  // Only this tool's own page may call the API (no CORS headers are ever sent).
  const origin = request.headers.get("origin");
  if (origin && origin !== `app://${ctx.toolId}`) return plain(403, "Forbidden origin");
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });

  const url = new URL(request.url);
  migrateLegacyConfig(ctx);
  try {
    if (pathname === "/api/rentman" || pathname.startsWith("/api/rentman/")) return await rentmanProxy(request, url);
    if (pathname === "/api/rentman-image") return await rentmanImage(request, url, ctx);
    if (pathname === "/api/rentman-token" && request.method === "POST") return await setRentmanToken(request);
    if (pathname === "/api/storage/config") {
      if (request.method === "GET") return configGet(ctx);
      if (request.method === "POST") return await configPost(request, ctx);
    }
    if (pathname === "/api/storage/save-database" && request.method === "POST") return await saveDatabase(request, ctx);
    if (pathname === "/api/storage/save-case" && request.method === "POST") return await saveCase(request, ctx);
    if (pathname === "/api/storage/sync-all" && request.method === "GET") return syncAll(ctx);
    if (pathname === "/api/download-png" && request.method === "POST") return await downloadPng(request, ctx);
  } catch (e) {
    return json(500, { error: e.message });
  }
  return null;
}

module.exports = { handle };
