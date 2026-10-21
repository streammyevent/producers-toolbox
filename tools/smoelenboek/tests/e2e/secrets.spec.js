// Secrets at rest (plan Phase 5c). The Google Custom Search API key may only live in the desktop app's encrypted
// store (Electron safeStorage via window.electronAPI.secrets). In a plain browser that feature is disabled and
// nothing secret is ever written to localStorage/sessionStorage; plaintext left by older versions (including the old
// Google Drive config with its saved access token) is purged on every start.
//
// "Desktop" tests use the fixture's fake secrets bridge (installFakeDesktopSecrets / desktopSecrets); the real
// encryption is covered by electron.spec.js. All secret values are fake and built at runtime.

const fs = require("fs");
const { test, expect, gotoApp, speakerCards, REGISTRY_KEY } = require("./fixtures");

const GDRIVE_CONFIG_KEY = "speaker_gdrive_config_v1";
const LEGACY_GSEARCH_KEY = "spd_gsearch_api_key";
const GSEARCH_CX_KEY = "spd_gsearch_cx_id";
const DESKTOP_NOTE = "Needs the desktop app: keys are only stored encrypted.";
const CLIENT_ID = ["1234567890-e2etest", ".apps.google", "usercontent.com"].join("");

/** A fake, unique secret-looking value (never a real credential). */
function fakeSecret(label) {
  return `fake-${label}-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

/** Every key and value in localStorage and sessionStorage, as one string to search for leaked secrets. */
async function allWebStorage(page) {
  return page.evaluate(() => {
    const dump = (s) => Object.keys(s).map((k) => `${k}=${s.getItem(k)}`);
    return [...dump(window.localStorage), ...dump(window.sessionStorage)].join("\n");
  });
}

async function expectNoSecretInWebStorage(page, ...secrets) {
  const storage = await allWebStorage(page);
  for (const secret of secrets) expect(storage).not.toContain(secret);
  expect(storage).not.toContain("savedAccessToken");
  expect(storage).not.toContain(`${LEGACY_GSEARCH_KEY}=`);
}

/**
 * Seeds localStorage once (seedStorage only applies its first call per tab) with Advanced mode switched on, where
 * the Backup folder and Import/Export buttons live.
 */
function seedAdvanced(seedStorage, entries = {}) {
  return seedStorage({ spd_ui_mode: "advanced", ...entries });
}

const fakeStore = (page) => page.evaluate(() => Object.fromEntries(window.__fakeSecrets.store));

async function openSearchGuide(page) {
  await page.evaluate(() => app.openPhotoLookupModal(""));
  await page.locator("#toggle-google-guide-btn").click();
  await expect(page.locator("#google-guide-content")).toBeVisible();
}

/** JSON reply with CORS headers for a mocked Google/Wikipedia request. */
function json(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify(body),
  });
}

test.describe("browser mode (no desktop app)", () => {
  test("the Search key inputs are disabled with an explanation; the key input is a password field", async ({
    page,
  }) => {
    await gotoApp(page);
    await openSearchGuide(page);
    await expect(page.locator("#gsearch-desktop-only-note")).toBeVisible();
    await expect(page.locator("#gsearch-desktop-only-note")).toContainText(DESKTOP_NOTE);
    for (const id of ["gsearch-api-key", "gsearch-cx-id", "btn-save-gsearch-keys"]) {
      await expect(page.locator(`#${id}`), id).toBeDisabled();
    }
    await expect(page.locator("#gsearch-api-status")).toContainText("need the desktop app");
    await expect(page.locator("#gsearch-api-key")).toHaveAttribute("type", "password");
    await expect(page.locator("#gsearch-api-key")).toHaveAttribute("autocomplete", "off");
  });

  test("saving a key is impossible, even when the controls are re-enabled by hand", async ({ page, seedStorage }) => {
    await seedAdvanced(seedStorage);
    const apiKey = fakeSecret("apikey");
    await gotoApp(page);

    // A user forcing the disabled controls back on (e.g. via DevTools) still gets nothing stored
    await page.evaluate(() => {
      for (const id of ["gsearch-api-key", "gsearch-cx-id", "btn-save-gsearch-keys"])
        document.getElementById(id).disabled = false;
    });
    await openSearchGuide(page);
    await page.locator("#gsearch-api-key").fill(apiKey);
    await page.locator("#gsearch-cx-id").fill("cx-browser");
    await page.locator("#btn-save-gsearch-keys").click();
    await expect(page.locator("#gsearch-api-key")).toHaveValue("");

    // The store API refuses too
    expect(await page.evaluate((k) => SecretStore.set("gsearchApiKey", k), apiKey)).toBe(false);

    await expectNoSecretInWebStorage(page, apiKey);
    await page.reload();
    await expectNoSecretInWebStorage(page, apiKey);
  });

  test("legacy plaintext secrets are purged on load", async ({ page, seedStorage }) => {
    const token = fakeSecret("legacy-token");
    const apiKey = fakeSecret("legacy-key");
    await seedAdvanced(seedStorage, {
      [LEGACY_GSEARCH_KEY]: apiKey,
      [GSEARCH_CX_KEY]: "cx-legacy",
      [GDRIVE_CONFIG_KEY]: {
        clientId: CLIENT_ID,
        autoSync: true,
        folderId: "folder-1",
        folderName: "Backups",
        userProfile: { name: "Old User", email: "old@example.test", picture: "" },
        lastSyncTime: null,
        savedAccessToken: token,
        access_token: token,
      },
    });
    await gotoApp(page);

    await expectNoSecretInWebStorage(page, token, apiKey);
    expect(await page.evaluate((k) => localStorage.getItem(k), LEGACY_GSEARCH_KEY)).toBeNull();
    // The old Google Drive config is obsolete (the backup folder replaced it) and removed as a whole
    expect(await page.evaluate((k) => localStorage.getItem(k), GDRIVE_CONFIG_KEY)).toBeNull();
    // The non-secret Search setting survives
    expect(await page.evaluate((k) => localStorage.getItem(k), GSEARCH_CX_KEY)).toBe("cx-legacy");
    expect(await page.evaluate(() => SecretStore.get("gdriveAccessToken"))).toBe("");
  });

  test("online photo search works without a key (Wikipedia/Commons) and never calls Custom Search", async ({
    page,
    seedStorage,
  }) => {
    await seedAdvanced(seedStorage, { [GSEARCH_CX_KEY]: "cx-only", [LEGACY_GSEARCH_KEY]: fakeSecret("legacy") });
    const customSearch = [];
    await page.route("https://www.googleapis.com/customsearch/**", (route) => {
      customSearch.push(route.request().url());
      return json(route, { items: [] });
    });
    await page.route("https://en.wikipedia.org/**", (route) =>
      json(route, {
        query: { pages: { 1: { title: "Ada Wiki", thumbnail: { source: "https://upload.example.test/ada.jpg" } } } },
      }),
    );
    await gotoApp(page);
    await page.evaluate(() => app.openPhotoLookupModal("Ada"));
    await expect(page.locator("#online-search-results .photo-result-item")).toHaveCount(1);
    await expect(page.locator("#online-search-results")).toContainText("Ada Wiki");
    expect(customSearch).toEqual([]);
  });
});

