// @ts-check
"use strict";
// Main-process API for Quote Pricer (see apps/desktop/src/types/toolbox.d.ts). Product pages are fetched here because
// a page cannot read other sites directly.
const { extractProduct } = require("./lib/extract.js");

const MAX_BYTES = 3 * 1024 * 1024;
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "nl-NL,nl;q=0.9,en;q=0.8",
};

module.exports = {
  /**
   * Name and price from a product page, or { error } with a message for the user.
   * @param {ToolContext} ctx
   * @param {unknown} url
   */
  async "product.fetch"(ctx, url) {
    try {
      const res = await ctx.net.fetchPublic(String(url || ""), {
        headers: HEADERS,
        maxBytes: MAX_BYTES,
        truncate: true,
        timeoutMs: 12000,
      });
      if (!res.ok) {
        return {
          error: "The site answered " + res.status + (res.status === 403 ? " (it blocks automated requests)." : "."),
        };
      }
      const data = extractProduct(res.body.toString("utf8"));
      if (data.name == null && data.price == null) return { error: "No product name or price found on that page." };
      return data;
    } catch (e) {
      return { error: e.message || "Could not fetch that page." };
    }
  },
};
