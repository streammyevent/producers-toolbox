const { test, expect, gotoApp, readRegistry } = require("./fixtures");

// Project ids are "proj-<timestamp>". Two projects made within the same millisecond must not share an id.
test.describe("project ids", () => {
  test("projects created in the same millisecond get distinct ids", async ({ page }) => {
    await gotoApp(page);
    await page.evaluate(() => {
      const realNow = Date.now;
      const frozen = realNow();
      Date.now = () => frozen; // every call returns the same millisecond
      try {
        app.createNewProject("First");
        app.createNewProject("Second");
        app.duplicateProject(app.currentProjectId);
      } finally {
        Date.now = realNow;
      }
    });

    const ids = (await readRegistry(page)).map((p) => p.id);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    for (const id of ids) expect(id).toMatch(/^proj-\d+$/);
  });
});
