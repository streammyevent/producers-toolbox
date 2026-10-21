const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { seal } = require("../out/creds.js");
const api = require("../api.js");

const LOGINS = { switchUser: "admin", switchPass: "switch-pass", unifiUser: "audit", unifiPass: "unifi-pass" };

/** A ToolContext with an in-memory secret store and a temp data folder. */
function makeCtx(t, stored = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "nt-test-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const secrets = new Map(Object.entries(stored));
  return {
    secrets,
    ctx: {
      toolId: "network-tool",
      dataDir,
      documentsDir: dataDir,
      folder: null,
      secrets: { get: (n) => secrets.get(n) ?? null, set: (n, v) => (secrets.set(n, v), true) },
      net: { fetchPublic: () => Promise.reject(new Error("no public fetches")) },
    },
  };
}

test("api.js exposes only functions", () => {
  assert.ok(Object.values(api).every((fn) => typeof fn === "function"));
});

test("a crew code file stores the four logins", async (t) => {
  const { ctx, secrets } = makeCtx(t);
  const file = await seal(LOGINS, "flypack-123");
  await assert.rejects(api["creds.import"](ctx, file, "wrong-code"), /Wrong crew code/);
  assert.strictEqual(secrets.size, 0);
  assert.strictEqual(await api["creds.import"](ctx, file, "flypack-123"), true);
  assert.deepStrictEqual(Object.fromEntries(secrets), LOGINS);
});

test("anything else is refused before decrypting", async (t) => {
  const { ctx, secrets } = makeCtx(t);
  await assert.rejects(api["creds.import"](ctx, "x".repeat(5000), "code"), /not a crew code file/);
  await assert.rejects(api["creds.import"](ctx, { salt: 1 }, "code"), /not a crew code file/);
  await assert.rejects(api["creds.import"](ctx, "{}", "code"), /Wrong crew code/);
  const partial = await seal({ ...LOGINS, unifiPass: "" }, "flypack-123");
  await assert.rejects(api["creds.import"](ctx, partial, "flypack-123"), /incomplete/);
  assert.strictEqual(secrets.size, 0);
});

test("scans and port changes need the logins", async (t) => {
  const { ctx } = makeCtx(t);
  await assert.rejects(api["audit.run"](ctx), /No logins/);
  await assert.rejects(api["port.change"](ctx, "SWITCH01", "ether5", 60), /No logins/);
});

test("a port change needs a switch from the last scan", async (t) => {
  const { ctx } = makeCtx(t, LOGINS);
  await assert.rejects(api["port.change"](ctx, "SWITCH01", "ether5", 60), /not a RouterOS switch in the last scan/);
});

test("learning without a scan adds nothing and writes nothing", (t) => {
  const { ctx } = makeCtx(t);
  assert.deepStrictEqual(api["equipment.learn"](ctx), { added: 0 });
  assert.deepStrictEqual(fs.readdirSync(ctx.dataDir), []);
});
