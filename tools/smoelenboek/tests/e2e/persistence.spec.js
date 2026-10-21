const {
  test,
  expect,
  gotoApp,
  waitForApp,
  speakerCards,
  speakerCard,
  readRegistry,
  makeProject,
} = require("./fixtures");

test.describe("persistence", () => {
  test("speakers, mic assignments and title survive a reload", async ({ page }) => {
    await gotoApp(page);

    // Add a speaker
    await page.locator("#btn-add-speaker").click();
    await page.locator("#form-fullname").fill("Persistent Pat");
    await page.locator("#form-title").fill("Keeper of State");
    await page.locator("#speaker-modal").getByRole("button", { name: "Save Speaker" }).click();
    await expect(speakerCards(page)).toHaveCount(9);

    // Re-assign a mic
    await speakerCard(page, "Marcus Vance").locator('[data-action="quick-mic"]').click();
    await page.locator('#quick-mic-menu [data-mic="Catchbox (Audience)"]').click();
    await expect(speakerCard(page, "Marcus Vance")).toContainText("Catchbox (Audience)");

    // Rename
    await page.locator("#project-title-display").click();
    await page.locator("#project-title-input").fill("Reload Test Event");
    await page.locator("#project-title-input").press("Enter");
    await expect(page.locator("#project-title-display")).toHaveText("Reload Test Event");

    const registryBefore = await readRegistry(page);

    await page.reload();
    await waitForApp(page);

    await expect(speakerCards(page)).toHaveCount(9);
    await expect(speakerCards(page).first()).toContainText("Persistent Pat");
    await expect(speakerCard(page, "Marcus Vance")).toContainText("Catchbox (Audience)");
    await expect(page.locator("#project-title-display")).toHaveText("Reload Test Event");
    await expect(page).toHaveTitle("Reload Test Event");
    expect(await readRegistry(page)).toEqual(registryBefore);
  });

  test("seeded localStorage is used instead of the sample data", async ({ page, seedStorage }) => {
    await seedStorage({
      speaker_projects_registry_v1: [makeProject({ id: "proj-seed", title: "Seeded", speakers: [] })],
      speaker_current_project_id_v1: "proj-seed",
    });
    await gotoApp(page);
    await expect(page.locator("#project-title-display")).toHaveText("Seeded");
    await expect(speakerCards(page)).toHaveCount(0);

    // The seed is applied only once per tab, so a reload keeps the app's own state
    await page.locator("#project-title-display").click();
    await page.locator("#project-title-input").fill("Changed After Seed");
    await page.locator("#project-title-input").press("Enter");
    await page.reload();
    await waitForApp(page);
    await expect(page.locator("#project-title-display")).toHaveText("Changed After Seed");
  });
});
