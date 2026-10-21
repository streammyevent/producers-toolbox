const { test, expect, gotoApp, speakerCards, filterChip } = require("./fixtures");

async function cardTexts(page) {
  // Inner text of every rendered card (compared by containment, so the card layout does not matter).
  return speakerCards(page).allInnerTexts();
}

test.describe("search and mic-type filters", () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await expect(speakerCards(page)).toHaveCount(8);
  });

  test("search filters by name (case-insensitive)", async ({ page }) => {
    await page.locator("#search-input").fill("ELENA");
    await expect(speakerCards(page)).toHaveCount(1);
    await expect(speakerCards(page).first()).toContainText("Dr. Elena Rostova");
    await expect(page.locator("#speaker-count")).toHaveText("1 Speaker");
    // Filter chip counts always reflect the whole project, not the search result
    await expect(page.locator("#count-all")).toHaveText("8");
  });

  test("search filters by title/company", async ({ page }) => {
    await page.locator("#search-input").fill("studio nord");
    await expect(speakerCards(page)).toHaveCount(1);
    await expect(speakerCards(page).first()).toContainText("Lucas Lindqvist");
  });

  test("search filters by mic name", async ({ page }) => {
    await page.locator("#search-input").fill("Lav 2");
    await expect(speakerCards(page)).toHaveCount(1);
    await expect(speakerCards(page).first()).toContainText("Kenji Takahashi");

    // "handheld" matches the two handheld mics (and Marcus's notes)
    await page.locator("#search-input").fill("handheld");
    await expect(speakerCards(page)).toHaveCount(2);
    const texts = await cardTexts(page);
    expect(texts.some((t) => t.includes("Marcus Vance"))).toBe(true);
    expect(texts.some((t) => t.includes("David Sterling"))).toBe(true);
  });

  test("search also matches notes", async ({ page }) => {
    await page.locator("#search-input").fill("robot demo");
    await expect(speakerCards(page)).toHaveCount(1);
    await expect(speakerCards(page).first()).toContainText("Amara Okafor");
  });

  test("clear-search button resets the search", async ({ page }) => {
    const clear = page.locator("#clear-search-btn");
    await page.locator("#search-input").fill("elena");
    await expect(clear).toBeVisible();
    await clear.click();
    await expect(page.locator("#search-input")).toHaveValue("");
    await expect(clear).toBeHidden();
    await expect(speakerCards(page)).toHaveCount(8);
  });

  test("no match shows the empty state; 'Show All Speakers' clears search and filter", async ({ page }) => {
    await filterChip(page, "lav").click();
    await page.locator("#search-input").fill("zzz-no-such-speaker");
    await expect(speakerCards(page)).toHaveCount(0);
    await expect(page.getByText("No speakers found")).toBeVisible();
    await expect(page.locator("#speaker-count")).toHaveText("0 Speakers");

    await page.getByRole("button", { name: "Show All Speakers" }).click();
    await expect(speakerCards(page)).toHaveCount(8);
    await expect(page.locator("#search-input")).toHaveValue("");
    await expect(page.locator("#speaker-count")).toHaveText("8 Speakers");
  });

  const chipCases = [
    { filter: "lav", count: 3, includes: "Zainab Al-Mansoor" },
    { filter: "handheld", count: 2, includes: "David Sterling" },
    { filter: "headset", count: 2, includes: "Amara Okafor" },
    { filter: "podium", count: 1, includes: "Sophia Rodriguez" },
  ];
  for (const { filter, count, includes } of chipCases) {
    test(`'${filter}' chip shows only ${filter} speakers`, async ({ page }) => {
      await filterChip(page, filter).click();
      await expect(speakerCards(page)).toHaveCount(count);
      await expect(speakerCards(page).filter({ hasText: includes })).toHaveCount(1);
      await expect(page.locator("#speaker-count")).toHaveText(`${count} Speaker${count === 1 ? "" : "s"}`);
    });
  }

  test("'Unassigned' chip shows the empty state for the sample data", async ({ page }) => {
    await filterChip(page, "none").click();
    await expect(speakerCards(page)).toHaveCount(0);
    await expect(page.getByText("No speakers found")).toBeVisible();
  });

  test("'All' chip restores the full list; chip and search combine", async ({ page }) => {
    await filterChip(page, "lav").click();
    await page.locator("#search-input").fill("kenji");
    await expect(speakerCards(page)).toHaveCount(1);

    await page.locator("#search-input").fill("marcus"); // Marcus has a handheld, so lav + marcus = nothing
    await expect(speakerCards(page)).toHaveCount(0);

    await page.locator("#search-input").fill("");
    await filterChip(page, "all").click();
    await expect(speakerCards(page)).toHaveCount(8);
  });
});