test.describe("desktop app (fake encrypted store)", () => {
  test("legacy plaintext is moved into the encrypted store and removed from localStorage", async ({
    page,
    seedStorage,
    desktopSecrets,
  }) => {
    const token = fakeSecret("legacy-token");
    const apiKey = fakeSecret("legacy-key");
    await desktopSecrets();
    await seedAdvanced(seedStorage, {
      [LEGACY_GSEARCH_KEY]: apiKey,
      [GSEARCH_CX_KEY]: "cx-legacy",
      [GDRIVE_CONFIG_KEY]: {
        clientId: CLIENT_ID,
        autoSync: false,
        folderId: null,
        folderName: "Backups",
        userProfile: { name: "Old User", email: "old@example.test", picture: "" },
        lastSyncTime: null,
        savedAccessToken: token,
      },
    });
    await gotoApp(page);

    // Only the Search key is moved; the old Drive token is not kept anywhere
    expect(await fakeStore(page)).toEqual({ gsearchApiKey: apiKey });
    await expectNoSecretInWebStorage(page, token, apiKey);
    expect(await page.evaluate((k) => localStorage.getItem(k), GDRIVE_CONFIG_KEY)).toBeNull();
    // The migrated key is shown in its (password) field from the cache
    await openSearchGuide(page);
    await expect(page.locator("#gsearch-api-key")).toHaveValue(apiKey);
    await expect(page.locator("#gsearch-desktop-only-note")).toBeHidden();
  });

  test("an existing encrypted value wins over stale legacy plaintext (which is still deleted)", async ({
    page,
    seedStorage,
    desktopSecrets,
  }) => {
    const current = fakeSecret("current");
    const stale = fakeSecret("stale");
    await desktopSecrets({ initial: { gsearchApiKey: current } });
    await seedAdvanced(seedStorage, { [LEGACY_GSEARCH_KEY]: stale });
    await gotoApp(page);
    expect(await fakeStore(page)).toEqual({ gsearchApiKey: current });
    await expectNoSecretInWebStorage(page, current, stale);
  });

  test("an old encrypted Google Drive token is never loaded into the app", async ({ page, desktopSecrets }) => {
    const token = fakeSecret("old-drive-token");
    // A bridge that still returns the obsolete name (the real main process drops it, see electron.spec.js)
    await desktopSecrets({ initial: { gdriveAccessToken: token } });
    await gotoApp(page);
    expect(await page.evaluate(() => [SecretStore.available, SecretStore.get("gdriveAccessToken")])).toEqual([
      true,
      "",
    ]);
    expect(await page.evaluate(() => Object.keys(SECRET_NAMES))).toEqual(["gsearchApiKey"]);
    expect(await page.evaluate((t) => SecretStore.set("gdriveAccessToken", t), token)).toBe(false);
    await expectNoSecretInWebStorage(page, token);
  });

  test("the Search key is saved to the encrypted store only and used for Custom Search requests", async ({
    page,
    desktopSecrets,
  }) => {
    const apiKey = fakeSecret("apikey");
    await desktopSecrets();
    const requests = [];
    await page.route("https://www.googleapis.com/customsearch/**", (route) => {
      requests.push(route.request().url());
      return json(route, { items: [{ title: "Google Result", link: "https://images.example.test/g.jpg" }] });
    });
    await gotoApp(page);
    await openSearchGuide(page);
    await expect(page.locator("#gsearch-api-key")).toBeEnabled();
    await page.locator("#gsearch-api-key").fill(apiKey);
    await page.locator("#gsearch-cx-id").fill("cx-desktop");
    await page.locator("#btn-save-gsearch-keys").click();
    await expect(page.locator("#toast-container")).toContainText("Google API credentials saved!");

    expect(await fakeStore(page)).toEqual({ gsearchApiKey: apiKey });
    expect(await page.evaluate((k) => localStorage.getItem(k), GSEARCH_CX_KEY)).toBe("cx-desktop");
    await expectNoSecretInWebStorage(page, apiKey);
    await expect(page.locator("#gsearch-api-status")).toContainText("Connected");

    requests.length = 0;
    await page.evaluate(() => app.executeOnlineSearch("Grace Hopper"));
    await expect(page.locator("#online-search-results")).toContainText("Google Result");
    expect(requests).toHaveLength(1);
    const url = new URL(requests[0]);
    expect(url.searchParams.get("key")).toBe(apiKey);
    expect(url.searchParams.get("cx")).toBe("cx-desktop");

    // Clearing the field and saving removes the key
    await page.locator("#gsearch-api-key").fill("");
    await page.locator("#btn-save-gsearch-keys").click();
    await expect.poll(() => fakeStore(page)).toEqual({});
  });

  test("a desktop app without OS encryption behaves like the browser and only deletes legacy plaintext", async ({
    page,
    seedStorage,
    desktopSecrets,
  }) => {
    const apiKey = fakeSecret("legacy-key");
    const token = fakeSecret("legacy-token");
    await desktopSecrets({ available: false });
    await seedAdvanced(seedStorage, { [LEGACY_GSEARCH_KEY]: apiKey, [GDRIVE_CONFIG_KEY]: { savedAccessToken: token } });
    await gotoApp(page);
    expect(await page.evaluate(() => SecretStore.available)).toBe(false);
    await expectNoSecretInWebStorage(page, apiKey, token);
    const calls = await page.evaluate(() => window.__fakeSecrets.calls);
    expect(calls.filter(([op]) => op === "set")).toEqual([]);
    await openSearchGuide(page);
    await expect(page.locator("#gsearch-desktop-only-note")).toBeVisible();
    await expect(page.locator("#gsearch-api-key")).toBeDisabled();
  });
});

