// electron-builder afterPack hook: fails the build when app.asar is incomplete. electron-builder can silently leave out
// a dependency under pnpm (electron-builder issues #10000 and #10064); a missing electron-updater dependency would
// break auto-update in every installed copy, with no way to update out of it.
const fs = require("fs");
const path = require("path");
const asar = require("@electron/asar");

const TOOLS = path.join(__dirname, "..", "..", "..", "tools");

exports.default = async ({ appOutDir, packager, electronPlatformName }) => {
  const resources =
    electronPlatformName === "darwin"
      ? path.join(appOutDir, `${packager.appInfo.productFilename}.app`, "Contents", "Resources")
      : path.join(appOutDir, "resources");
  const archive = path.join(resources, "app.asar");
  const files = new Set(asar.listPackage(archive).map((f) => f.replace(/\\/g, "/").replace(/^\//, "")));
  const missing = [];

  // The app itself and every tool
  for (const file of ["out/main/main.js", "out/main/tool-preload.js", "src/renderer/index.html"]) {
    if (!files.has(file)) missing.push(file);
  }
  for (const id of fs.readdirSync(TOOLS)) {
    if (fs.existsSync(path.join(TOOLS, id, "tool.json")) && !files.has(`tools/${id}/tool.json`)) {
      missing.push(`tools/${id}/tool.json`);
    }
  }

  // Every runtime dependency, resolved the way Node does inside the asar
  const pkg = (dir) => JSON.parse(asar.extractFile(archive, path.posix.join(dir, "package.json")).toString());
  const resolve = (from, dep) => {
    for (let dir = from; ; dir = path.posix.dirname(dir)) {
      if (path.posix.basename(dir) !== "node_modules") {
        const candidate = path.posix.join(dir === "." ? "" : dir, "node_modules", dep);
        if (files.has(`${candidate}/package.json`)) return candidate;
      }
      if (dir === "." || dir === "") return null;
    }
  };
  const seen = new Set();
  (function walk(dir) {
    if (seen.has(dir)) return;
    seen.add(dir);
    for (const dep of Object.keys(pkg(dir).dependencies || {})) {
      const at = resolve(dir, dep);
      if (at) walk(at);
      else missing.push(`${dir} -> ${dep}`);
    }
  })(".");

  if (missing.length) throw new Error(`app.asar is incomplete:\n  ${missing.join("\n  ")}`);
};
