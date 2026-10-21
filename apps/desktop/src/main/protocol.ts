// app:// serves files only: app://shell/ is the launcher, app://<tool id>/ is that tool's web/ folder.
// Nothing here has side effects, so a page cannot trigger anything by loading a URL. Tools reach their
// main-process code through IPC (ipc.ts), which knows who is calling.
import fs from "node:fs/promises";
import path from "node:path";
import { protocol } from "electron";
import { safeJoin } from "./manifest";
import { rendererDir } from "./paths";
import { getTool } from "./tools";

const LAUNCHER_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' app: data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
].join("; ");

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
};

const text = (status: number, body: string) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

/** Must run before the app is ready. */
export function registerScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}

export function handleProtocol(): void {
  protocol.handle("app", async (request) => {
    if (request.method !== "GET" && request.method !== "HEAD") return text(405, "Method not allowed");
    const url = new URL(request.url);
    let rel: string;
    try {
      rel = decodeURIComponent(url.pathname);
    } catch {
      return text(400, "Bad request");
    }
    if (rel.endsWith("/")) rel += "index.html";

    const tool = url.host === "shell" ? null : getTool(url.host);
    const site =
      url.host === "shell" ? { dir: rendererDir(), csp: LAUNCHER_CSP } : tool && { dir: tool.webDir, csp: tool.csp };
    if (!site) return text(404, "Not found");
    const file = safeJoin(site.dir, rel);
    if (!file) return text(403, "Forbidden");

    let body: Buffer;
    try {
      body = await fs.readFile(file);
    } catch {
      return text(404, "Not found");
    }
    return new Response(request.method === "HEAD" ? null : new Uint8Array(body), {
      status: 200,
      headers: {
        "content-type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
        "content-security-policy": site.csp,
        "x-content-type-options": "nosniff",
        "cache-control": "no-cache",
      },
    });
  });
}
