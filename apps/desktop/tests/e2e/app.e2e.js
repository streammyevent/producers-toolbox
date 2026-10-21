// End-to-end tests that drive the real app (compiled from src/ by the build task). Each launch uses a throwaway data
// folder, so they never touch your real Producers Toolbox data.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { _electron: electron } = require("playwright-core");

const desktop = path.join(__dirname, "..", "..");
const repo = path.join(desktop, "..", "..");
const fixture = path.join(__dirname, "fixtures", "quote-pricer-backup.json");
const SEARCH_KEY = "AIzaSy-e2e-not-a-real-key";
const roots = [];

test.after(() => {
  for (const dir of roots) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

async function launch(dataDir = tempDir("toolbox-e2e-")) {
  const env = { ...process.env, PRODUCERS_TOOLBOX_DATA_DIR: dataDir };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: require("electron"), args: [desktop], env });
  const launcher = await app.firstWindow();
  await launcher.waitForSelector(".card");
  return { app, launcher, dataDir };
}

// Click Start on a tool's card and return its new window, collecting console errors on the way.
async function openTool(app, launcher, name) {
  const opened = app.waitForEvent("window");
  await launcher.locator(".card", { hasText: name }).getByRole("button", { name: "Start" }).click();
  const page = await opened;
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") page.errors.push(m.text());
  });
  await page.waitForLoadState("load");
  return page;
}

// Native dialogs cannot be clicked by Playwright, so they are replaced in the main process.
async function stubDialogs(app, { folder = null, response = 0, checkboxChecked = false } = {}) {
  await app.evaluate(
    ({ dialog }, o) => {
      dialog.showOpenDialog = async () =>
        o.folder ? { canceled: false, filePaths: [o.folder] } : { canceled: true, filePaths: [] };
      dialog.showMessageBox = async () => ({ response: o.response, checkboxChecked: o.checkboxChecked });
    },
    { folder, response, checkboxChecked },
  );
}

/** Settles a promise in the page as "resolved <json>" or the error message. */
const settle = (page, fn, arg) =>
  page.evaluate(
    ([source, a]) =>
      Promise.resolve()
        .then(() => (0, eval)(source)(a)) // eslint-disable-line no-eval -- runs a test callback in the page
        .then(
          (v) => `resolved ${JSON.stringify(v)}`,
          (e) => String(e.message),
        ),
    [fn.toString(), arg],
  );

function filesContaining(dir, needle) {
  const hits = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (fs.readFileSync(f).includes(needle)) hits.push(f);
    }
  })(dir);
  return hits;
}

test("launcher lists all four tools", async () => {
  const { app, launcher } = await launch();
  try {
    const names = await launcher.locator(".card h2").allTextContents();
    assert.deepStrictEqual(names.sort(), ["Content Card Studio", "Network Tool", "Quote Pricer", "Smoelenboek"]);
  } finally {
    await app.close();
  }
});

test("launcher: hamburger menu opens with its items", async () => {
  const { app, launcher } = await launch();
  try {
    const menu = launcher.locator("#menu");
    assert.ok(await menu.isHidden());
    await launcher.locator("#menuBtn").click();
    await menu.waitFor({ state: "visible" });
    const items = await menu.getByRole("menuitem").allTextContents();
    const uninstall = process.platform === "win32" ? ["Uninstall Toolbox"] : [];
    assert.deepStrictEqual(items, ["Check for updates", "Settings", "About", ...uninstall, "Quit"]);
    await launcher.keyboard.press("Escape");
    await menu.waitFor({ state: "hidden" });
  } finally {
    await app.close();
  }
});

test("launcher: theme and settings survive a restart", async () => {
  let { app, launcher, dataDir } = await launch();
  try {
    await launcher.locator("#menuBtn").click();
    await launcher.getByRole("menuitem", { name: "Settings" }).click();
    await launcher.locator("#settingsModal").waitFor({ state: "visible" });
    await launcher.locator("#setTheme").selectOption("dark");
    await launcher.locator("#setUpdates").uncheck();
    await launcher.locator("#settingsSave").click();
    await launcher.locator("#settingsModal").waitFor({ state: "hidden" });
    assert.strictEqual(await launcher.locator("html").getAttribute("data-theme"), "dark");
  } finally {
    await app.close();
  }
  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, "user", "settings.json"), "utf8"));
  assert.strictEqual(saved.theme, "dark");
  assert.strictEqual(saved.autoCheckUpdates, false);

  ({ app, launcher } = await launch(dataDir));
  try {
    assert.strictEqual(await launcher.locator("html").getAttribute("data-theme"), "dark");
    await launcher.locator("#themeToggle").click();
    await launcher.waitForFunction(() => document.documentElement.dataset.theme === "light");
  } finally {
    await app.close();
  }
});

