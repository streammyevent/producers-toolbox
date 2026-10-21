const test = require("node:test");
const assert = require("node:assert");
const api = require("../api.js");

/** A ToolContext whose fetchPublic returns `res` (or throws `err`) and records the call. */
function ctxWith(res, err) {
  const calls = [];
  const ctx = {
    toolId: "quote-pricer",
    net: {
      fetchPublic: async (url, options) => {
        calls.push({ url, options });
        if (err) throw err;
        return { ok: true, status: 200, url, headers: {}, ...res };
      },
    },
  };
  return { ctx, calls };
}

test("product.fetch extracts name and price, with a capped, truncated fetch", async () => {
  const html =
    '<meta property="og:title" content="Example Cable"><meta property="product:price:amount" content="9,95">';
  const { ctx, calls } = ctxWith({ body: Buffer.from(html) });
  const data = await api["product.fetch"](ctx, "https://shop.example/cable");
  assert.deepStrictEqual(data, {
    name: "Example Cable",
    price: 9.95,
    currency: null,
    vatIncluded: null,
    source: "meta",
  });
  assert.strictEqual(calls[0].url, "https://shop.example/cable");
  assert.strictEqual(calls[0].options.maxBytes, 3 * 1024 * 1024);
  assert.strictEqual(calls[0].options.truncate, true);
});

test("product.fetch turns failures into a message for the user", async () => {
  const blocked = ctxWith(null, new Error("That address is not allowed."));
  assert.deepStrictEqual(await api["product.fetch"](blocked.ctx, "http://192.168.1.1/"), {
    error: "That address is not allowed.",
  });
  const forbidden = ctxWith({ ok: false, status: 403, body: Buffer.alloc(0) });
  assert.match((await api["product.fetch"](forbidden.ctx, "https://shop.example/")).error, /403/);
  const empty = ctxWith({ body: Buffer.from("<p>nothing</p>") });
  assert.match((await api["product.fetch"](empty.ctx, "https://shop.example/")).error, /No product/);
});
