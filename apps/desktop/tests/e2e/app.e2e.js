// End-to-end test that drives the real app. Run: npm run test:e2e
// Uses a throwaway data folder, so it never touches your real Producers Toolbox data.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { _electron: electron } = require("playwright-core");

const desktop = path.join(__dirname, "..", "..");
const repo = path.join(desktop, "..", "..");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "toolbox-e2e-"));
const fixture = path.join(__dirname, "fixtures", "quote-pricer-backup.json");

async function launch() {
  const env = { ...process.env, PRODUCERS_TOOLBOX_DATA_DIR: dataDir };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    executablePath: require("electron"),
    args: [desktop],
    env,
  });
  const launcher = await app.firstWindow();
  await launcher.waitForSelector(".card");
  return { app, launcher };
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

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test("launcher lists all three tools", async () => {
  const { app, launcher } = await launch();
  try {
    const names = await launcher.locator(".card h2").allTextContents();
    assert.deepStrictEqual(names.sort(), ["Content Card Studio", "Quote Pricer", "Smoelenboek"]);
  } finally {
    await app.close();
  }
});

test("launcher: hamburger menu opens with all items available", async () => {
  const { app, launcher } = await launch();
  try {
    const menu = launcher.locator("#menu");
    assert.ok(await menu.isHidden());
    await launcher.locator("#menuBtn").click();
    await menu.waitFor({ state: "visible" });
    const items = await menu.getByRole("menuitem").allTextContents();
    assert.deepStrictEqual(items, ["Check for updates", "Settings", "About", "Uninstall Toolbox", "Quit"]);
    for (const name of items) {
      assert.ok(await menu.getByRole("menuitem", { name }).isEnabled(), `${name} should be enabled`);
    }
    await launcher.keyboard.press("Escape");
    await menu.waitFor({ state: "hidden" });
  } finally {
    await app.close();
  }
});

test("launcher: theme toggle persists across a restart", async () => {
  let { app, launcher } = await launch();
  let toggled;
  try {
    const before = await launcher.locator("html").getAttribute("data-theme");
    await launcher.locator("#themeToggle").click();
    toggled = before === "dark" ? "light" : "dark";
    await launcher.waitForFunction((t) => document.documentElement.dataset.theme === t, toggled);
    await launcher.waitForFunction(() => localStorage.getItem("tb-theme") !== null);
  } finally {
    await app.close();
  }
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dataDir, "user", "settings.json"), "utf8")).theme, toggled);

  ({ app, launcher } = await launch());
  try {
    assert.strictEqual(await launcher.locator("html").getAttribute("data-theme"), toggled);
  } finally {
    await app.close();
  }
});

test("launcher: settings modal saves and survives a restart", async () => {
  let { app, launcher } = await launch();
  try {
    await launcher.locator("#menuBtn").click();
    await launcher.getByRole("menuitem", { name: "Settings" }).click();
    const modal = launcher.locator("#settingsModal");
    await modal.waitFor({ state: "visible" });
    await launcher.locator("#setTheme").selectOption("dark");
    await launcher.locator("#setUpdates").uncheck();
    await launcher.locator("#settingsSave").click();
    await modal.waitFor({ state: "hidden" });
    assert.strictEqual(await launcher.locator("html").getAttribute("data-theme"), "dark");
  } finally {
    await app.close();
  }
  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, "user", "settings.json"), "utf8"));
  assert.strictEqual(saved.theme, "dark");
  assert.strictEqual(saved.autoCheckUpdates, false);

  ({ app, launcher } = await launch());
  try {
    await launcher.locator("#menuBtn").click();
    await launcher.getByRole("menuitem", { name: "Settings" }).click();
    assert.strictEqual(await launcher.locator("#setTheme").inputValue(), "dark");
    assert.strictEqual(await launcher.locator("#setUpdates").isChecked(), false);
  } finally {
    await app.close();
  }
});

test("launcher: pinning a tool moves it first and persists", async () => {
  let { app, launcher } = await launch();
  try {
    await launcher.getByRole("button", { name: "Pin Smoelenboek" }).click();
    await launcher.waitForFunction(() => document.querySelector(".card h2").textContent === "Smoelenboek");
  } finally {
    await app.close();
  }
  ({ app, launcher } = await launch());
  try {
    assert.strictEqual((await launcher.locator(".card h2").allTextContents())[0], "Smoelenboek");
  } finally {
    await app.close();
  }
});

