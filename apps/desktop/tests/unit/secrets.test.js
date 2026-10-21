// Run: npm test
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createSecretStore } = require("../../src/main/secrets");

// Stand-in for Electron's safeStorage: reversible but not plaintext.
const fake = (available = true) => ({
  isEncryptionAvailable: () => available,
  encryptString: (s) => Buffer.from(Buffer.from(s).toString("hex").split("").reverse().join("")),
  decryptString: (b) => Buffer.from(b.toString().split("").reverse().join(""), "hex").toString(),
});

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "secrets-test-"));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test("a stored secret round-trips and is not written as plaintext", () => {
  const store = createSecretStore({ dir, safeStorage: fake() });
  assert.strictEqual(store.set("smoelenboek", "key", "AIzaSy-very-secret"), true);
  assert.strictEqual(store.get("smoelenboek", "key"), "AIzaSy-very-secret");
  for (const f of fs.readdirSync(dir))
    assert.ok(!fs.readFileSync(path.join(dir, f), "utf8").includes("AIzaSy-very-secret"));
});

test("secrets are separate per tool; empty value and remove delete them", () => {
  const store = createSecretStore({ dir, safeStorage: fake() });
  store.set("quote-pricer", "key", "other");
  assert.strictEqual(store.get("quote-pricer", "key"), "other");
  assert.strictEqual(store.get("smoelenboek", "key"), "AIzaSy-very-secret");
  store.set("quote-pricer", "key", "");
  assert.strictEqual(store.get("quote-pricer", "key"), null);
  store.remove("quote-pricer", "key");
  assert.strictEqual(store.get("quote-pricer", "key"), null);
});

test("without OS encryption nothing is stored and reads return null", () => {
  const d = fs.mkdtempSync(path.join(dir, "no-enc-"));
  const store = createSecretStore({ dir: d, safeStorage: fake(false) });
  assert.strictEqual(store.set("smoelenboek", "key", "x"), false);
  assert.deepStrictEqual(fs.readdirSync(d), []);
  assert.strictEqual(store.get("smoelenboek", "key"), null);
});

test("bad tool ids and secret names are rejected (no path traversal)", () => {
  const store = createSecretStore({ dir, safeStorage: fake() });
  assert.throws(() => store.set("../evil", "k", "v"), /Invalid/);
  assert.throws(() => store.get("smoelenboek", "../k"), /Invalid/);
  assert.throws(() => store.set("smoelenboek", "", "v"), /Invalid/);
});

test("corrupt data decrypts to null instead of throwing", () => {
  const d = fs.mkdtempSync(path.join(dir, "corrupt-"));
  fs.writeFileSync(path.join(d, "smoelenboek.json"), '{"key":"!!notbase64-or-cipher"}');
  const store = createSecretStore({
    dir: d,
    safeStorage: {
      ...fake(),
      decryptString: () => {
        throw new Error("bad");
      },
    },
  });
  assert.strictEqual(store.get("smoelenboek", "key"), null);
});
