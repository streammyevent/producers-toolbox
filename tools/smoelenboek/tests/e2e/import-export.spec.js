const fs = require("fs");
const {
  test,
  expect,
  gotoApp,
  speakerCards,
  readCurrentProject,
  readRegistry,
  acceptNextDialog,
  makeSpeaker,
} = require("./fixtures");

const CSV_HEADER = "Full Name,Title,Mic Assignment,Mic Type,Photo URL,Notes";
const DATE_RE = "\\d{4}-\\d{2}-\\d{2}";

async function openImportExport(page) {
  await page.locator("#btn-import-export").click();
  await expect(page.locator("#import-export-modal")).toBeVisible();
}

async function download(page, buttonSelector) {
  const [dl] = await Promise.all([page.waitForEvent("download"), page.locator(buttonSelector).click()]);
  const filePath = await dl.path();
  return { name: dl.suggestedFilename(), content: fs.readFileSync(filePath, "utf8") };
}

async function importFile(page, name, mimeType, content) {
  await page.locator("#import-file-input").setInputFiles({ name, mimeType, buffer: Buffer.from(content, "utf8") });
}

test.describe("import / export (Advanced mode)", () => {
  test.beforeEach(async ({ page, seedStorage }) => {
    // Import/Export is an Advanced-mode control
    await seedStorage({ spd_ui_mode: "advanced" });
    await gotoApp(page);
    await expect(speakerCards(page)).toHaveCount(8);
  });

  test("JSON export then import round-trips the project", async ({ page }) => {
    const before = await readCurrentProject(page);
    await openImportExport(page);
    const exported = await download(page, "#btn-export-json");

    expect(exported.name).toMatch(new RegExp(`^speaker_photo_directory_${DATE_RE}\\.json$`));
    const data = JSON.parse(exported.content);
    expect(Object.keys(data).sort()).toEqual(["micInventory", "projectTitle", "speakers"]);
    expect(data.projectTitle).toBe("Speaker Photo Directory");
    expect(data.speakers).toEqual(before.speakers);
    expect(data.micInventory).toEqual(before.micInventory);

    // Wipe the directory, then restore from the exported file
    await page.locator("#import-export-modal").getByRole("button", { name: "Close" }).click();
    await page.locator("#btn-remove-all-speakers").click();
    await page.locator("#btn-confirm-remove-all").click();
    await expect(speakerCards(page)).toHaveCount(0);

    // Also change the title so we can see the import restore it
    await page.locator("#project-title-display").click();
    await page.locator("#project-title-input").fill("Temporary Title");
    await page.locator("#project-title-input").press("Enter");

    await openImportExport(page);
    await importFile(page, exported.name, "application/json", exported.content);

    await expect(page.locator("#import-export-modal")).toBeHidden();
    await expect(speakerCards(page)).toHaveCount(8);
    await expect(page.locator("#project-title-display")).toHaveText("Speaker Photo Directory");
    await expect(page.locator("#toast-container")).toContainText("Imported 8 speakers!");

    const after = await readCurrentProject(page);
    expect(after.id).toBe(before.id);
    expect(after.speakers).toEqual(before.speakers);
    expect(after.micInventory).toEqual(before.micInventory);
    expect(after.title).toBe("Speaker Photo Directory");
    // Import replaces the active project in place; it does not create a new one
    expect(await readRegistry(page)).toHaveLength(1);
  });

  test("JSON import accepts a bare array of speakers", async ({ page }) => {
    await openImportExport(page);
    const speakers = [
      makeSpeaker({ id: "spk-x", fullName: "Array Person" }),
      makeSpeaker({ id: "spk-y", fullName: "Second Array Person", micType: "podium", mic: "Podium Mic" }),
    ];
    await importFile(page, "speakers.json", "application/json", JSON.stringify(speakers));

    await expect(speakerCards(page)).toHaveCount(2);
    await expect(page.locator("#count-podium")).toHaveText("1");
    await expect(page.locator("#project-title-display")).toHaveText("Speaker Photo Directory");
    expect((await readCurrentProject(page)).speakers).toEqual(speakers);
  });

  test("invalid JSON shows an alert and changes nothing", async ({ page }) => {
    await openImportExport(page);
    const dialog = acceptNextDialog(page);
    await importFile(page, "broken.json", "application/json", "{not json");
    expect(await dialog).toBe("Invalid JSON file format.");
    await expect(speakerCards(page)).toHaveCount(8);
    expect((await readCurrentProject(page)).speakers).toHaveLength(8);
  });

  test("CSV export has the documented header and one row per speaker", async ({ page }) => {
    await openImportExport(page);
    const exported = await download(page, "#btn-export-csv");
    const avatar = await page.evaluate(() => defaultAvatarUrl("Dr. Elena Rostova"));

    expect(exported.name).toMatch(new RegExp(`^speaker_photo_directory_${DATE_RE}\\.csv$`));
    const lines = exported.content.split("\n");
    expect(lines[0]).toBe(CSV_HEADER);
    expect(lines).toHaveLength(9);
    // Every value is quoted
    expect(lines[1]).toBe(
      [
        '"Dr. Elena Rostova"',
        '"VP of Artificial Intelligence, NeuroCore Labs"',
        '"Lav 1 (Channel A)"',
        '"lav"',
        `"${avatar}"`,
        '"Soft speaker - boost gain +3dB. Wearing blazer (clip right lapel)."',
      ].join(","),
    );
  });

  test("CSV import replaces the speakers and fills defaults", async ({ page }) => {
    const csv = [
      CSV_HEADER,
      '"Ada Lovelace","Analyst","Handheld 4","handheld","https://images.example.test/ada.jpg","Bring notes"',
      "Charles Babbage,Engineer,,,,",
      "", // blank lines are skipped
    ].join("\n");

    await openImportExport(page);
    await importFile(page, "speakers.csv", "text/csv", csv);

    await expect(page.locator("#import-export-modal")).toBeHidden();
    await expect(speakerCards(page)).toHaveCount(2);
    await expect(page.locator("#toast-container")).toContainText("Imported 2 speakers from CSV!");
    await expect(page.locator("#count-handheld")).toHaveText("1");
    await expect(page.locator("#count-lav")).toHaveText("1");

    const { speakers } = await readCurrentProject(page);
    expect(speakers[0]).toMatchObject({
      fullName: "Ada Lovelace",
      title: "Analyst",
      mic: "Handheld 4",
      micType: "handheld",
      photo: "https://images.example.test/ada.jpg",
      notes: "Bring notes",
    });
    expect(speakers[0].id).toMatch(/^spk-\d+-1$/);
    // Missing columns get defaults
    expect(speakers[1]).toMatchObject({
      fullName: "Charles Babbage",
      title: "Engineer",
      mic: "Unassigned",
      micType: "lav",
      notes: "",
    });
    expect(speakers[1].photo).toMatch(/^data:image\/svg\+xml,.*%3ECB%3C%2Ftext%3E/);
  });

  test("CSV with only a header shows an alert and changes nothing", async ({ page }) => {
    await openImportExport(page);
    const dialog = acceptNextDialog(page);
    await importFile(page, "empty.csv", "text/csv", `${CSV_HEADER}\n`);
    expect(await dialog).toBe("CSV file is empty or missing data rows.");
    await expect(speakerCards(page)).toHaveCount(8);
  });

  test("CSV export output can be imported back (names survive)", async ({ page }) => {
    const before = await readCurrentProject(page);
    await openImportExport(page);
    const exported = await download(page, "#btn-export-csv");
    await importFile(page, exported.name, "text/csv", exported.content);

    await expect(page.locator("#toast-container")).toContainText("Imported 8 speakers from CSV!");
    const after = await readCurrentProject(page);
    expect(after.speakers.map((s) => s.fullName)).toEqual(before.speakers.map((s) => s.fullName));
  });

  // Was a known bug (test.fixme): importFile() split CSV rows on every comma, ignoring quotes, so a quoted title such
  // as "VP of Artificial Intelligence, NeuroCore Labs" shifted every following column. Fixed by the quote-aware parser.
  test("CSV export/import round-trips quoted fields that contain commas", async ({ page }) => {
    const before = await readCurrentProject(page);
    await openImportExport(page);
    const exported = await download(page, "#btn-export-csv");
    await importFile(page, exported.name, "text/csv", exported.content);
    await expect(page.locator("#toast-container")).toContainText("Imported 8 speakers from CSV!");
    const strip = (s) => ({ fullName: s.fullName, title: s.title, mic: s.mic, micType: s.micType, notes: s.notes });
    expect((await readCurrentProject(page)).speakers.map(strip)).toEqual(before.speakers.map(strip));
  });
});
