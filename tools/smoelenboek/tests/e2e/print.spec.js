const { test, expect, gotoApp, makeProject, makeSpeaker } = require("./fixtures");

// The preview grid holds one element per speaker card.
const previewCards = (page) => page.locator("#print-preview-grid > *");

test.describe("print sheet preview", () => {
  test.beforeEach(async ({ page }) => {
    // Never open the real print dialog, even if a test clicks the print button by mistake.
    await page.addInitScript(() => {
      window.print = () => {
        window.__printCalls = (window.__printCalls || 0) + 1;
      };
    });
  });

  test("renders one preview card per speaker", async ({ page }) => {
    await gotoApp(page);
    await page.locator("#btn-open-print-modal").click();

    await expect(page.locator("#print-modal")).toBeVisible();
    await expect(previewCards(page)).toHaveCount(8);
    await expect(previewCards(page).first()).toContainText("Dr. Elena Rostova");
    await expect(previewCards(page).first()).toContainText("Lav 1 (Channel A)");
    await expect(previewCards(page).first()).toContainText("Soft speaker - boost gain +3dB.");
    await expect(page.locator("#preview-sheet-title")).toHaveText("Speaker Photo Directory");
    await expect(page.locator("#preview-page-estimate")).toHaveText("A4 Portrait • 4 Columns per row • Est. 1 Page");
  });

  test("toggling mics and notes off hides them in the preview", async ({ page }) => {
    await gotoApp(page);
    await page.locator("#btn-open-print-modal").click();
    await expect(previewCards(page)).toHaveCount(8);

    await page.locator("#print-toggle-mics").uncheck();
    await expect(page.locator("#print-preview-grid")).not.toContainText("Lav 1 (Channel A)");
    await page.locator("#print-toggle-notes").uncheck();
    await expect(page.locator("#print-preview-grid")).not.toContainText("Soft speaker");
    await expect(previewCards(page)).toHaveCount(8);
    await expect(previewCards(page).first()).toContainText("Dr. Elena Rostova");
  });

  test("landscape orientation switches to 5 columns and offers 6", async ({ page }) => {
    await gotoApp(page);
    await page.locator("#btn-open-print-modal").click();
    await page.locator('[data-orientation="landscape"]').click();
    await expect(page.locator("#preview-page-estimate")).toHaveText("A4 Landscape • 5 Columns per row • Est. 1 Page");
    await page.locator('[data-cols="6"]').click();
    await expect(page.locator("#preview-page-estimate")).toContainText("6 Columns per row");
  });

  test("the page estimate grows with the number of speakers", async ({ page, seedStorage }) => {
    const speakers = Array.from({ length: 17 }, (_, i) =>
      makeSpeaker({ id: `spk-${i}`, fullName: `Speaker ${i + 1}` }),
    );
    await seedStorage({
      speaker_projects_registry_v1: [makeProject({ id: "proj-1", title: "Big Event", speakers })],
      speaker_current_project_id_v1: "proj-1",
    });
    await gotoApp(page);
    await page.locator("#btn-open-print-modal").click();
    await expect(previewCards(page)).toHaveCount(17);
    await expect(page.locator("#preview-sheet-title")).toHaveText("Big Event");
    await expect(page.locator("#preview-page-estimate")).toHaveText("A4 Portrait • 4 Columns per row • Est. 2 Pages");
  });

  test("Cancel closes the modal without printing", async ({ page }) => {
    await gotoApp(page);
    await page.locator("#btn-open-print-modal").click();
    await page.locator("#print-modal").getByRole("button", { name: "Cancel" }).click();
    await expect(page.locator("#print-modal")).toBeHidden();
    expect(await page.evaluate(() => window.__printCalls || 0)).toBe(0);
  });
});
