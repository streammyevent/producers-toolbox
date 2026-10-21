"use strict";
// Main-process API for Quote Pricer. Replaces the old local server: the page still calls
// fetch('/api/product?url=...') and the shell routes it here. Fetching happens server-side
// because browsers can't read other sites directly.
const { extractProduct } = require("./lib/extract.js");

const MAX_BYTES = 3 * 1024 * 1024;

async function fetchPage(urlStr, netGuard) {
  const res = await netGuard.guardedFetch(urlStr, {
    signal: AbortSignal.timeout(12000),
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "nl-NL,nl;q=0.9,en;q=0.8",
    },
  });
  if (!res.ok)
    throw new Error(
      "The site answered " + res.status + (res.status === 403 ? " (it blocks automated requests)." : "."),
    );
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.subarray(0, MAX_BYTES).toString("utf8");
}

const json = (code, obj) =>
  new Response(JSON.stringify(obj), {
    status: code,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

async function handle(request, pathname, ctx) {
  if (pathname !== "/api/product") return null;
  // Only this tool's own page may call this.
  const origin = request.headers.get("origin");
  if (origin && origin !== `app://${ctx.toolId}`) return json(403, { error: "Forbidden" });
  try {
    const html = await fetchPage(new URL(request.url).searchParams.get("url") || "", ctx.sdk.netGuard);
    const data = extractProduct(html);
    if (data.name == null && data.price == null)
      return json(200, { error: "No product name or price found on that page." });
    return json(200, data);
  } catch (e) {
    return json(200, {
      error:
        e.name === "TimeoutError" ? "The site took too long to answer." : e.message || "Could not fetch that page.",
    });
  }
}

module.exports = { handle };