test("launcher: pinning a tool moves it first and persists", async () => {
  let { app, launcher, dataDir } = await launch();
  try {
    await launcher.getByRole("button", { name: "Pin Smoelenboek" }).click();
    await launcher.waitForFunction(() => document.querySelector(".card h2").textContent === "Smoelenboek");
  } finally {
    await app.close();
  }
  ({ app, launcher } = await launch(dataDir));
  try {
    assert.strictEqual((await launcher.locator(".card h2").allTextContents())[0], "Smoelenboek");
  } finally {
    await app.close();
  }
});

test("every tool opens without script errors, under a strict script policy", async () => {
  const { app, launcher } = await launch();
  try {
    for (const name of ["Content Card Studio", "Smoelenboek", "Quote Pricer", "Network Tool"]) {
      const page = await openTool(app, launcher, name);
      await page.waitForTimeout(1500);
      const csp = await page.evaluate(async () => (await fetch(location.href)).headers.get("content-security-policy"));
      assert.match(csp || "", /script-src 'self'( 'wasm-unsafe-eval')?;/, `${name}: script-src`);
      assert.match(csp, /object-src 'none'/, `${name}: object-src`);
      assert.doesNotMatch(csp, /'unsafe-eval'|script-src[^;]*unsafe-inline/, `${name}: unsafe scripts`);
      const real = page.errors.filter((e) => !/favicon|ERR_(NAME_NOT_RESOLVED|INTERNET_DISCONNECTED)/i.test(e));
      assert.deepStrictEqual(real, [], `${name} logged errors`);
      // Only web/ is served: the tool's main-process code and manifest are not reachable
      for (const p of ["/../api.js", "/../tool.json", "/%2e%2e/tool.json"]) {
        assert.strictEqual(await page.evaluate(async (u) => (await fetch(u)).status, p), 404, `${name}: ${p}`);
      }
      const closed = page.waitForEvent("close");
      await launcher.locator(".card", { hasText: name }).getByRole("button", { name: "Stop" }).click();
      await closed;
    }
  } finally {
    await app.close();
  }
});

test("Smoelenboek and Content Card Studio load their bundled fonts (no font CDN)", async () => {
  const { app, launcher } = await launch();
  try {
    const loads = (page, families) =>
      page.evaluate(
        (list) => Promise.all(list.map((f) => document.fonts.load(`16px "${f}"`).then((faces) => [f, faces.length]))),
        families,
      );
    const smoelenboek = await openTool(app, launcher, "Smoelenboek");
    for (const [family, faces] of await loads(smoelenboek, ["Geist", "Geist Mono", "Outfit"])) {
      assert.ok(faces > 0, `Smoelenboek: ${family}`);
    }
    const cards = await openTool(app, launcher, "Content Card Studio");
    for (const [family, faces] of await loads(cards, ["Geist", "Geist Mono", "Inter", "JetBrains Mono"])) {
      assert.ok(faces > 0, `Content Card Studio: ${family}`);
    }
  } finally {
    await app.close();
  }
});

test("Quote Pricer: restoring a backup works and survives a restart", async () => {
  let { app, launcher, dataDir } = await launch();
  try {
    const page = await openTool(app, launcher, "Quote Pricer");
    await page.setInputFiles("#restoreFile", fixture);
    await page.locator("#confirmOk").click();
    await page.getByText("Backup restored").waitFor();
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("sme_quote_tool_v1")));
    assert.deepStrictEqual(
      stored.items.map((i) => i.name),
      ["Test DMX Cable 5m", "Test LED Bar"],
    );
  } finally {
    await app.close();
  }
  ({ app, launcher } = await launch(dataDir));
  try {
    const page = await openTool(app, launcher, "Quote Pricer");
    await page.locator('input[data-f="name"][value="Test LED Bar"]').waitFor({ state: "visible" });
  } finally {
    await app.close();
  }
});

