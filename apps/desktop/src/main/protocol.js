const fs = require("fs");
const path = require("path");
const { app, protocol, net } = require("electron");
const { pathToFileURL } = require("url");
const netGuard = require("./net-guard");
const { rendererDir } = require("./paths");
const tools = require("./tool-manager");
// Resolves a request path inside a folder and refuses anything that escapes it.
const { safeJoin } = require("./tool-manifest");

// Must run before app 'ready'.
function registerScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  ]);
}

const text = (status, body) => new Response(body, { status, headers: { "content-type": "text/plain" } });

// Policy for tool pages. Tools use inline scripts and talk to Google, Rentman and product sites,
// so scripts/styles allow 'unsafe-inline' and connections allow https; what it does block is
// eval, plugins, framing by other sites, rebasing and loading scripts from unlisted hosts.
const TOOL_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://accounts.google.com https://cdnjs.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https:",
  "connect-src 'self' data: blob: https:",
  "worker-src 'self' blob:",
  "frame-src https://accounts.google.com https://www.google.com",
  "object-src 'none'",
  "base-uri 'self'",
].join("; ");

// Serve a file from disk; a missing file is a 404, not a protocol error. Tool pages get the CSP.
async function sendFile(file, withCsp) {
  let res;
  try {
    res = await net.fetch(pathToFileURL(file).toString());
  } catch {
    return text(404, "Not found");
  }
  if (!withCsp || !/\.html?$/i.test(file)) return res;
  const headers = new Headers(res.headers);
  headers.set("Content-Security-Policy", TOOL_CSP);
  return new Response(res.body, { status: res.status, headers });
}

// Optional per-tool API: <tool dir>/api.js exports handle(request, pathname, ctx) -> Response | null.
// This replaces the old local servers: the tools keep calling fetch('/api/...').
function loadToolApi(tool) {
  const file = path.join(tool.dir, "api.js");
  return fs.existsSync(file) ? require(file) : null;
}

// What a tool's api.js gets besides the request: its own data folders and the network guard.
function toolContext(id) {
  return {
    toolId: id,
    dataDir: path.join(app.getPath("userData"), "tools", id),
    appDataDir: app.getPath("appData"), // where the old standalone tools kept their data
    documentsDir: path.join(app.getPath("documents"), "Producers Toolbox"),
    sdk: { netGuard },
  };
}

function handleProtocol() {
  protocol.handle("app", async (request) => {
    const url = new URL(request.url);
    const id = url.hostname;
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return text(400, "Bad request");
    }

    if (id === "shell") {
      const file = safeJoin(rendererDir(), pathname === "/" ? "/index.html" : pathname);
      return file ? sendFile(file) : text(403, "Forbidden");
    }

    const tool = tools.getTool(id);
    if (!tool) return text(404, "Unknown tool");

    if (pathname.startsWith("/api/")) {
      const api = loadToolApi(tool);
      if (!api) return text(404, "No such API");
      try {
        const res = await api.handle(request, pathname, toolContext(id));
        return res || text(404, "No such API");
      } catch (err) {
        console.error(`[${id}] API error:`, err);
        return text(500, "Internal error");
      }
    }

    const file = safeJoin(tool.dir, pathname);
    if (!file) return text(403, "Forbidden");
    return sendFile(file, true);
  });
}

module.exports = { registerScheme, handleProtocol };
