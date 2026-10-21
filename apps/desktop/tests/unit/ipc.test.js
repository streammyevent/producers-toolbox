const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const src = path.join(__dirname, "..", "..", "src", "main");

test("every IPC handler goes through the sender checks in ipc.ts", () => {
  for (const file of fs.readdirSync(src).filter((f) => f.endsWith(".ts") && f !== "ipc.ts")) {
    const code = fs.readFileSync(path.join(src, file), "utf8");
    assert.doesNotMatch(code, /ipcMain\.(handle|handleOnce|on|once)\s*\(/, `${file} registers IPC directly`);
  }
});

test("preloads only use invoke: no synchronous IPC", () => {
  for (const file of ["tool-preload.ts", "launcher-preload.ts"]) {
    assert.doesNotMatch(fs.readFileSync(path.join(src, file), "utf8"), /sendSync|ipcRenderer\.send\(/, file);
  }
});