test("every tool opens without script errors and with a content security policy", async () => {
  const { app, launcher } = await launch();
  try {
    for (const name of ["Content Card Studio", "Smoelenboek", "Quote Pricer"]) {
      const page = await openTool(app, launcher, name);
      await page.waitForTimeout(1500);
      const csp = await page.evaluate(async () => (await fetch(location.href)).headers.get("content-security-policy"));
      assert.match(csp || "", /object-src 'none'/, `${name}: no CSP`);
      assert.doesNotMatch(csp, /unsafe-eval/, `${name}: unsafe-eval`);
      const real = page.errors.filter(
        (e) =>
          !/Electron Security Warning|favicon|service-worker|ERR_(NAME_NOT_RESOLVED|INTERNET_DISCONNECTED)/i.test(e),
      );
      assert.deepStrictEqual(real, [], `${name} logged errors`);
      const closed = page.waitForEvent("close");
      await launcher.locator(".card", { hasText: name }).getByRole("button", { name: "Stop" }).click();
      await closed;
    }
  } finally {
    await app.close();
  }
});

test("Quote Pricer: restoring a backup works and survives a restart", async () => {
  let { app, launcher } = await launch();
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

  ({ app, launcher } = await launch()); // same data folder, fresh process
  try {
    const page = await openTool(app, launcher, "Quote Pricer");
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("sme_quote_tool_v1")));
    assert.strictEqual(stored.items.length, 2, "data was lost after restart");
    await page.locator('input[data-f="name"][value="Test LED Bar"]').waitFor({ state: "visible" });
  } finally {
    await app.close();
  }
});

test("Quote Pricer: the page can fetch through the app and private addresses are refused", async () => {
  const { app, launcher } = await launch();
  try {
    const page = await openTool(app, launcher, "Quote Pricer");
    const priv = await page.evaluate(async () =>
      (await fetch("/api/product?url=" + encodeURIComponent("http://127.0.0.1:1/"))).json(),
    );
    assert.match(priv.error, /not allowed/);
  } finally {
    await app.close();
  }
});

test("Content Card Studio: settings and PNG export work from the page", async () => {
  const { app, launcher } = await launch();
  try {
    const page = await openTool(app, launcher, "Content Card Studio");
    const drive = path.join(dataDir, "drive");
    const saved = await page.evaluate(
      async (d) =>
        (
          await fetch("/api/storage/config", { method: "POST", body: JSON.stringify({ drivePath: d, enabled: true }) })
        ).json(),
      drive,
    );
    assert.strictEqual(saved.isAccessible, true);

    const b64 = "data:image/png;base64," + Buffer.from("e2e-png").toString("base64");
    const status = await page.evaluate(
      async (data) =>
        (
          await fetch("/api/download-png", {
            method: "POST",
            body: JSON.stringify({ filename: "e2e.png", base64: data }),
          })
        ).status,
      b64,
    );
    assert.strictEqual(status, 200);
    assert.ok(fs.existsSync(path.join(drive, "exports", "e2e.png")), "not written to the Shared Drive folder");
    assert.ok(
      fs.existsSync(path.join(dataDir, "documents", "Producers Toolbox", "Content Card Studio", "exports", "e2e.png")),
      "not written to Documents",
    );
  } finally {
    await app.close();
  }
});

test("Secrets: API keys are stored encrypted and kept per tool", async () => {
  let { app, launcher } = await launch();
  try {
    const page = await openTool(app, launcher, "Smoelenboek");
    assert.strictEqual(
      await page.evaluate(() => window.producersToolbox.secrets.set("gsearchApiKey", "AIzaSy-e2e-secret")),
      true,
    );
  } finally {
    await app.close();
  }

  // Nothing readable on disk, and it is still there after a restart.
  const hits = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else {
        try {
          const t = fs.readFileSync(f, "latin1");
          if (t.includes("AIzaSy-")) hits.push(f);
        } catch {}
      }
    }
  })(dataDir);
  assert.deepStrictEqual(hits, [], "API key found in plaintext on disk");

  ({ app, launcher } = await launch());
  try {
    const page = await openTool(app, launcher, "Smoelenboek");
    assert.strictEqual(
      await page.evaluate(() => window.producersToolbox.secrets.get("gsearchApiKey")),
      "AIzaSy-e2e-secret",
    );
    const other = await openTool(app, launcher, "Quote Pricer");
    assert.strictEqual(await other.evaluate(() => window.producersToolbox.secrets.get("gsearchApiKey")), null);
  } finally {
    await app.close();
  }
});

// Native dialogs cannot be clicked by Playwright, so they are replaced in the main process.
async function stubDialogs(app, { file = null, response = 0, checkboxChecked = false } = {}) {
  await app.evaluate(
    ({ dialog }, o) => {
      dialog.showOpenDialog = async () =>
        o.file ? { canceled: false, filePaths: [o.file] } : { canceled: true, filePaths: [] };
      dialog.showMessageBox = async () => ({ response: o.response, checkboxChecked: o.checkboxChecked });
    },
    { file, response, checkboxChecked },
  );
}

test("tools: removing a built-in tool hides it, and Settings brings it back", async () => {
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

test("updates: the dialog opens and explains that toolbox updates need the installed app", async () => {
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
