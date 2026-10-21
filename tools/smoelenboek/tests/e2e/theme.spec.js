const { test, expect, gotoApp, waitForApp, readStorage, speakerCards } = require("./fixtures");

const THEME_KEY = "spd_theme";
const html = (page) => page.locator("html");
const toggle = (page) => page.locator("#btn-theme-toggle");

test.describe("light / dark theme", () => {
  test("first run follows the light OS setting", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await gotoApp(page);
    await expect(html(page)).toHaveAttribute("data-theme", "light");
    expect(await readStorage(page, THEME_KEY)).toBeNull();
  });

  test("first run follows the dark OS setting", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await gotoApp(page);
    await expect(html(page)).toHaveAttribute("data-theme", "dark");
    await expect(toggle(page)).toHaveAttribute("aria-label", "Switch to light mode");
    expect(await readStorage(page, THEME_KEY)).toBeNull();
  });

  test("the toggle flips the theme and the choice persists across reloads", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await gotoApp(page);
    await expect(html(page)).toHaveAttribute("data-theme", "light");
    await expect(toggle(page)).toHaveAttribute("aria-label", "Switch to dark mode");

    await toggle(page).click();
    await expect(html(page)).toHaveAttribute("data-theme", "dark");
    expect(await readStorage(page, THEME_KEY)).toBe("dark");

    // The stored choice wins over the OS setting
    await page.reload();
    await waitForApp(page);
    await expect(html(page)).toHaveAttribute("data-theme", "dark");

    await toggle(page).click();
    await expect(html(page)).toHaveAttribute("data-theme", "light");
    expect(await readStorage(page, THEME_KEY)).toBe("light");

    await page.emulateMedia({ colorScheme: "dark" });
    await page.reload();
    await waitForApp(page);
    await expect(html(page)).toHaveAttribute("data-theme", "light");
  });

  test("the toggle is available to view-only viewers", async ({ page }) => {
    await gotoApp(page, "/?view=readonly");
    await expect(toggle(page)).toBeVisible();
  });

  test("print renders cards on a white background in the dark theme", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await gotoApp(page);
    await expect(html(page)).toHaveAttribute("data-theme", "dark");

    const card = speakerCards(page).first();
    const screenBg = await card.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(screenBg).not.toBe("rgb(255, 255, 255)");

    await page.emulateMedia({ media: "print", colorScheme: "dark" });
    // Poll: on screen the card has a short color transition that finishes after the media switch
    await expect.poll(() => card.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(255, 255, 255)");
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(255, 255, 255)");
    expect(await card.locator(".speaker-name").evaluate((el) => getComputedStyle(el).color)).toBe("rgb(0, 0, 0)");
    await expect(page.locator(".app-header")).toBeHidden();
  });
});
