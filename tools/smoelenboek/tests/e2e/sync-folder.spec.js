// Backup folder (replaces the Google Drive sign-in): backups and run sheets are files in a folder that Google Drive
// for desktop, OneDrive or Dropbox syncs. Covered against both backends:
// - desktop: the fixture's fake window.electronAPI.syncFolder bridge (installFakeSyncFolder); the real main-process
//   file I/O is covered by electron.spec.js;
// - browser: the real File System Access code path, with showDirectoryPicker handing out a Chromium OPFS directory
//   (installOpfsDirectoryPicker).
const {
  test,
  expect,
  gotoApp,
  speakerCards,
  acceptNextDialog,
  readJsonStorage,
  readOpfsFile,
  writeOpfsFile,
  makeProject,
  makeSpeaker,
  REGISTRY_KEY,
  CURRENT_PROJECT_KEY,
} = require("./fixtures");

const SYNC_CONFIG_KEY = "spd_sync_folder_v1";
const SUBFOLDER = "Speaker Photo Directory";
const BACKUP = "Backup_Speaker_Photo_Directory.json";
const RUN_SHEET = "RunSheet_Speaker_Photo_Directory.csv";

const fakeFiles = (page) =>
  page.evaluate(() => Object.fromEntries([...window.__fakeSync.files].map(([name, f]) => [name, f.content])));
const fakeCalls = (page) => page.evaluate(() => window.__fakeSync.calls);

function seedAdvanced(seedStorage, entries = {}) {
  return seedStorage({ spd_ui_mode: "advanced", ...entries });
}

async function openSyncModal(page) {
  await page.locator("#btn-sync-menu").click();
  await expect(page.locator("#sync-modal")).toBeVisible();
}

test.describe("file name helpers", () => {
  test("syncFileName builds allowlisted names; isSyncFileName and normalizeSyncConfig reject the rest", async ({
    page,
  }) => {
    await gotoApp(page);
    const result = await page.evaluate(() => ({
      names: [
        syncFileName("Backup", "Gala 2026 <b>", "json"),
        syncFileName("RunSheet", "", "csv"),
        syncFileName("Backup", "x".repeat(300), "json").length,
      ],
      allowed: ["Backup_Gala.json", "RunSheet_A-b_1.csv", "Backup_" + "x".repeat(100) + ".json"].map(isSyncFileName),
      rejected: [
        "../Backup_x.json",
        "Backup_x.exe",
        "Backup_.json",
        "Backup_a b.json",
        "Notes_x.json",
        "backup_x.json",
        "Backup_x.json.tmp",
        "Backup_" + "x".repeat(101) + ".json",
        null,
      ].map(isSyncFileName),
      config: normalizeSyncConfig({
        autoSync: false,
        lastSyncTime: "2026-01-01T00:00:00.000Z",
        folder: "C:\\Secret",
        savedAccessToken: "t",
      }),
      defaults: normalizeSyncConfig("junk"),
    }));
    expect(result.names).toEqual(["Backup_Gala_2026__b_.json", "RunSheet_Speaker_Directory.csv", 112]);
    expect(result.allowed).toEqual([true, true, true]);
    expect(result.rejected.every((ok) => ok === false)).toBe(true);
    expect(result.config).toEqual({ autoSync: false, lastSyncTime: "2026-01-01T00:00:00.000Z" });
    expect(result.defaults).toEqual({ autoSync: true, lastSyncTime: null });
  });
});

