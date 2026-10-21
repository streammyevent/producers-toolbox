const { test, expect, gotoApp, waitForApp, readStorage, UI_MODE_KEY } = require("./fixtures");

// Buttons that only exist in Advanced mode
const ADVANCED_ONLY = [
  "#btn-save-now",
  "#btn-share-link",
  "#btn-toggle-reorder",
  "#btn-manage-mics",
  "#btn-import-export",
  "#btn-reset-data",
];
// Buttons available in Basic mode
const BASIC = ["#btn-projects-menu", "#btn-add-speaker", "#btn-open-print-modal", "#btn-remove-all-speakers"];

test.describe("Basic / Advanced UI mode", () => {
  test("defaults to Basic mode with advanced controls hidden", async ({ page }) => {
    await gotoApp(page);
    await expect(page.locator("#toggle-mode-switch")).not.toBeChecked();
    for (const sel of ADVANCED_ONLY) await expect(page.locator(sel)).toBeHidden();
    for (const sel of BASIC) await expect(page.locator(sel)).toBeVisible();
    expect(await readStorage(page, UI_MODE_KEY)).toBeNull();
  });

  test("switching to Advanced shows the controls and persists across reloads", async ({ page }) => {
    await gotoApp(page);
    await page.locator("#mode-label-adv").click();

    await expect(page.locator("#toggle-mode-switch")).toBeChecked();
    for (const sel of ADVANCED_ONLY) await expect(page.locator(sel)).toBeVisible();
    await expect(page.locator("#toast-container")).toContainText("Switched to Advanced Mode");
    expect(await readStorage(page, UI_MODE_KEY)).toBe("advanced");

    await page.reload();
    await waitForApp(page);
    await expect(page.locator("#toggle-mode-switch")).toBeChecked();
    await expect(page.locator("#btn-manage-mics")).toBeVisible();

    await page.locator("#mode-label-basic").click();
    await expect(page.locator("#toggle-mode-switch")).not.toBeChecked();
    await expect(page.locator("#btn-manage-mics")).toBeHidden();
    await expect(page.locator("#toast-container")).toContainText("Switched to Basic Mode");
    expect(await readStorage(page, UI_MODE_KEY)).toBe("basic");

    await page.reload();
    await waitForApp(page);
    await expect(page.locator("#btn-manage-mics")).toBeHidden();
  });
});
