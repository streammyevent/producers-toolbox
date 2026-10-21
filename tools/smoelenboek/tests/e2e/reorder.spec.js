const { test, expect, gotoApp, speakerCards, filterChip, readCurrentProject } = require("./fixtures");

async function speakerIds(page) {
  return (await readCurrentProject(page)).speakers.map((s) => s.id);
}

test.describe("reorder mode (Advanced mode)", () => {
  test.beforeEach(async ({ page, seedStorage }) => {
    // The Reorder toggle is an Advanced-mode control
    await seedStorage({ spd_ui_mode: "advanced" });
    await gotoApp(page);
    await expect(speakerCards(page)).toHaveCount(8);
  });

  test("move arrows are only shown in reorder mode", async ({ page }) => {
    await expect(speakerCards(page).first().locator('[data-action="move-down"]')).toBeHidden();
    await page.locator("#btn-toggle-reorder").click();
    await expect(page.locator("#reorder-btn-text")).toHaveText("✓ Done Reordering");
    await expect(page.locator("#btn-done-reorder")).toBeVisible();
    await expect(speakerCards(page).first().locator('[data-action="move-down"]')).toBeVisible();
    // First card cannot move up, last card cannot move down
    await expect(speakerCards(page).first().locator('[data-action="move-up"]')).toBeDisabled();
    await expect(speakerCards(page).last().locator('[data-action="move-down"]')).toBeDisabled();
  });

  test("moves a speaker down and up and persists the order", async ({ page }) => {
    await page.locator("#btn-toggle-reorder").click();

    await speakerCards(page).first().locator('[data-action="move-down"]').click();
    await expect(speakerCards(page).nth(0)).toContainText("Marcus Vance");
    await expect(speakerCards(page).nth(1)).toContainText("Dr. Elena Rostova");
    await expect(page.locator("#toast-container")).toContainText("Moved #1 Dr. ➔ #2");
    expect((await speakerIds(page)).slice(0, 3)).toEqual(["spk-2", "spk-1", "spk-3"]);

    await speakerCards(page).last().locator('[data-action="move-up"]').click();
    await expect(speakerCards(page).nth(6)).toContainText("Lucas Lindqvist");
    expect((await speakerIds(page)).slice(-2)).toEqual(["spk-8", "spk-7"]);

    await page.locator("#btn-done-reorder").click();
    await expect(page.locator("#reorder-btn-text")).toHaveText("⇄ Reorder");
    await expect(page.locator("#toast-container")).toContainText("Speaker sequence saved!");
    await expect(speakerCards(page).first().locator('[data-action="move-down"]')).toBeHidden();
  });

  test("entering reorder mode clears an active search and filter", async ({ page }) => {
    await filterChip(page, "lav").click();
    await page.locator("#search-input").fill("elena");
    await expect(speakerCards(page)).toHaveCount(1);

    await page.locator("#btn-toggle-reorder").click();
    await expect(speakerCards(page)).toHaveCount(8);
    await expect(page.locator("#search-input")).toHaveValue("");
  });
});