test.describe("exports, folder backups and imports never carry secrets", () => {
  test("JSON/CSV exports and the backup folder files contain no secret", async ({
    page,
    seedStorage,
    desktopSecrets,
    desktopSyncFolder,
  }) => {
    const apiKey = fakeSecret("apikey");
    await desktopSyncFolder();
    await desktopSecrets({ initial: { gsearchApiKey: apiKey } });
    await seedAdvanced(seedStorage);
    await gotoApp(page);
    await expect(speakerCards(page)).toHaveCount(8);

    // Local exports
    await page.locator("#btn-import-export").click();
    const grab = async (selector) => {
      const [dl] = await Promise.all([page.waitForEvent("download"), page.locator(selector).click()]);
      return fs.readFileSync(await dl.path(), "utf8");
    };
    const jsonExport = await grab("#btn-export-json");
    const csvExport = await grab("#btn-export-csv");
    await page.evaluate(() => app.closeModal("import-export-modal"));

    // Folder backup (JSON) and run sheet (CSV)
    await page.locator("#btn-sync-menu").click();
    await page.locator("#btn-sync-now").click();
    await page.locator("#btn-sync-export-csv").click();
    const files = () =>
      page.evaluate(() => Object.fromEntries([...window.__fakeSync.files].map(([n, f]) => [n, f.content])));
    await expect.poll(async () => Object.keys(await files()).length).toBe(2);
    const written = await files();

    for (const [label, content] of [
      ["json export", jsonExport],
      ["csv export", csvExport],
      ["folder backup", written["Backup_Speaker_Photo_Directory.json"]],
      ["folder csv", written["RunSheet_Speaker_Photo_Directory.csv"]],
    ]) {
      expect(content.length, label).toBeGreaterThan(100);
      expect(content, label).not.toContain(apiKey);
      expect(content, label).not.toMatch(/savedAccessToken|access_?token|api_?key|client_?secret/i);
    }
    expect(written["Backup_Speaker_Photo_Directory.json"]).toContain('"schemaVersion": "speaker-directory-v1"');
    await expectNoSecretInWebStorage(page, apiKey);
  });

  test("imported JSON drops secret-shaped fields", async ({ page, seedStorage }) => {
    await seedAdvanced(seedStorage);
    const secret = fakeSecret("imported");
    await gotoApp(page);
    const file = {
      projectTitle: "Imported",
      savedAccessToken: secret,
      gsearchApiKey: secret,
      speakers: [{ fullName: "Ada", apiKey: secret, token: secret, access_token: secret, client_secret: secret }],
      micInventory: [{ name: "Lav 1", type: "lav", api_key: secret }],
    };
    await page.locator("#btn-import-export").click();
    await page.locator("#import-file-input").setInputFiles({
      name: "import.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(file), "utf8"),
    });
    await expect(speakerCards(page)).toHaveCount(1);
    const speaker = await page.evaluate(() => app.speakers[0]);
    expect(Object.keys(speaker).sort()).toEqual(["fullName", "id", "mic", "micType", "notes", "photo", "title"]);
    expect(await page.evaluate(() => app.micInventory)).toEqual([{ name: "Lav 1", type: "lav" }]);
    const storage = await allWebStorage(page);
    expect(storage).not.toContain(secret);
    expect(storage).toContain(REGISTRY_KEY);
  });

  test("a folder restore drops secret-shaped fields", async ({ page, seedStorage, desktopSyncFolder }) => {
    await seedAdvanced(seedStorage);
    const secret = fakeSecret("restored");
    await desktopSyncFolder({
      files: {
        "Backup_Restored.json": JSON.stringify({
          schemaVersion: "speaker-directory-v1",
          savedAccessToken: secret,
          project: {
            id: "proj-r",
            title: "Restored",
            accessToken: secret,
            speakers: [{ fullName: "Grace", token: secret, gsearchApiKey: secret }],
            micInventory: [{ name: "HH 1", type: "handheld", clientSecret: secret }],
          },
        }),
      },
    });
    page.on("dialog", (d) => d.accept());
    await gotoApp(page);
    await page.locator("#btn-sync-menu").click();
    await page.locator('#sync-backups-container [data-action="restore-backup"]').click();
    await expect(page.locator("#project-title-display")).toHaveText("Restored");
    await expect(speakerCards(page)).toHaveCount(1);
    expect(await allWebStorage(page)).not.toContain(secret);
    expect(JSON.stringify(await page.evaluate(() => [app.speakers, app.micInventory]))).not.toContain(secret);
  });
});
