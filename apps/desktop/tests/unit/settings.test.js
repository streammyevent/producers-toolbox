const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createSettings, sanitize, DEFAULTS } = require("../../out/main/settings");

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tb-settings-")), "nested", "settings.json");

test("defaults when the file is missing", () => {
  assert.deepStrictEqual(createSettings({ file: tmp() }).get(), DEFAULTS);
});

test("defaults when the file is corrupt", () => {
  const file = tmp();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "{not json");
  assert.deepStrictEqual(createSettings({ file }).get(), DEFAULTS);
});

test("set merges, persists, and leaves no temp file behind", () => {
  const file = tmp();
  const s = createSettings({ file });
  const next = s.set({ theme: "dark", minimizeToTray: true });
  assert.strictEqual(next.theme, "dark");
  assert.strictEqual(next.minimizeToTray, true);
  assert.strictEqual(next.autoCheckUpdates, true, "untouched fields keep their value");
  assert.deepStrictEqual(createSettings({ file }).get(), next, "reloaded from disk");
  assert.deepStrictEqual(fs.readdirSync(path.dirname(file)), ["settings.json"]);
});

test("invalid values are ignored and unknown keys dropped", () => {
  const out = sanitize({ theme: "purple", startWithWindows: "yes", minimizeToTray: 1, evil: true, pinnedTools: "x" });
  assert.deepStrictEqual(out, DEFAULTS);
});

test("pinnedTools keeps only unique valid ids", () => {
  const out = sanitize({ pinnedTools: ["quote-pricer", "quote-pricer", "../x", 5, "smoelenboek"] });
  assert.deepStrictEqual(out.pinnedTools, ["quote-pricer", "smoelenboek"]);
});

test("get returns a copy", () => {
  const s = createSettings({ file: tmp() });
  s.get().pinnedTools.push("x");
  assert.deepStrictEqual(s.get().pinnedTools, []);
});
