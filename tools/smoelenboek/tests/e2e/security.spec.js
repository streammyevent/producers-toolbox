// HTML escaping of user-provided text (plan Phase 5). These started as test.fixme characterization tests that
// documented the XSS sinks (cards, print preview, project list, toasts, mic inventory/dropdown, JSON and CSV import,
// micType in a class attribute); they now run as normal tests and guard the fix.
//
// Every payload must render as literal text: no image with the payload's src, no inline script, no inline
// event-handler attribute, and window.__xss never set.

const {
  test,
  expect,
  gotoApp,
  speakerCards,
  makeProject,
  makeSpeaker,
  REGISTRY_KEY,
  CURRENT_PROJECT_KEY,
} = require("./fixtures");

// Does not end in a quote: the naive CSV parser strips a trailing quote from every column.
const QUOTE = `O'Brien "Quoted" Jr.`;
const IMG = `"><img src=x onerror=window.__xss=1>`;
const SCRIPT = `<script>window.__xss=1</script>`;
const PAYLOADS = [
  { kind: "quote", payload: QUOTE },
  { kind: "img", payload: IMG },
  { kind: "script", payload: SCRIPT },
];

/** Fails the test if any native dialog (e.g. alert(1)) opens. */
function failOnDialog(page) {
  const seen = [];
  page.on("dialog", async (d) => {
    seen.push(d.message());
    await d.dismiss();
  });
  return seen;
}

/**
 * Asserts that `literal` is rendered as plain text inside `scope` and that nothing was injected: no image with
 * the payload's src, no inline script, no inline event-handler attribute, and window.__xss never set.
 */
async function expectInert(page, scope, literal) {
  await expect(scope).toContainText(literal);
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  await expect(page.locator("script:not([src])")).toHaveCount(0);
  await expect(page.locator("[onmouseover]")).toHaveCount(0);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
}

function seedProjectWith(seedStorage, project) {
  return seedStorage({ [REGISTRY_KEY]: [project], [CURRENT_PROJECT_KEY]: project.id, spd_ui_mode: "advanced" });
}

function payloadSpeaker(payload) {
  return makeSpeaker({
    id: "spk-xss",
    fullName: `Name ${payload}`,
    title: `Title ${payload}`,
    notes: `Notes ${payload}`,
    mic: `Mic ${payload}`,
  });
}

