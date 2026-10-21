const {
  test,
  expect,
  gotoApp,
  speakerCards,
  filterChip,
  readRegistry,
  readStorage,
  CURRENT_PROJECT_KEY,
} = require("./fixtures");

test.describe("first load", () => {
  test("renders the 8 sample speakers with the default title", async ({ page }) => {
    await gotoApp(page);

    await expect(speakerCards(page)).toHaveCount(8);
    await expect(page).toHaveTitle("Speaker Photo Directory");
    await expect(page.locator("#project-title-display")).toHaveText("Speaker Photo Directory");
    await expect(page.locator("#speaker-count")).toHaveText("8 Speakers");

    // Sample speakers from js/data.js, in order
    await expect(speakerCards(page).first()).toContainText("Dr. Elena Rostova");
    await expect(speakerCards(page).last()).toContainText("Lucas Lindqvist");
  });

  test("filter chips show the per-mic-type counts", async ({ page }) => {
    await gotoApp(page);

    const expected = { all: 8, lav: 3, handheld: 2, headset: 2, podium: 1, none: 0 };
    for (const [filter, count] of Object.entries(expected)) {
      await expect(page.locator(`#count-${filter}`)).toHaveText(String(count));
      await expect(filterChip(page, filter)).toContainText(String(count));
    }
  });

  test("creates a default project in the registry on first run", async ({ page }) => {
    await gotoApp(page);

    const registry = await readRegistry(page);
    expect(registry).toHaveLength(1);
    const [project] = registry;
    expect(Object.keys(project).sort()).toEqual(["id", "lastModified", "micInventory", "speakers", "title"]);
    expect(project.id).toMatch(/^proj-\d+$/);
    expect(project.title).toBe("Speaker Photo Directory");
    expect(project.speakers).toHaveLength(8);
    expect(project.micInventory).toHaveLength(17);
    expect(await readStorage(page, CURRENT_PROJECT_KEY)).toBe(project.id);
  });

  test("logs no console errors or page errors on load", async ({ page, consoleErrors }) => {
    await gotoApp(page);
    await expect(speakerCards(page)).toHaveCount(8);
    // Let late async work (image onerror handlers, Drive controller init) settle before asserting.
    await page.waitForLoadState("load");
    expect(consoleErrors).toEqual([]);
  });
});
