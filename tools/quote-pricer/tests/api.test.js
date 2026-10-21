// Run: npm test
const test = require("node:test");
const assert = require("node:assert");
const sdk = { netGuard: require("../../../apps/desktop/src/main/net-guard.js") };
const { handle } = require("../api.js");

const ctx = { toolId: "quote-pricer", sdk };

test("/api/product returns an error object for a private URL", async () => {
  const req = new Request("app://quote-pricer/api/product?url=" + encodeURIComponent("http://192.168.1.1/"), {
    headers: { origin: "app://quote-pricer" },
  });
  const res = await handle(req, "/api/product", ctx);
  assert.strictEqual(res.status, 200);
  assert.match((await res.json()).error, /not allowed/);
});

test("/api/product rejects a foreign origin", async () => {
  const req = new Request("app://quote-pricer/api/product?url=https%3A%2F%2Fexample.com", {
    headers: { origin: "https://evil.example" },
  });
  const res = await handle(req, "/api/product", ctx);
  assert.strictEqual(res.status, 403);
});

test("unknown paths fall through", async () => {
  assert.strictEqual(await handle(new Request("app://quote-pricer/api/x"), "/api/x", ctx), null);
});
