const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { readManifest, cspProblem, safeJoin, DEFAULT_CSP } = require("../../out/main/manifest");

const toolsDir = path.join(__dirname, "..", "..", "..", "..", "tools");

test("every built-in tool has a valid manifest", () => {
  const ids = fs.readdirSync(toolsDir).filter((d) => fs.existsSync(path.join(toolsDir, d, "tool.json")));
  assert.deepStrictEqual(ids.sort(), ["content-card-studio", "network-tool", "quote-pricer", "smoelenboek"]);
  for (const id of ids) {
    const m = readManifest(path.join(toolsDir, id), id);
    assert.strictEqual(m.id, id);
    assert.ok(fs.existsSync(path.join(toolsDir, id, "web", m.entry)), `${id}: entry exists`);
  }
});

test("Smoelenboek's folder file names match the pattern its pages use", () => {
  const m = readManifest(path.join(toolsDir, "smoelenboek"), "smoelenboek");
  const util = fs.readFileSync(path.join(toolsDir, "smoelenboek", "web", "js", "util.js"), "utf8");
  const pageRegex = util.match(/const SYNC_FILE_NAME_PATTERN = \/(.+)\/;/)[1];
  assert.strictEqual(m.folder.files.source, pageRegex);
});

test("weak content security policies are refused", () => {
  assert.strictEqual(cspProblem(DEFAULT_CSP), null);
  assert.strictEqual(cspProblem("script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; base-uri 'none'"), null);
  const bad = {
    "script-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'": /script-src/,
    "default-src *; object-src 'none'; base-uri 'none'": /script-src/,
    "script-src 'self'; script-src-attr 'unsafe-inline'; object-src 'none'; base-uri 'none'": /script-src-attr/,
    "script-src 'self'; style-src 'unsafe-eval'; object-src 'none'; base-uri 'none'": /eval/,
    "script-src 'self' 'unsafe-eval'; object-src 'none'; base-uri 'none'": /script-src/,
    "script-src 'wasm-unsafe-eval'; object-src 'none'; base-uri 'none'": /script-src/,
    "script-src 'self'; base-uri 'none'": /object-src/,
    "script-src 'self'; object-src 'none'": /base-uri/,
  };
  for (const [csp, why] of Object.entries(bad)) assert.match(cspProblem(csp) || "", why, csp);
});

test("invalid manifests are refused with a readable reason", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tb-manifest-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const check = (folder, manifest, why) => {
    const dir = path.join(root, folder);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "tool.json"), typeof manifest === "string" ? manifest : JSON.stringify(manifest));
    assert.throws(() => readManifest(dir, folder), why, JSON.stringify(manifest));
  };
  const ok = { id: "demo", name: "Demo" };
  check("demo", "{oops", /not valid JSON/);
  check("shell", { ...ok, id: "shell" }, /reserved/);
  check("other", ok, /folder name/);
  check("Demo", { ...ok, id: "Demo" }, /lowercase/);
  check("demo", { ...ok, permission: ["camera"] }, /unknown field/);
  check("demo", { ...ok, permissions: ["geolocation"] }, /permissions/);
  check("demo", { ...ok, entry: "../../escape.html" }, /inside web/);
  check("demo", { ...ok, csp: "default-src *" }, /csp/);
  check("demo", { ...ok, secrets: ["../x"] }, /secrets/);
  check("demo", { ...ok, folder: { files: "Backup_.*" } }, /anchored/);
  check("demo", { ...ok, folder: { subfolder: "../up" } }, /subfolder/);
});

test("safeJoin keeps paths inside the folder", () => {
  const base = path.resolve("/srv/tool/web");
  assert.strictEqual(safeJoin(base, "/js/app.js"), path.join(base, "js", "app.js"));
  assert.strictEqual(safeJoin(base, "../../../etc/passwd"), null);
  assert.strictEqual(safeJoin(base, "/../web-other/x"), null);
});
