// Security hardening from the pre-release review: CSV formula injection guard, and no Google sign-in at all (the
// backup folder replaced the Google Drive integration).
const fs = require("fs");
const { test, expect, gotoApp, speakerCards, readCurrentProject } = require("./fixtures");

const FORMULAS = {
  fullName: '=HYPERLINK("https://example.test","click me")',
  title: "+1 555 0100",
  mic: "-2 dB pad",
  notes: "@SUM(A1:A9)",
};

async function download(page, buttonSelector) {
  const [dl] = await Promise.all([page.waitForEvent("download"), page.locator(buttonSelector).click()]);
  return { name: dl.suggestedFilename(), content: fs.readFileSync(await dl.path(), "utf8") };
}

test.describe("CSV formula injection guard", () => {
  test("csvQuote prefixes formula-like values with an apostrophe and csvUnescapeFormula reverses it", async ({
    page,
  }) => {
    await gotoApp(page);
    const result = await page.evaluate(() => ({
      quoted: ["=1+1", "+1", "-1", "@x", "\tx", "plain", "O'Brien", "'quoted"].map(csvQuote),
      unescaped: ["'=1+1", "'+1", "'-1", "'@x", "'plain", "O'Brien", "=raw"].map(csvUnescapeFormula),
    }));
    expect(result.quoted).toEqual([
      `"'=1+1"`,
      `"'+1"`,
      `"'-1"`,
      `"'@x"`,
      `"'\tx"`,
      `"plain"`,
      `"O'Brien"`,
      `"'quoted"`,
    ]);
    expect(result.unescaped).toEqual(["=1+1", "+1", "-1", "@x", "'plain", "O'Brien", "=raw"]);
  });

  test("exported CSV neutralizes formulas and importing it restores the exact values", async ({
    page,
    seedStorage,
  }) => {
    await seedStorage({ spd_ui_mode: "advanced" });
    await gotoApp(page);
    await page.evaluate((f) => {
      app.speakers = normalizeSpeakers([{ id: "spk-formula", ...f, micType: "lav" }]);
      app.saveCurrentProjectState();
      app.render();
    }, FORMULAS);
    await expect(speakerCards(page)).toHaveCount(1);

    await page.locator("#btn-import-export").click();
    const exported = await download(page, "#btn-export-csv");
    const dataRow = exported.content.split(/\r?\n/)[1];
    for (const value of Object.values(FORMULAS)) {
      // Every formula-like cell starts with an apostrophe inside its quotes
      expect(dataRow).toContain(`"'${value.replace(/"/g, '""')}"`);
    }

    await page
      .locator("#import-file-input")
      .setInputFiles({ name: exported.name, mimeType: "text/csv", buffer: Buffer.from(exported.content, "utf8") });
    await expect(page.locator("#toast-container")).toContainText("Imported 1 speakers from CSV!");
    const [spk] = (await readCurrentProject(page)).speakers;
    expect({ fullName: spk.fullName, title: spk.title, mic: spk.mic, notes: spk.notes }).toEqual(FORMULAS);
  });
});

test("no Google sign-in: no Identity Services script, no auth hosts in the CSP, no OAuth requests", async ({
  page,
  seedStorage,
  desktopSyncFolder,
}) => {
  await seedStorage({ spd_ui_mode: "advanced" });
  await desktopSyncFolder();
  const googleAuth = [];
  page.on("request", (req) => {
    if (/accounts\.google\.com|oauth2\.googleapis\.com|googleapis\.com\/(drive|upload|oauth2)/.test(req.url())) {
      googleAuth.push(req.url());
    }
  });
  await gotoApp(page);
  await page.locator("#btn-sync-menu").click();
  await page.locator("#btn-sync-now").click();
  await expect(page.locator("#toast-container")).toContainText("Saved");

  expect(await page.locator('script[src*="accounts.google.com"]').count()).toBe(0);
  const csp = await page.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]').content);
  expect(csp).not.toContain("accounts.google.com");
  expect(csp).not.toContain("*.googleapis.com");
  expect(csp).toContain("frame-src 'none'");
  expect(googleAuth).toEqual([]);
});
