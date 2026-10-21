const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createSecretStore } = require("../../out/main/secrets");

// Stand-in for Electron's safeStorage: reversible but not plaintext.
const fake = (available = true, backend = "gnome_libsecret") => ({
  isEncryptionAvailable: () => available,
  getSelectedStorageBackend: () => backend,
  encryptString: (s) => Buffer.from(Buffer.from(s).toString("hex").split("").reverse().join("")),
  decryptString: (b) => Buffer.from(b.toString().split("").reverse().join(""), "hex").toString(),
});

const smoelenboek = { id: "smoelenboek", secrets: ["gsearchApiKey"] };
const quotePricer = { id: "quote-pricer", secrets: ["gsearchApiKey"] };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "tb-secrets-"));

test("a stored secret round-trips and is never written as plaintext", (t) => {
  const dir = tmp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = createSecretStore({ dir, safeStorage: fake() });
  assert.strictEqual(store.set(smoelenboek, "gsearchApiKey", "AIzaSy-example-secret"), true);
  assert.deepStrictEqual(store.getAll(smoelenboek), {
    available: true,
    values: { gsearchApiKey: "AIzaSy-example-secret" },
  });
  assert.strictEqual(store.get(smoelenboek, "gsearchApiKey"), "AIzaSy-example-secret");
  const file = path.join(dir, "smoelenboek.json");
  assert.ok(!fs.readFileSync(file, "utf8").includes("AIzaSy-example-secret"));
  if (process.platform !== "win32") assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600);
});

test("secrets are separate per tool, and remove deletes them", (t) => {
  const dir = tmp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = createSecretStore({ dir, safeStorage: fake() });
  store.set(smoelenboek, "gsearchApiKey", "mine");
  assert.deepStrictEqual(store.getAll(quotePricer).values, {});
  store.remove(smoelenboek, "gsearchApiKey");
  assert.strictEqual(store.get(smoelenboek, "gsearchApiKey"), null);
});

test("only names the tool lists are accepted, and values are checked", (t) => {
  const dir = tmp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = createSecretStore({ dir, safeStorage: fake() });
  assert.throws(() => store.set(smoelenboek, "rentmanToken", "x"), /Unknown secret name/);
  assert.throws(() => store.set(smoelenboek, "../evil", "x"), /Unknown secret name/);
  assert.throws(() => store.set(smoelenboek, "gsearchApiKey", ""), /Invalid secret value/);
  assert.throws(() => store.set(smoelenboek, "gsearchApiKey", "x".repeat(4097)), /Invalid secret value/);
  assert.throws(() => store.set(smoelenboek, "gsearchApiKey", 42), /Invalid secret value/);
});

test("without real OS encryption nothing is stored: no plaintext fallback", (t) => {
  for (const [label, safeStorage, platform] of [
    ["no encryption", fake(false), "darwin"],
    ["Linux basic_text", fake(true, "basic_text"), "linux"],
  ]) {
    const dir = tmp();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const store = createSecretStore({ dir, safeStorage, platform });
    assert.deepStrictEqual(store.getAll(smoelenboek), { available: false, values: {} }, label);
    assert.throws(() => store.set(smoelenboek, "gsearchApiKey", "x"), /not available/, label);
    assert.deepStrictEqual(fs.readdirSync(dir), [], label);
  }
});

test("unreadable values are skipped, and names a tool no longer lists are purged", (t) => {
  const dir = tmp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "smoelenboek.json");
  fs.writeFileSync(
    file,
    JSON.stringify({ version: 1, values: { gsearchApiKey: "!!garbage", gdriveAccessToken: "old" } }),
  );
  const store = createSecretStore({
    dir,
    safeStorage: { ...fake(), decryptString: () => { throw new Error("bad"); } }, // prettier-ignore
  });
  assert.deepStrictEqual(store.getAll(smoelenboek), { available: true, values: {} });
  store.purge(smoelenboek);
  assert.deepStrictEqual(Object.keys(JSON.parse(fs.readFileSync(file, "utf8")).values), ["gsearchApiKey"]);
});
