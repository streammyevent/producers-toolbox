const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const asar = require("@electron/asar");
const verify = require("../../build/verify-asar.js").default;

const TOOLS = fs
  .readdirSync(path.join(__dirname, "..", "..", "..", "..", "tools"))
  .filter((id) => fs.existsSync(path.join(__dirname, "..", "..", "..", "..", "tools", id, "tool.json")));

/** Packs `files` ({ "a/b.js": "content" }) into <out>/resources/app.asar, the Windows layout, and verifies it. */
async function check(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tb-asar-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const src = path.join(root, "src");
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(src, file)), { recursive: true });
    fs.writeFileSync(path.join(src, file), content);
  }
  fs.mkdirSync(path.join(root, "out", "resources"), { recursive: true });
  await asar.createPackage(src, path.join(root, "out", "resources", "app.asar"));
  return verify({ appOutDir: path.join(root, "out"), packager: { appInfo: {} }, electronPlatformName: "win32" });
}

const complete = () => ({
  "package.json": JSON.stringify({ dependencies: { "electron-updater": "1" } }),
  "out/main/main.js": "",
  "out/main/tool-preload.js": "",
  "src/renderer/index.html": "",
  "node_modules/electron-updater/package.json": JSON.stringify({ dependencies: { debug: "1" } }),
  "node_modules/debug/package.json": JSON.stringify({ dependencies: { ms: "1" } }),
  "node_modules/debug/node_modules/ms/package.json": "{}",
  ...Object.fromEntries(TOOLS.map((id) => [`tools/${id}/tool.json`, "{}"])),
});

test("a complete app passes", async (t) => {
  await check(t, complete());
});

test("a missing nested dependency or tool fails the build", async (t) => {
  const files = complete();
  delete files["node_modules/debug/node_modules/ms/package.json"];
  delete files[`tools/${TOOLS[0]}/tool.json`];
  await assert.rejects(
    () => check(t, files),
    (err) => {
      assert.match(err.message, /node_modules\/debug -> ms/);
      assert.match(err.message, new RegExp(`tools/${TOOLS[0]}/tool.json`));
      return true;
    },
  );
});
