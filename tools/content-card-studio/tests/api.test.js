const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const api = require("../api.js");

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("rest")]);

/** A ToolContext over a temp folder; `fetches` records every outbound request, `respond` answers it. */
function makeCtx({ token = "TEST_TOKEN", respond = () => ({ status: 404, body: "" }) } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ccs-test-"));
  const drive = path.join(tmp, "drive");
  let chosen = null;
  const fetches = [];
  const ctx = {
    toolId: "content-card-studio",
    dataDir: path.join(tmp, "data"),
    documentsDir: path.join(tmp, "docs"),
    folder: {
      status: () => ({ folder: chosen || "", name: "", accessible: !!chosen }),
      requireFolder: () => {
        if (!chosen) throw new Error("No folder chosen");
        return chosen;
      },
    },
    secrets: { get: (name) => (name === "rentmanToken" ? token : null) },
    net: {
      fetchPublic: async (url, options) => {
        fetches.push({ url, options });
        const r = respond(url);
        const body = Buffer.isBuffer(r.body) ? r.body : Buffer.from(r.body ?? "");
        return { ok: r.status < 300, status: r.status, url, headers: r.headers || {}, body };
      },
    },
  };
  const choose = () => {
    fs.mkdirSync(drive, { recursive: true });
    chosen = drive;
  };
  return { ctx, drive, fetches, choose, cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}

test("storage settings: no folder until one is chosen, then the folder layout is created", (t) => {
  const { ctx, drive, choose, cleanup } = makeCtx();
  t.after(cleanup);
  assert.deepStrictEqual(api["storage.getConfig"](ctx), {
    enabled: true,
    autoSync: true,
    lastSync: "",
    drivePath: "",
    isAccessible: false,
  });
  choose();
  const cfg = api["storage.setConfig"](ctx, { enabled: true, autoSync: false, drivePath: "/somewhere/else" });
  assert.strictEqual(cfg.drivePath, drive, "a path from the page is ignored");
  assert.strictEqual(cfg.autoSync, false);
  for (const sub of ["gear-database/photos", "cases", "branding", "exports"]) {
    assert.ok(fs.existsSync(path.join(drive, sub)), sub);
  }
});

test("saving the gear database writes raster photos only, with safe names", (t) => {
  const { ctx, drive, choose, cleanup } = makeCtx();
  t.after(cleanup);
  assert.throws(() => api["storage.saveDatabase"](ctx, "[]"), /not available/);
  choose();
  const items = [
    { code: "CAB-01", image: "data:image/png;base64," + PNG.toString("base64") },
    { code: "../../evil", image: "data:image/jpeg;base64," + PNG.toString("base64") },
    { code: "run", image: "data:image/exe;base64," + PNG.toString("base64") },
    { code: "vector", image: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" },
    { code: "CON", image: "data:image/webp;base64," + PNG.toString("base64") },
  ];
  api["storage.saveDatabase"](ctx, JSON.stringify(items));
  assert.ok(fs.existsSync(path.join(drive, "gear-database", "gear_inventory.json")));
  assert.deepStrictEqual(fs.readdirSync(path.join(drive, "gear-database", "photos")).sort(), [
    "CAB-01.png",
    "_CON.webp",
    "______evil.jpg",
  ]);
  assert.throws(() => api["storage.saveDatabase"](ctx, '{"not":"a list"}'), /Invalid gear database/);
});

test("cards are saved under a safe file name and read back by syncAll", (t) => {
  const { ctx, drive, choose, cleanup } = makeCtx();
  t.after(cleanup);
  choose();
  const { fileName } = api["storage.saveCase"](ctx, JSON.stringify({ title: "../Rack 1/2", items: [] }));
  assert.strictEqual(fileName, "___Rack_1_2.json");
  assert.ok(fs.existsSync(path.join(drive, "cases", fileName)));
  const all = api["storage.syncAll"](ctx);
  assert.deepStrictEqual(all.cases, [{ title: "../Rack 1/2", items: [] }]);
});

test("exports must be PNG and land in Documents and on the drive", (t) => {
  const { ctx, drive, choose, cleanup } = makeCtx();
  t.after(cleanup);
  choose();
  assert.throws(
    () => api["storage.saveExport"](ctx, "x.png", "data:image/png;base64," + Buffer.from("MZ").toString("base64")),
    /Not a PNG/,
  );
  const res = api["storage.saveExport"](ctx, "../card.png", "data:image/png;base64," + PNG.toString("base64"));
  assert.strictEqual(res.fileName, "___card.png");
  assert.ok(fs.existsSync(path.join(ctx.documentsDir, "Content Card Studio", "exports", "___card.png")));
  assert.ok(fs.existsSync(path.join(drive, "exports", "___card.png")));
});

test("rentman.get only reads allowlisted endpoints from api.rentman.net, with the stored token", async (t) => {
  const { ctx, fetches, cleanup } = makeCtx({ respond: () => ({ status: 200, body: '{"data":[]}' }) });
  t.after(cleanup);
  assert.deepStrictEqual(await api["rentman.get"](ctx, "/equipment?limit=1"), { data: [] });
  assert.strictEqual(fetches[0].url, "https://api.rentman.net/equipment?limit=1");
  assert.strictEqual(fetches[0].options.headers.Authorization, "Bearer TEST_TOKEN");
  for (const bad of ["/contacts", "https://evil.example/equipment", "//evil.example/equipment", "/equipment/1/../2"]) {
    await assert.rejects(() => api["rentman.get"](ctx, bad), /not allowed/, bad);
  }
  assert.strictEqual(fetches.length, 1);
});

test("rentman.image sends the token to Rentman only, never to the image host", async (t) => {
  const { ctx, fetches, cleanup } = makeCtx({
    respond: (url) =>
      url.startsWith("https://api.rentman.net/")
        ? { status: 200, body: JSON.stringify({ data: { url: "https://cdn.example/photo.png" } }) }
        : { status: 200, body: PNG, headers: { "content-type": "image/png" } },
  });
  t.after(cleanup);
  const img = await api["rentman.image"](ctx, "https://api.rentman.net/files/42");
  assert.strictEqual(img.type, "image/png");
  assert.deepStrictEqual(Buffer.from(img.data), PNG);
  assert.deepStrictEqual(
    fetches.map((f) => [f.url, !!f.options.headers.Authorization]),
    [
      ["https://api.rentman.net/files/42", true],
      ["https://cdn.example/photo.png", false],
    ],
  );
  await api["rentman.image"](ctx, "https://api.rentman.net/files/42");
  assert.strictEqual(fetches.length, 2, "served from the cache");
});

test("rentman.image refuses anything that is not an image", async (t) => {
  const { ctx, cleanup } = makeCtx({
    respond: () => ({ status: 200, body: "<html>", headers: { "content-type": "text/html" } }),
  });
  t.after(cleanup);
  await assert.rejects(() => api["rentman.image"](ctx, "https://cdn.example/page"), /Not an image/);
});

test("webshop.fetch returns page text and reports error statuses", async (t) => {
  const { ctx, fetches, cleanup } = makeCtx({
    respond: (url) => (url.endsWith("/ok") ? { status: 200, body: "<title>Product</title>" } : { status: 403 }),
  });
  t.after(cleanup);
  assert.strictEqual(await api["webshop.fetch"](ctx, "https://shop.example/ok"), "<title>Product</title>");
  assert.strictEqual(fetches[0].options.truncate, true);
  await assert.rejects(() => api["webshop.fetch"](ctx, "https://shop.example/blocked"), /403/);
});
