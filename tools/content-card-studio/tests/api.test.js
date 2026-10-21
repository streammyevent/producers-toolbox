// Run: npm test
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const sdk = { netGuard: require("../../../apps/desktop/src/main/net-guard.js") };
const { handle } = require("../api.js");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ccs-test-"));
const ctx = {
  toolId: "content-card-studio",
  dataDir: path.join(tmp, "data"),
  appDataDir: path.join(tmp, "appdata"),
  documentsDir: path.join(tmp, "docs"),
  sdk,
};
const drive = path.join(tmp, "drive");
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const req = (p, method = "GET", body, headers = {}) =>
  new Request("app://content-card-studio" + p, {
    method,
    headers: { origin: "app://content-card-studio", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const call = (p, method, body, headers) => handle(req(p, method, body, headers), p.split("?")[0], ctx);

test("foreign origin is refused", async () => {
  const res = await handle(
    req("/api/storage/config", "GET", undefined, { origin: "https://evil.example" }),
    "/api/storage/config",
    ctx,
  );
  assert.strictEqual(res.status, 403);
});

test("unknown API falls through", async () => {
  assert.strictEqual(await call("/api/nope", "GET"), null);
});

test("config defaults, then saving a drive path creates the folders", async () => {
  let cfg = await (await call("/api/storage/config", "GET")).json();
  assert.strictEqual(cfg.drivePath, "");
  assert.strictEqual(cfg.isAccessible, false);

  const saved = await (await call("/api/storage/config", "POST", { drivePath: drive, enabled: true })).json();
  assert.strictEqual(saved.isAccessible, true);
  for (const d of ["gear-database", "cases", "branding", "exports"]) assert.ok(fs.existsSync(path.join(drive, d)), d);

  cfg = await (await call("/api/storage/config", "GET")).json();
  assert.strictEqual(cfg.drivePath, drive);
  assert.strictEqual(cfg.isAccessible, true);
});

test("legacy config from the standalone app is migrated once", async () => {
  const c2 = { ...ctx, dataDir: path.join(tmp, "data2") };
  const legacy = path.join(c2.appDataDir, "Content Card Studio");
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(path.join(legacy, "storage_config.json"), JSON.stringify({ drivePath: "X:\\old", enabled: true }));
  const res = await handle(req("/api/storage/config"), "/api/storage/config", c2);
  assert.strictEqual((await res.json()).drivePath, "X:\\old");
  assert.ok(fs.existsSync(path.join(c2.dataDir, "storage_config.json")));
});

test("save-database writes the inventory and photo files", async () => {
  const png = "data:image/png;base64," + Buffer.from("fakepng").toString("base64");
  const res = await call("/api/storage/save-database", "POST", [{ code: "A/1", name: "Amp", image: png }]);
  assert.strictEqual((await res.json()).success, true);
  assert.ok(fs.existsSync(path.join(drive, "gear-database", "gear_inventory.json")));
  assert.strictEqual(fs.readFileSync(path.join(drive, "gear-database", "photos", "A_1.png"), "utf8"), "fakepng");
});

test("save-case then sync-all returns the case and the gear list", async () => {
  await call("/api/storage/save-case", "POST", { title: "Case ../7", items: [] });
  assert.ok(fs.existsSync(path.join(drive, "cases", "Case____7.json")));
  const all = await (await call("/api/storage/sync-all", "GET")).json();
  assert.strictEqual(all.cases.length, 1);
  assert.strictEqual(all.gearDatabase.length, 1);
});

test("download-png keeps the file inside the exports folders", async () => {
  const b64 = "data:image/png;base64," + Buffer.from("imgbytes").toString("base64");
  const res = await call("/api/download-png", "POST", { filename: "..\\..\\evil", base64: b64 });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers.get("content-type"), "image/png");
  assert.strictEqual(Buffer.from(await res.arrayBuffer()).toString(), "imgbytes");
  assert.ok(fs.existsSync(path.join(ctx.documentsDir, "Content Card Studio", "exports", "evil.png")));
  assert.ok(fs.existsSync(path.join(drive, "exports", "evil.png")));
  assert.ok(!fs.existsSync(path.join(tmp, "evil.png")));
});

test("Rentman proxy refuses anything but GET", async () => {
  const res = await call("/api/rentman?endpoint=/equipment", "POST", {});
  assert.strictEqual(res.status, 405);
});

test("the Rentman token is accepted without being written to disk", async () => {
  const res = await call("/api/rentman-token", "POST", { token: "secret-token-123" });
  assert.strictEqual((await res.json()).success, true);
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true }))
      e.isDirectory() ? walk(path.join(d, e.name)) : files.push(path.join(d, e.name));
  })(tmp);
  for (const f of files) assert.ok(!fs.readFileSync(f).includes("secret-token-123"), f);
  await call("/api/rentman-token", "POST", { token: "" });
});

test("Rentman image proxy will not fetch private addresses", async () => {
  const res = await call("/api/rentman-image?url=" + encodeURIComponent("http://127.0.0.1:8085/"), "GET");
  assert.strictEqual(res.status, 502);
  assert.match(await res.text(), /not allowed/);
});
