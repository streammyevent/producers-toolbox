const path = require("path");
const { pathToFileURL } = require("url");
const { test, expect, gotoApp, waitForApp, UI_MODE_KEY } = require("./fixtures");

const INDEX_FILE_URL = pathToFileURL(path.join(__dirname, "..", "..", "web", "index.html")).href;

// The Share button only exists in Advanced mode.
test.beforeEach(async ({ seedStorage }) => {
  await seedStorage({ [UI_MODE_KEY]: "advanced" });
});

test.describe("Share view-only link", () => {
  test("shows and copies the view-only link of the current page", async ({ page, context, baseURL }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseURL });
    // Query string and hash of the current page are not part of the shared link
    await gotoApp(page, "/index.html?foo=1#section");

    await page.locator("#btn-share-link").click();
    await expect(page.locator("#share-modal")).toBeVisible();
    const expected = `${baseURL}/index.html?view=readonly`;
    await expect(page.locator("#share-link-url")).toHaveValue(expected);
    await expect(page.locator("#share-link-note")).toBeHidden();
    await expect(page.locator("#btn-copy-share-link")).toBeEnabled();

    await page.locator("#btn-copy-share-link").click();
    await expect(page.locator("#toast-container")).toContainText("View-only link copied");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expected);
  });

  test("the shared link opens the directory in view-only mode", async ({ page, baseURL }) => {
    await gotoApp(page);
    await page.locator("#btn-share-link").click();
    const link = await page.locator("#share-link-url").inputValue();
    expect(link).toBe(`${baseURL}/?view=readonly`);

    await page.goto(link);
    await waitForApp(page);
    expect(await page.evaluate(() => app.isViewOnly)).toBe(true);
    await expect(page.locator("body")).toHaveClass(/view-only/);
  });

  test("from file:// it explains that sharing needs the LAN share script", async ({ page, consoleErrors }) => {
    // The fixture aborts every non-local request; let the app's own files load (later routes take precedence)
    await page.route(
      (url) => url.protocol === "file:",
      (route) => route.continue(),
    );
    await page.goto(INDEX_FILE_URL);
    await waitForApp(page);

    await page.locator("#btn-share-link").click();
    await expect(page.locator("#share-modal")).toBeVisible();
    await expect(page.locator("#share-link-url")).toHaveValue("");
    await expect(page.locator("#share-link-note")).toBeVisible();
    await expect(page.locator("#share-link-note")).toContainText("Share-On-Office-Network.bat");
    await expect(page.locator("#btn-copy-share-link")).toBeDisabled();
    // No hardcoded LAN address anywhere
    expect(await page.locator("#share-modal").innerHTML()).not.toContain("192.168.");
    expect(consoleErrors).toEqual([]);
  });
});