test.describe("HTML escaping of user-provided text (plan Phase 5)", () => {
  for (const { kind, payload } of PAYLOADS) {
    test.describe(`payload: ${kind}`, () => {
      test("speaker card renders name/title/notes/mic as text", async ({ page, seedStorage }) => {
        const dialogs = failOnDialog(page);
        await seedProjectWith(seedStorage, makeProject({ id: "proj-xss", speakers: [payloadSpeaker(payload)] }));
        await gotoApp(page);
        const card = speakerCards(page).first();
        for (const field of ["Name", "Title", "Notes", "Mic"]) await expectInert(page, card, `${field} ${payload}`);
        expect(dialogs).toEqual([]);
      });

      test("print preview renders speaker fields as text", async ({ page, seedStorage }) => {
        await seedProjectWith(seedStorage, makeProject({ id: "proj-xss", speakers: [payloadSpeaker(payload)] }));
        await gotoApp(page);
        await page.locator("#btn-open-print-modal").click();
        const grid = page.locator("#print-preview-grid");
        for (const field of ["Name", "Title", "Notes", "Mic"]) await expectInert(page, grid, `${field} ${payload}`);
      });

      test("project list renders project titles as text", async ({ page, seedStorage }) => {
        await seedStorage({
          [REGISTRY_KEY]: [makeProject({ id: "proj-1" }), makeProject({ id: "proj-2", title: `Project ${payload}` })],
          [CURRENT_PROJECT_KEY]: "proj-1",
        });
        await gotoApp(page);
        await page.locator("#btn-projects-menu").click();
        await expectInert(page, page.locator("#projects-list-container"), `Project ${payload}`);
      });

      test("toasts render names as text", async ({ page }) => {
        await gotoApp(page);
        await page.locator("#btn-projects-menu").click();
        await page.locator("#new-project-title-input").fill(`Event ${payload}`);
        await page.locator("#btn-create-new-project").click();
        await expectInert(page, page.locator("#toast-container"), `Created new project: "Event ${payload}"`);

        await page.locator("#btn-add-speaker").click();
        await page.locator("#form-fullname").fill(`Toast ${payload}`);
        await page.locator("#form-title").fill("Tester");
        await page.locator("#speaker-modal").getByRole("button", { name: "Save Speaker" }).click();
        await expectInert(page, page.locator("#toast-container"), `Added Toast ${payload}`);
      });

      test("mic names render as text in the inventory, dropdown and quick menu", async ({ page, seedStorage }) => {
        const micName = `Mic ${payload}`;
        await seedProjectWith(
          seedStorage,
          makeProject({ id: "proj-xss", micInventory: [{ name: micName, type: "lav" }] }),
        );
        await gotoApp(page);
        await page.locator("#btn-manage-mics").click();
        await expectInert(page, page.locator("#mic-inventory-container"), micName);
        await page.locator("#mics-manager-modal").getByRole("button", { name: "Done" }).click();

        await speakerCards(page).first().locator('[data-action="quick-mic"]').click();
        await expectInert(page, page.locator("#quick-mic-menu"), micName);
        await page.locator("#speaker-count").click();

        await page.locator("#btn-add-speaker").click();
        await expect(page.locator("#form-mic-preset option").first()).toHaveText(micName);
        expect(await page.evaluate(() => window.__xss)).toBeUndefined();
      });

      test("JSON import renders imported speakers as text", async ({ page, seedStorage }) => {
        await seedStorage({ spd_ui_mode: "advanced" });
        await gotoApp(page);
        await page.locator("#btn-import-export").click();
        const data = { projectTitle: `Imported ${payload}`, speakers: [payloadSpeaker(payload)], micInventory: [] };
        await page.locator("#import-file-input").setInputFiles({
          name: "xss.json",
          mimeType: "application/json",
          buffer: Buffer.from(JSON.stringify(data)),
        });
        await expect(speakerCards(page)).toHaveCount(1);
        await expectInert(page, speakerCards(page).first(), `Name ${payload}`);
        await expectInert(page, page.locator("#toast-container"), "Imported 1 speakers!");
      });

      test("CSV import renders imported speakers as text", async ({ page, seedStorage }) => {
        await seedStorage({ spd_ui_mode: "advanced" });
        await gotoApp(page);
        await page.locator("#btn-import-export").click();
        // The payloads contain no commas, so the naive CSV splitter keeps them in one column
        const csv = `Full Name,Title,Mic Assignment,Mic Type,Photo URL,Notes\nName ${payload},Title ${payload},Mic ${payload},lav,,Notes ${payload}\n`;
        await page.locator("#import-file-input").setInputFiles({
          name: "xss.csv",
          mimeType: "text/csv",
          buffer: Buffer.from(csv),
        });
        await expect(speakerCards(page)).toHaveCount(1);
        const card = speakerCards(page).first();
        for (const field of ["Name", "Title", "Notes", "Mic"]) await expectInert(page, card, `${field} ${payload}`);
      });
    });
  }

  test("imported javascript: photo URL and attribute-breaking micType are sanitized", async ({ page, seedStorage }) => {
    const dialogs = failOnDialog(page);
    await seedStorage({ spd_ui_mode: "advanced" });
    await gotoApp(page);
    await page.locator("#btn-import-export").click();
    const evil = makeSpeaker({
      id: "spk-evil",
      fullName: "Evil Import",
      photo: "javascript:alert(1)",
      micType: 'x" onmouseover="window.__xss=1',
    });
    await page.locator("#import-file-input").setInputFiles({
      name: "evil.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify([evil])),
    });
    await expect(speakerCards(page)).toHaveCount(1);

    const card = speakerCards(page).first();
    await card.locator('[data-action="quick-mic"]').hover();

    await expect(page.locator("[onmouseover]")).toHaveCount(0);
    await expect(page.locator('[src^="javascript:" i], [href^="javascript:" i]')).toHaveCount(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    expect(dialogs).toEqual([]);
  });
  test("stored speakers with a javascript: photo or a hostile micType are repaired on load", async ({
    page,
    seedStorage,
  }) => {
    const evil = makeSpeaker({
      id: "spk-evil",
      fullName: "Stored Evil",
      photo: "javascript:window.__xss=1",
      micType: 'x" onmouseover="window.__xss=1',
    });
    await seedProjectWith(seedStorage, makeProject({ id: "proj-evil", speakers: [evil] }));
    await gotoApp(page);
    const card = speakerCards(page).first();
    await card.locator('[data-action="quick-mic"]').hover();
    await expect(card.locator("img.speaker-img")).toHaveAttribute("src", /^data:image\/svg\+xml,.*%3ESE%3C%2Ftext%3E/);
    await expect(card.locator('[data-action="quick-mic"]')).toHaveClass(/(^|\s)mic-none(\s|$)/);
    await expect(page.locator("[onmouseover]")).toHaveCount(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  });

  test("a javascript: photo URL typed into the photo lookup is rejected", async ({ page }) => {
    await gotoApp(page);
    const before = await page.evaluate(() => app.speakers[0].photo);
    await page.evaluate(() => {
      app.activeTargetSpeakerIdForPhoto = app.speakers[0].id;
      app.openPhotoLookupModal("");
    });
    await page.locator("#quick-url-input").fill("javascript:window.__xss=1");
    await page.locator("#btn-quick-url-apply").click();
    await expect(page.locator("#toast-container")).toContainText("Photo not applied");
    expect(await page.evaluate(() => app.speakers[0].photo)).toBe(before);

    // data:image URLs (file upload, camera, pasted images) are still accepted
    const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
    await page.evaluate((url) => app.selectPhoto(url), dataUrl);
    expect(await page.evaluate(() => app.speakers[0].photo)).toBe(dataUrl);
    await expect(page.locator('[src^="javascript:" i]')).toHaveCount(0);
  });

  test("photo search results render API text as text and drop non-http URLs", async ({ page }) => {
    await page.route("https://en.wikipedia.org/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({
          query: {
            pages: {
              1: { title: `Wiki ${IMG}`, thumbnail: { source: "javascript:window.__xss=1" } },
              2: { title: `Wiki2 ${IMG}`, thumbnail: { source: "https://upload.example.test/a.jpg" } },
            },
          },
        }),
      }),
    );
    await gotoApp(page);
    await page.evaluate(() => app.openPhotoLookupModal("Ada"));
    const results = page.locator("#online-search-results");
    await expectInert(page, results, `Wiki2 ${IMG}`);
    await expect(results.locator(".photo-result-item")).toHaveCount(1);
    await expect(page.locator('[src^="javascript:" i], [data-url^="javascript:" i]')).toHaveCount(0);
    await page.evaluate(() => app.closeModal("photo-lookup-modal"));

    // (The inline suggestion strip in the speaker form shares this code path, but its container is not in
    // index.html, so updateInlineSuggestedPhotos() returns early and cannot be exercised here.)
    await expect(page.locator('img[src="x"]')).toHaveCount(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  });

  test("the photo search query and Google API errors render as text", async ({ page, seedStorage, desktopSecrets }) => {
    // The Search API key only exists in the desktop app's encrypted store (faked here); the CX id is in localStorage
    await desktopSecrets({ initial: { gsearchApiKey: "test-key" } });
    await seedStorage({ spd_gsearch_cx_id: "test-cx" });
    await page.route("https://www.googleapis.com/customsearch/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({ error: { message: `CSE ${IMG}` } }),
      }),
    );
    await gotoApp(page);
    await page.evaluate((q) => app.openPhotoLookupModal(q), `Query ${IMG}`);
    await expectInert(page, page.locator("#online-search-results"), `No exact photos found for "Query ${IMG}"`);
    await expectInert(page, page.locator("#gsearch-api-status"), `Google Error: CSE ${IMG}`);
  });

  test.describe("Backup folder UI (fake desktop folder bridge)", () => {
    const backupProject = {
      id: "proj-drive",
      title: `Drive ${IMG}`,
      speakers: [
        { id: "d1", fullName: `Restored ${IMG}`, photo: "javascript:window.__xss=1", micType: 'x" onmouseover="x' },
        42,
        null,
        { fullName: "" },
      ],
      micInventory: [{ name: `DMic ${IMG}`, type: "lav" }, "junk"],
    };

    test.beforeEach(async ({ seedStorage, desktopSyncFolder }) => {
      await desktopSyncFolder({
        folder: `C:\\Drive\\Folder ${IMG}`,
        files: {
          "Backup_Drive.json": JSON.stringify({ schemaVersion: "speaker-directory-v1", project: backupProject }),
        },
      });
      await seedStorage({ spd_ui_mode: "advanced" });
    });

    test("folder and file names render as text, restore is normalized", async ({ page }) => {
      const dialogs = [];
      page.on("dialog", async (d) => {
        dialogs.push(d.message());
        await d.accept();
      });
      await gotoApp(page);
      // A (compromised or buggy) bridge that lists a name the allowlist would never produce
      await page.evaluate((img) => {
        const api = window.electronAPI.syncFolder;
        const list = api.list.bind(api);
        api.list = async () => [
          ...(await list()),
          { name: `Backup ${img}.json`, modifiedTime: `2026 ${img}` },
          { name: `RunSheet ${img}.csv`, modifiedTime: "2026-01-01T10:00:00Z" },
        ];
      }, IMG);
      await page.locator("#btn-sync-menu").click();
      await expectInert(page, page.locator("#sync-folder-label"), `Folder ${IMG}`);
      await expectInert(page, page.locator("#sync-folder-path"), `C:\\Drive\\Folder ${IMG}`);
      await expectInert(page, page.locator("#sync-btn-label"), "Backups:");
      const backups = page.locator("#sync-backups-container");
      await expectInert(page, backups, `Backup ${IMG}.json`);
      await expectInert(page, backups, `RunSheet ${IMG}.csv`);

      await backups.locator('[data-action="restore-backup"][data-file="Backup_Drive.json"]').click();
      await expect(speakerCards(page)).toHaveCount(1);
      const card = speakerCards(page).first();
      await expectInert(page, card, `Restored ${IMG}`);
      await expect(card.locator("img.speaker-img")).toHaveAttribute("src", /^data:image\/svg\+xml,/);
      await expect(card.locator('[data-action="quick-mic"]')).toHaveClass(/(^|\s)mic-none(\s|$)/);
      await expectInert(page, page.locator("#toast-container"), `Restored "Drive ${IMG}" from the backup folder`);
      await expect(page.locator("#project-title-display")).toHaveText(`Drive ${IMG}`);

      const project = await page.evaluate(() => ({ speakers: app.speakers, micInventory: app.micInventory }));
      expect(project.speakers).toHaveLength(1);
      expect(project.speakers[0].micType).toBe("none");
      expect(project.micInventory).toEqual([{ name: `DMic ${IMG}`, type: "lav" }]);
      await expect(page.locator('[src^="javascript:" i], [href^="javascript:" i]')).toHaveCount(0);
      expect(dialogs).toEqual([
        "Restore this project from the backup folder? Your active workspace will load this backup.",
      ]);
    });

    test("folder error messages render as text", async ({ page }) => {
      await gotoApp(page);
      await page.evaluate((img) => {
        window.electronAPI.syncFolder.list = async () => {
          throw new Error(`Error invoking remote method 'syncFolder:list': Error: Quota ${img}`);
        };
      }, IMG);
      await page.locator("#btn-sync-menu").click();
      await expectInert(page, page.locator("#sync-backups-container"), `Failed to load backups: Quota ${IMG}`);
    });
  });
});