test.describe("desktop app (fake folder bridge)", () => {
  test("choose a folder, back up, export the run sheet and list the backups", async ({
    page,
    seedStorage,
    desktopSyncFolder,
  }) => {
    await desktopSyncFolder({ folder: null });
    await seedAdvanced(seedStorage);
    await gotoApp(page);
    await expect(page.locator("#sync-btn-label")).toHaveText("Backup folder");
    await openSyncModal(page);
    await expect(page.locator("#sync-unsupported-note")).toBeHidden();
    await expect(page.locator("#sync-folder-label")).toHaveText("No folder chosen");
    await expect(page.locator("#sync-actions-section")).toHaveClass(/sync-disabled/);
    await expect(page.locator("#btn-sync-now")).toBeDisabled();
    await expect(page.locator("#btn-sync-forget-folder")).toBeHidden();

    await page.locator("#btn-sync-choose-folder").click();
    await expect(page.locator("#sync-folder-label")).toHaveText(SUBFOLDER);
    await expect(page.locator("#sync-folder-path")).toHaveText("C:\\Fake Drive\\Team\\Speaker Photo Directory");
    await expect(page.locator("#sync-folder-status")).toHaveText("Ready");
    await expect(page.locator("#sync-actions-section")).not.toHaveClass(/sync-disabled/);
    await expect(page.locator("#btn-sync-choose-folder")).toHaveText("Change folder…");
    await expect(page.locator("#sync-btn-label")).toHaveText("Backups: Speaker Photo D…");
    await expect(page.locator("#sync-status-dot")).toHaveClass(/sync-dot-ok/);

    await page.locator("#btn-sync-now").click();
    await expect(page.locator("#toast-container")).toContainText(`Saved "${BACKUP}" to the backup folder`);
    await page.locator("#btn-sync-export-csv").click();
    await expect(page.locator("#toast-container")).toContainText(`Saved "${RUN_SHEET}" to the backup folder`);

    const files = await fakeFiles(page);
    expect(Object.keys(files).sort()).toEqual([BACKUP, RUN_SHEET]);
    const backup = JSON.parse(files[BACKUP]);
    expect(backup.schemaVersion).toBe("speaker-directory-v1");
    expect(Object.keys(backup.project).sort()).toEqual(["id", "lastModified", "micInventory", "speakers", "title"]);
    expect(backup.project.speakers).toHaveLength(8);
    expect(files[RUN_SHEET].split("\n")[0]).toBe("Full Name,Job Title,Microphone,Mic Type,Photo URL,Stage Notes");

    const backups = page.locator("#sync-backups-container");
    await expect(backups).toContainText(BACKUP);
    await expect(backups).toContainText(RUN_SHEET);
    // Restore only for JSON backups, "show in folder" for every file in the desktop app
    await expect(backups.locator('[data-action="restore-backup"]')).toHaveCount(1);
    await expect(backups.locator('[data-action="reveal-backup"]')).toHaveCount(2);
    await expect(page.locator("#sync-last-sync-label")).not.toHaveText("Last backup: never");

    // The folder path stays in the main process: localStorage only has the two settings
    const config = await readJsonStorage(page, SYNC_CONFIG_KEY);
    expect(Object.keys(config).sort()).toEqual(["autoSync", "lastSyncTime"]);
    expect(JSON.stringify(await page.evaluate(() => ({ ...localStorage })))).not.toContain("Fake Drive");
  });

  test("the run sheet is written with the CSV formula guard", async ({ page, seedStorage, desktopSyncFolder }) => {
    await desktopSyncFolder();
    const project = makeProject({ speakers: [makeSpeaker({ fullName: "=HYPERLINK(1)", notes: "@SUM(A1)" })] });
    await seedAdvanced(seedStorage, { [REGISTRY_KEY]: [project], [CURRENT_PROJECT_KEY]: project.id });
    await gotoApp(page);
    await openSyncModal(page);
    await page.locator("#btn-sync-export-csv").click();
    await expect.poll(async () => Object.keys(await fakeFiles(page))).toEqual(["RunSheet_Seeded_Project.csv"]);
    const row = (await fakeFiles(page))["RunSheet_Seeded_Project.csv"].split("\n")[1];
    expect(row).toContain(`"'=HYPERLINK(1)"`);
    expect(row).toContain(`"'@SUM(A1)"`);
  });

  test("every save backs up automatically after 3 s, unless auto-backup is off", async ({
    page,
    seedStorage,
    desktopSyncFolder,
  }) => {
    await desktopSyncFolder();
    await seedAdvanced(seedStorage);
    await gotoApp(page);
    await expect.poll(() => page.evaluate(() => window.syncFolderService.isReady)).toBe(true);

    await page.evaluate(() => {
      app.projectTitle = "Auto Saved";
      app.saveCurrentProjectState();
    });
    await page.waitForTimeout(1500);
    expect(await fakeFiles(page)).toEqual({});
    await expect
      .poll(async () => Object.keys(await fakeFiles(page)), { timeout: 6000 })
      .toEqual(["Backup_Auto_Saved.json"]);
    // No toast or alert for the silent auto-backup
    await expect(page.locator("#toast-container")).not.toContainText("Saved");

    await openSyncModal(page);
    await page.locator("#sync-autosync-toggle").uncheck();
    expect((await readJsonStorage(page, SYNC_CONFIG_KEY)).autoSync).toBe(false);
    await page.evaluate(() => {
      app.projectTitle = "Not Saved";
      app.saveCurrentProjectState();
    });
    await page.waitForTimeout(3600);
    expect(Object.keys(await fakeFiles(page))).toEqual(["Backup_Auto_Saved.json"]);
  });

  test("restore loads a normalized backup into the active project", async ({
    page,
    seedStorage,
    desktopSyncFolder,
  }) => {
    const backup = {
      schemaVersion: "speaker-directory-v1",
      project: {
        id: "proj-other",
        title: "From Drive",
        speakers: [makeSpeaker({ fullName: "Grace Hopper", micType: "bogus" })],
        micInventory: [{ name: "HH 9", type: "handheld" }],
      },
    };
    await desktopSyncFolder({ files: { "Backup_From_Drive.json": JSON.stringify(backup), "Backup_Bad.json": "[1,2" } });
    await seedAdvanced(seedStorage);
    await gotoApp(page);
    await openSyncModal(page);
    const container = page.locator("#sync-backups-container");

    const badDialogs = [];
    page.on("dialog", async (d) => {
      badDialogs.push(d.message());
      await d.accept();
    });
    await container.locator('[data-file="Backup_Bad.json"][data-action="restore-backup"]').click();
    await expect.poll(() => badDialogs.length).toBe(2);
    expect(badDialogs[1]).toMatch(/^Failed to restore backup: /);
    await expect(speakerCards(page)).toHaveCount(8);

    await container.locator('[data-file="Backup_From_Drive.json"][data-action="restore-backup"]').click();
    await expect(page.locator("#sync-modal")).toBeHidden();
    await expect(page.locator("#project-title-display")).toHaveText("From Drive");
    await expect(speakerCards(page)).toHaveCount(1);
    expect(await page.evaluate(() => [app.speakers[0].micType, app.micInventory])).toEqual([
      "none",
      [{ name: "HH 9", type: "handheld" }],
    ]);
    // Restored into the active project (its id is kept), and saved
    const registry = await readJsonStorage(page, REGISTRY_KEY);
    const current = await page.evaluate(() => app.currentProjectId);
    expect(registry.find((p) => p.id === current).title).toBe("From Drive");
  });

  test("an unavailable folder (Drive not running) disables backups without errors", async ({
    page,
    seedStorage,
    desktopSyncFolder,
    consoleErrors,
  }) => {
    await desktopSyncFolder({ accessible: false });
    await seedAdvanced(seedStorage);
    await gotoApp(page);
    await openSyncModal(page);
    await expect(page.locator("#sync-folder-status")).toHaveText("Folder not found (is Google Drive running?)");
    await expect(page.locator("#sync-status-dot")).toHaveClass(/sync-dot-warn/);
    await expect(page.locator("#btn-sync-now")).toBeDisabled();
    await expect(page.locator("#btn-sync-reconnect")).toBeHidden();
    await expect(page.locator("#btn-sync-forget-folder")).toBeVisible();
    await expect(page.locator("#btn-sync-reveal-folder")).toBeHidden();
    await expect(page.locator("#sync-backups-container")).toContainText("Choose a backup folder");

    await page.evaluate(() => app.saveCurrentProjectState());
    await page.waitForTimeout(3500);
    expect((await fakeCalls(page)).filter(([op]) => op === "write")).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test("forget clears the folder but keeps the files; reveal asks the main process", async ({
    page,
    seedStorage,
    desktopSyncFolder,
  }) => {
    await desktopSyncFolder({ files: { [BACKUP]: "{}" } });
    await seedAdvanced(seedStorage);
    await gotoApp(page);
    await openSyncModal(page);

    await page.locator('#sync-backups-container [data-action="reveal-backup"]').click();
    await page.locator("#btn-sync-reveal-folder").click();
    await expect
      .poll(async () => (await fakeCalls(page)).filter(([op]) => op === "reveal"))
      .toEqual([["reveal", BACKUP], ["reveal"]]);

    const message = acceptNextDialog(page);
    await page.locator("#btn-sync-forget-folder").click();
    expect(await message).toBe("Forget this backup folder? The files in it are kept.");
    await expect(page.locator("#sync-folder-label")).toHaveText("No folder chosen");
    await expect(page.locator("#btn-sync-choose-folder")).toHaveText("Choose folder…");
    expect(Object.keys(await fakeFiles(page))).toEqual([BACKUP]);
  });

  test("view-only mode hides the button and refuses a restore called directly", async ({ page, desktopSyncFolder }) => {
    await desktopSyncFolder({
      files: { [BACKUP]: JSON.stringify({ project: { title: "Hijack", speakers: [makeSpeaker()] } }) },
    });
    await gotoApp(page, "/?view=readonly");
    await expect(page.locator("#btn-sync-menu")).toBeHidden();
    const message = acceptNextDialog(page);
    await page.evaluate(async (file) => {
      const btn = document.createElement("button");
      btn.dataset.file = file;
      await window.syncController.restoreBackup(btn);
    }, BACKUP);
    expect(await message).toBe("Restoring is not available in view-only mode.");
    expect((await fakeCalls(page)).filter(([op]) => op === "read")).toEqual([]);
    await expect(speakerCards(page)).toHaveCount(8);
  });
});

test.describe("browser (File System Access API, OPFS-backed picker)", () => {
  test("choose a folder, back up, reload and restore", async ({ page, seedStorage, browserSyncFolder }) => {
    await browserSyncFolder();
    await seedAdvanced(seedStorage);
    await gotoApp(page);
    expect(await page.evaluate(() => window.syncFolderService.kind)).toBe("browser");
    await openSyncModal(page);
    await expect(page.locator("#sync-unsupported-note")).toBeHidden();
    await page.locator("#btn-sync-choose-folder").click();
    // The app's own subfolder is created inside the picked folder; the browser knows no full path
    await expect(page.locator("#sync-folder-label")).toHaveText(SUBFOLDER);
    await expect(page.locator("#sync-folder-path")).toBeHidden();
    await expect(page.locator("#btn-sync-reveal-folder")).toBeHidden();

    await page.locator("#btn-sync-now").click();
    await expect(page.locator("#toast-container")).toContainText(`Saved "${BACKUP}"`);
    const written = JSON.parse(await readOpfsFile(page, ["My Drive", SUBFOLDER, BACKUP]));
    expect(written.schemaVersion).toBe("speaker-directory-v1");
    expect(written.project.speakers).toHaveLength(8);

    // Overwrites in place (createWritable), no temp files left behind
    await page.locator("#btn-sync-now").click();
    await expect(page.locator('#sync-backups-container [data-action="restore-backup"]')).toHaveCount(1);
    await expect(page.locator('#sync-backups-container [data-action="reveal-backup"]')).toHaveCount(0);

    // The folder handle survives a reload (IndexedDB)
    await page.evaluate(() => {
      app.projectTitle = "Changed";
      app.speakers = [];
      app.saveCurrentProjectState();
    });
    await page.reload();
    await expect(speakerCards(page)).toHaveCount(0);
    await openSyncModal(page);
    await expect(page.locator("#sync-folder-status")).toHaveText("Ready");
    page.once("dialog", (d) => d.accept());
    await page.locator(`#sync-backups-container [data-file="${BACKUP}"][data-action="restore-backup"]`).click();
    await expect(speakerCards(page)).toHaveCount(8);
    await expect(page.locator("#project-title-display")).toHaveText("Speaker Photo Directory");
  });

  test("after a restart the browser asks again: Reconnect folder restores access", async ({
    page,
    seedStorage,
    browserSyncFolder,
    consoleErrors,
  }) => {
    await browserSyncFolder({ permission: "prompt" });
    await seedAdvanced(seedStorage);
    await gotoApp(page);
    await openSyncModal(page);
    await page.locator("#btn-sync-choose-folder").click();
    await expect(page.locator("#sync-folder-status")).toHaveText("Ready");
    await page.locator("#btn-sync-now").click();
    await expect(page.locator("#toast-container")).toContainText("Saved");

    await page.reload();
    await openSyncModal(page);
    await expect(page.locator("#sync-folder-status")).toHaveText("The browser needs your permission again");
    await expect(page.locator("#btn-sync-reconnect")).toBeVisible();
    await expect(page.locator("#btn-sync-now")).toBeDisabled();
    await expect(page.locator("#sync-status-dot")).toHaveClass(/sync-dot-warn/);
    // Auto-backup quietly waits for the permission
    await page.evaluate(() => app.saveCurrentProjectState());
    await page.waitForTimeout(3500);

    await page.locator("#btn-sync-reconnect").click();
    await expect(page.locator("#sync-folder-status")).toHaveText("Ready");
    await expect(page.locator("#btn-sync-reconnect")).toBeHidden();
    await expect(page.locator("#sync-backups-container")).toContainText(BACKUP);
    expect(await page.evaluate(() => window.__fakePicker.requests)).toBe(1);
    expect(consoleErrors).toEqual([]);
  });

  test("a cancelled picker changes nothing and shows no error", async ({ page, seedStorage, browserSyncFolder }) => {
    await browserSyncFolder({ cancel: true });
    await seedAdvanced(seedStorage);
    const dialogs = [];
    page.on("dialog", (d) => {
      dialogs.push(d.message());
      return d.dismiss();
    });
    await gotoApp(page);
    await openSyncModal(page);
    await page.locator("#btn-sync-choose-folder").click();
    await expect.poll(() => page.evaluate(() => window.__fakePicker.calls)).toBe(1);
    await expect(page.locator("#sync-folder-label")).toHaveText("No folder chosen");
    await expect(page.locator("#btn-sync-choose-folder")).toBeEnabled();
    expect(dialogs).toEqual([]);
  });

  test("picking the app's own subfolder uses it as is; other files in it are not listed", async ({
    page,
    seedStorage,
    browserSyncFolder,
  }) => {
    await browserSyncFolder({ pickedName: SUBFOLDER });
    await seedAdvanced(seedStorage);
    await gotoApp(page);
    for (const name of ["notes.txt", "Backup_a b.json", "Backup_Other.json.tmp", "Backup_Other.json"]) {
      await writeOpfsFile(page, [SUBFOLDER, name], "{}");
    }
    await openSyncModal(page);
    await page.locator("#btn-sync-choose-folder").click();
    await page.locator("#btn-sync-now").click();
    await expect(page.locator("#toast-container")).toContainText("Saved");
    // Written straight into the picked folder, not into a nested subfolder
    expect(JSON.parse(await readOpfsFile(page, [SUBFOLDER, BACKUP])).schemaVersion).toBe("speaker-directory-v1");

    const restoreButtons = page.locator('#sync-backups-container [data-action="restore-backup"]');
    await expect(restoreButtons).toHaveCount(2);
    expect((await restoreButtons.evaluateAll((els) => els.map((el) => el.dataset.file))).sort()).toEqual([
      "Backup_Other.json",
      BACKUP,
    ]);
  });

  test("without the File System Access API the panel is disabled and points to Import / Export", async ({
    page,
    seedStorage,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "showDirectoryPicker", { value: undefined, configurable: true });
    });
    await seedAdvanced(seedStorage);
    await gotoApp(page);
    expect(await page.evaluate(() => window.syncFolderService.supported)).toBe(false);
    await expect(page.locator("#sync-btn-label")).toHaveText("Backups (desktop app)");
    await expect(page.locator("#btn-sync-menu")).toHaveAttribute("title", /desktop app, or Chrome or Edge/);
    await openSyncModal(page);
    await expect(page.locator("#sync-unsupported-note")).toBeVisible();
    await expect(page.locator("#sync-unsupported-note")).toContainText("Import / Export");
    for (const id of ["btn-sync-choose-folder", "btn-sync-now", "btn-sync-export-csv", "sync-autosync-toggle"]) {
      await expect(page.locator(`#${id}`), id).toBeDisabled();
    }
    await expect(page.locator("#sync-autosync-toggle")).not.toBeChecked();
    await expect(page.locator("#sync-backups-container")).toContainText("Backup folders need the desktop app");
    expect(
      await page.evaluate(async () => {
        try {
          await window.syncFolderService.write("Backup_x.json", "{}");
          return "allowed";
        } catch (e) {
          return e.message;
        }
      }),
    ).toBe("Backup folders are not supported here");
  });
});