test("Quote Pricer: fetches go through the app, private addresses are refused, other tools' powers are not available", async () => {
  const { app, launcher } = await launch();
  try {
    const page = await openTool(app, launcher, "Quote Pricer");
    for (const url of ["http://127.0.0.1:1/", "http://[::ffff:127.0.0.1]/", "http://169.254.169.254/latest/"]) {
      const res = await page.evaluate((u) => window.toolbox.call("product.fetch", u), url);
      assert.match(res.error, /not allowed/, url);
    }
    assert.match(await settle(page, () => window.toolbox.call("storage.saveExport", "x", "y")), /Unknown method/);
    assert.match(await settle(page, () => window.toolbox.call("constructor")), /Unknown method/);
    assert.match(await settle(page, () => window.toolbox.secrets.set("gsearchApiKey", "x")), /Unknown secret name/);
    assert.match(await settle(page, () => window.toolbox.folder.get()), /no folder/);
  } finally {
    await app.close();
  }
});

test("Content Card Studio: the shared-drive folder is chosen in a dialog; exports land there and in Documents", async () => {
  const { app, launcher, dataDir } = await launch();
  const drive = path.join(dataDir, "drive");
  fs.mkdirSync(drive);
  try {
    const page = await openTool(app, launcher, "Content Card Studio");
    await stubDialogs(app, { folder: drive });
    await page.waitForFunction(() => typeof window.openStorageModal === "function");
    await page.evaluate(() => window.openStorageModal());
    await page.locator("#chooseStorageFolderBtn").click();
    await page.waitForFunction(() => document.getElementById("storageDrivePathInput").value !== "");
    assert.strictEqual(await page.locator("#storageDrivePathInput").inputValue(), drive);
    assert.ok(fs.existsSync(path.join(drive, "gear-database", "photos")), "folder layout created");

    const png =
      "data:image/png;base64," + Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]).toString("base64");
    await page.evaluate((d) => window.toolbox.call("storage.saveExport", "e2e.png", d), png);
    assert.ok(fs.existsSync(path.join(drive, "exports", "e2e.png")), "not written to the Shared Drive folder");
    const docs = path.join(dataDir, "documents", "Producers Toolbox", "Content Card Studio", "exports", "e2e.png");
    assert.ok(fs.existsSync(docs), "not written to Documents");
    const notPng = await settle(page, () =>
      window.toolbox.call("storage.saveExport", "x.png", "data:image/png;base64,TVo="),
    );
    assert.match(notPng, /Not a PNG/);
  } finally {
    await app.close();
  }
});

test("Smoelenboek: the Search key is stored encrypted, survives a restart and stays with this tool", async (t) => {
  let { app, launcher, dataDir } = await launch();
  try {
    const page = await openTool(app, launcher, "Smoelenboek");
    assert.strictEqual(await page.evaluate(() => window.electronAPI.isDesktop), true);
    const initial = await page.evaluate(() => window.electronAPI.secrets.getAll());
    if (!initial.available) {
      t.skip("OS encryption is not available on this machine");
      return;
    }
    assert.strictEqual(await page.evaluate(() => SecretStore.available), true); // eslint-disable-line no-undef
    await page.evaluate(() => app.openPhotoLookupModal("")); // eslint-disable-line no-undef
    await page.locator("#toggle-google-guide-btn").click();
    await page.locator("#gsearch-api-key").fill(SEARCH_KEY);
    await page.locator("#gsearch-cx-id").fill("cx-e2e");
    await page.locator("#btn-save-gsearch-keys").click();
    await page.locator("#toast-container").getByText("Google API credentials saved!").waitFor();
    assert.match(
      await settle(page, () => window.electronAPI.secrets.set("rentmanToken", "x")),
      /Unknown secret name/,
      "only the names in tool.json",
    );
  } finally {
    await app.close();
  }
  assert.deepStrictEqual(filesContaining(dataDir, SEARCH_KEY), [], "Search key found in plaintext on disk");

  ({ app, launcher } = await launch(dataDir));
  try {
    const page = await openTool(app, launcher, "Smoelenboek");
    assert.deepStrictEqual(await page.evaluate(() => window.electronAPI.secrets.getAll()), {
      available: true,
      values: { gsearchApiKey: SEARCH_KEY },
    });
    const other = await openTool(app, launcher, "Content Card Studio");
    assert.deepStrictEqual((await other.evaluate(() => window.toolbox.secrets.getAll())).values, {});
  } finally {
    await app.close();
  }
});

