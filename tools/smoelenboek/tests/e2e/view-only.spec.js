const { test, expect, gotoApp, speakerCards, speakerCard, filterChip, readCurrentProject } = require("./fixtures");

// Controls that are hidden in view-only mode (they carry the btn-edit-only marker in index.html)
const EDIT_CONTROLS = ["#btn-projects-menu", "#btn-add-speaker", "#btn-remove-all-speakers", "#btn-edit-title"];

for (const path of ["/?view=readonly", "/?mode=view"]) {
  test.describe(`view-only mode via ${path}`, () => {
    test.beforeEach(async ({ page }) => {
      await gotoApp(page, path);
      await expect(speakerCards(page)).toHaveCount(8);
    });

    test("adds the view-only class and banner and hides edit controls", async ({ page }) => {
      await expect(page.locator("body")).toHaveClass(/(^|\s)view-only(\s|$)/);
      await expect(page.locator("#view-only-banner")).toBeVisible();
      await expect(page.locator("#link-switch-edit")).toHaveAttribute("href", "?");
      for (const sel of EDIT_CONTROLS) await expect(page.locator(sel)).toBeHidden();

      const card = speakerCards(page).first();
      for (const action of ["edit", "delete", "lookup-photo"]) {
        for (const btn of await card.locator(`[data-action="${action}"]`).all()) await expect(btn).toBeHidden();
      }
      // Printing stays available to viewers
      await expect(page.locator("#btn-open-print-modal")).toBeVisible();
    });

    test("card actions are not wired up (forced clicks do nothing)", async ({ page }) => {
      const card = speakerCard(page, "Marcus Vance");
      // Hidden buttons: dispatch the click directly
      await card.locator('[data-action="edit"]').first().dispatchEvent("click");
      await expect(page.locator("#speaker-modal")).toBeHidden();

      let dialogSeen = false;
      page.on("dialog", (d) => {
        dialogSeen = true;
        d.dismiss();
      });
      await card.locator('[data-action="delete"]').dispatchEvent("click");
      expect(dialogSeen).toBe(false);

      await card.locator('[data-action="quick-mic"]').click();
      await expect(page.locator("#quick-mic-menu")).toBeHidden();

      await expect(speakerCards(page)).toHaveCount(8);
      expect((await readCurrentProject(page)).speakers[1].mic).toBe("Handheld 1");
    });

    test("editing entry points return early", async ({ page }) => {
      await page.locator("#project-title-display").click();
      await expect(page.locator("#project-title-input")).toBeHidden();

      await page.evaluate(() => {
        app.openSpeakerModal();
        app.openSpeakerModal("spk-1");
        app.enableTitleEditing();
        app.toggleReorderMode(true);
      });
      await expect(page.locator("#speaker-modal")).toBeHidden();
      await expect(page.locator("#project-title-input")).toBeHidden();
      expect(await page.evaluate(() => app.isViewOnly)).toBe(true);
      expect(await page.evaluate(() => app.isReorderMode)).toBe(false);
    });

    test("search, filters and the print preview still work", async ({ page }) => {
      await page.locator("#search-input").fill("elena");
      await expect(speakerCards(page)).toHaveCount(1);
      await page.locator("#search-input").fill("");
      await filterChip(page, "headset").click();
      await expect(speakerCards(page)).toHaveCount(2);

      await page.locator("#btn-open-print-modal").click();
      await expect(page.locator("#print-preview-grid > *")).toHaveCount(8);
    });
  });
}

test("the normal editor page does not have the view-only class", async ({ page }) => {
  await gotoApp(page);
  await expect(page.locator("body")).not.toHaveClass(/(^|\s)view-only(\s|$)/);
  await expect(page.locator("#view-only-banner")).toBeHidden();
  await expect(page.locator("#btn-add-speaker")).toBeVisible();
  expect(await page.evaluate(() => app.isViewOnly)).toBe(false);
});

// Every mutating method returns early in view-only mode, also when called directly (not only through the UI).
test.describe("view-only mode blocks mutating methods called directly", () => {
  const calls = {
    deleteSpeaker: () => app.deleteSpeaker("spk-1"),
    confirmRemoveAll: () => app.confirmRemoveAll(),
    handleFormSubmit: () => {
      app.formFullName.value = "Injected";
      app.formTitle.value = "Nope";
      app.handleFormSubmit();
    },
    importFile: () => {
      const file = new File(['[{"fullName":"Imported"}]'], "x.json", { type: "application/json" });
      app.importFile({ target: { files: [file], value: "" } });
    },
    createNewProject: () => app.createNewProject("New"),
    duplicateProject: () => app.duplicateProject(app.currentProjectId),
    deleteProject: () => app.deleteProject(app.currentProjectId),
    saveProjectTitle: () => app.saveProjectTitle("Hacked"),
    saveMicInventory: () => {
      app.micInventory.push({ name: "Sneaky", type: "lav" });
      app.saveMicInventory();
      app.micInventory.pop();
    },
    handleAddNewMic: () => {
      app.newMicName.value = "Sneaky Mic";
      app.handleAddNewMic();
    },
    selectPhoto: () => {
      app.activeTargetSpeakerIdForPhoto = "spk-1";
      app.selectPhoto("https://images.example.test/other.jpg");
    },
    handleFileUpload: () => {
      app.activeTargetSpeakerIdForPhoto = "spk-1";
      app.handleFileUpload(new File([new Uint8Array([137, 80, 78, 71])], "p.png", { type: "image/png" }));
    },
    moveSpeaker: () => app.moveSpeaker("spk-1", 1),
    reorderSpeakers: () => app.reorderSpeakers("spk-1", "spk-3"),
    resetToSampleData: () => app.resetToSampleData(),
  };

  for (const [name, fn] of Object.entries(calls)) {
    test(`${name} changes nothing`, async ({ page }) => {
      const dialogs = [];
      page.on("dialog", async (d) => {
        dialogs.push(d.message());
        await d.accept();
      });
      await gotoApp(page, "/?view=readonly");
      await expect(speakerCards(page)).toHaveCount(8);
      const snapshot = () =>
        page.evaluate(() => ({
          storage: JSON.stringify(Object.entries(window.localStorage).sort()),
          state: JSON.stringify([app.projectsRegistry, app.speakers, app.micInventory, app.projectTitle]),
        }));
      const before = await snapshot();

      await page.evaluate(fn);
      // Let async work (FileReader) settle
      await page.waitForTimeout(300);

      expect(await snapshot()).toEqual(before);
      expect(dialogs).toEqual([]);
      await expect(speakerCards(page)).toHaveCount(8);
    });
  }
});