// No test here scans: that would sweep the network this machine is on.
test("Network Tool: the crew code file stores the logins encrypted; the music player runs under its script policy", async (t) => {
  const { seal } = require("../../../../tools/network-tool/out/creds.js");
  const logins = { switchUser: "admin", switchPass: "switch-e2e", unifiUser: "audit", unifiPass: "unifi-e2e" };
  const file = path.join(tempDir("network-tool-e2e-"), "creds.enc");
  fs.writeFileSync(file, await seal(logins, "flypack-e2e"));
  const { app, launcher, dataDir } = await launch();
  try {
    const page = await openTool(app, launcher, "Network Tool");
    await page.getByText("SET UP THIS COMPUTER").waitFor();
    if (!(await page.evaluate(() => window.toolbox.secrets.getAll())).available) {
      t.skip("OS encryption is not available on this machine");
      return;
    }
    await page.locator("#file").setInputFiles(file);
    await page.locator("#code").fill("wrong-code");
    await page.getByRole("button", { name: "Import" }).click();
    await page.getByText(/WRONG CREW CODE/).waitFor();
    assert.deepStrictEqual((await page.evaluate(() => window.toolbox.secrets.getAll())).values, {});

    const text = fs.readFileSync(file, "utf8");
    assert.strictEqual(
      await settle(page, (f) => window.toolbox.call("creds.import", f, "flypack-e2e"), text),
      "resolved true",
    );
    assert.deepStrictEqual((await page.evaluate(() => window.toolbox.secrets.getAll())).values, logins);
    assert.match(
      await settle(page, () => window.toolbox.call("port.change", "SWITCH01", "ether5", 60)),
      /not a RouterOS switch in the last scan/,
    );

    // libopenmpt compiles WebAssembly in an AudioWorklet loaded from app://
    const music = await settle(page, async () => {
      const { ChiptuneJsPlayer } = await import("./vendor/chiptune3/chiptune3.js");
      const player = new ChiptuneJsPlayer({ repeatCount: 0 });
      await new Promise((resolve, reject) => {
        player.onInitialized(resolve);
        setTimeout(() => reject(new Error("the player did not start")), 8000);
      });
      return "started";
    });
    assert.strictEqual(music, 'resolved "started"');
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await app.close();
  }
  for (const value of Object.values(logins)) {
    assert.deepStrictEqual(filesContaining(dataDir, value), [], "login found in plaintext on disk");
  }
});

test("Smoelenboek: backups go to the chosen folder; the main process keeps the path and checks every name", async () => {
  const { app, launcher, dataDir } = await launch();
  const drive = path.join(dataDir, "drive");
  const backups = path.join(drive, "Speaker Photo Directory");
  fs.mkdirSync(drive);
  try {
    const page = await openTool(app, launcher, "Smoelenboek");
    await stubDialogs(app, { folder: drive });
    assert.strictEqual(await page.evaluate(() => window.syncFolderService.kind), "desktop");
    await page.evaluate(() => app.openModal("sync-modal")); // eslint-disable-line no-undef
    await page.locator("#btn-sync-choose-folder").click();
    await page.locator("#sync-folder-path").getByText(backups).waitFor();
    await page.locator("#btn-sync-now").click();
    await page.locator("#toast-container").getByText("Saved").first().waitFor();
    assert.deepStrictEqual(fs.readdirSync(backups), ["Backup_Speaker_Photo_Directory.json"]);
    const config = JSON.parse(
      fs.readFileSync(path.join(dataDir, "user", "tools", "smoelenboek", "folder.json"), "utf8"),
    );
    assert.strictEqual(config.folder, backups);
    assert.doesNotMatch(await page.evaluate(() => JSON.stringify({ ...localStorage })), /drive/);

    for (const [name, content] of [
      ["../evil.json", "x"],
      ["..\\Backup_evil.json", "x"],
      ["Backup_x.exe", "x"],
    ]) {
      const res = await settle(page, ([n, c]) => window.toolbox.folder.write(n, c), [name, content]);
      assert.match(res, /Invalid file name/, name);
    }
    assert.deepStrictEqual(fs.readdirSync(drive), ["Speaker Photo Directory"]);
  } finally {
    await app.close();
  }
});

test("IPC from a window that is not the tool's own is refused, even on the tool's page", async () => {
  const { app } = await launch();
  try {
    const [stranger] = await Promise.all([
      app.waitForEvent("window"),
      app.evaluate(
        ({ BrowserWindow }, preload) => {
          const win = new BrowserWindow({
            show: false,
            webPreferences: { preload, sandbox: true, contextIsolation: true },
          });
          win.loadURL("app://smoelenboek/index.html");
        },
        path.join(desktop, "out", "main", "tool-preload.js"),
      ),
    ]);
    await stranger.waitForLoadState("domcontentloaded");
    for (const fn of [
      () => window.toolbox.secrets.getAll(),
      () => window.toolbox.secrets.set("gsearchApiKey", "stolen-value"),
      () => window.toolbox.folder.get(),
      () => window.toolbox.folder.write("Backup_stolen.json", "{}"),
      () => window.toolbox.call("product.fetch", "https://example.com/"),
    ]) {
      assert.match(await settle(stranger, fn), /untrusted sender/, fn.toString());
    }
  } finally {
    await app.close();
  }
});

test("pages cannot navigate away or open windows; http(s) links go to the system browser", async () => {
  const { app, launcher } = await launch();
  try {
    await app.evaluate(({ shell }) => {
      globalThis.__opened = [];
      shell.openExternal = async (url) => void globalThis.__opened.push(url);
    });
    const page = await openTool(app, launcher, "Quote Pricer");
    assert.strictEqual(await page.evaluate(() => window.open("https://example.com/doc")), null);
    assert.strictEqual(await page.evaluate(() => window.open("file:///etc/passwd")), null);
    await page.evaluate(() => (location.href = "app://shell/index.html"));
    await page.evaluate(() => (location.href = "https://example.com/away"));
    await page.waitForTimeout(500);
    assert.match(page.url(), /^app:\/\/quote-pricer\//);
    assert.deepStrictEqual(await app.evaluate(() => globalThis.__opened), [
      "https://example.com/doc",
      "https://example.com/away",
    ]);
  } finally {
    await app.close();
  }
});

test("a tool only gets the permissions its manifest lists", async () => {
  const { app, launcher } = await launch();
  try {
    const query = (page) =>
      page.evaluate(async () => (await navigator.permissions.query({ name: "clipboard-read" })).state);
    assert.strictEqual(await query(await openTool(app, launcher, "Quote Pricer")), "denied");
    assert.notStrictEqual(await query(await openTool(app, launcher, "Smoelenboek")), "denied");
  } finally {
    await app.close();
  }
});

test("tools: removing a tool hides it, and Settings brings it back", async () => {
  const { app, launcher } = await launch();
  try {
    await stubDialogs(app, { response: 0, checkboxChecked: false });
    const card = launcher.locator(".card", { hasText: "Quote Pricer" });
    await card.getByRole("button", { name: "More options for Quote Pricer" }).click();
    await card.getByRole("menuitem", { name: "Remove…" }).click();
    await card.waitFor({ state: "detached" });
    assert.ok(fs.existsSync(path.join(repo, "tools", "quote-pricer", "tool.json")), "built-in files must stay");

    await launcher.locator("#menuBtn").click();
    await launcher.getByRole("menuitem", { name: "Settings" }).click();
    await launcher.locator("#restoreHidden").click();
    await launcher.locator("#settingsModal [data-close]").first().click();
    await launcher.locator(".card", { hasText: "Quote Pricer" }).waitFor();
  } finally {
    await app.close();
  }
});

test("updates: the dialog explains that updates need the installed app", async () => {
  const { app, launcher } = await launch();
  try {
    await launcher.locator("#menuBtn").click();
    await launcher.getByRole("menuitem", { name: "Check for updates" }).click();
    await launcher.locator("#updatesModal").waitFor({ state: "visible" });
    await launcher.getByText("only available in the installed app").waitFor();
  } finally {
    await app.close();
  }
});
