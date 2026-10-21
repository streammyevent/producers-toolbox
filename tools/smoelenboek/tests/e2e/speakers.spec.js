const {
  test,
  expect,
  gotoApp,
  speakerCards,
  speakerCard,
  readCurrentProject,
  acceptNextDialog,
  LEGACY_SPEAKERS_KEY,
  readJsonStorage,
} = require("./fixtures");

/** Opens the Add Speaker modal and fills it in. Leaves the modal open. */
async function fillNewSpeaker(page, { name, title, micValue, notes }) {
  await page.locator("#btn-add-speaker").click();
  await expect(page.locator("#speaker-modal")).toBeVisible();
  await expect(page.locator("#modal-title")).toHaveText("Add Speaker Profile");
  await page.locator("#form-fullname").fill(name);
  await page.locator("#form-title").fill(title);
  if (micValue) await page.locator("#form-mic-preset").selectOption(micValue);
  if (notes !== undefined) await page.locator("#form-notes").fill(notes);
}

async function saveSpeakerForm(page) {
  await page.locator("#speaker-modal").getByRole("button", { name: "Save Speaker" }).click();
  await expect(page.locator("#speaker-modal")).toBeHidden();
}

test.describe("speaker CRUD", () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await expect(speakerCards(page)).toHaveCount(8);
  });

  test("adds a speaker via the Add Speaker modal (prepended, persisted)", async ({ page }) => {
    await fillNewSpeaker(page, {
      name: "Grace Hopper",
      title: "Rear Admiral, US Navy",
      micValue: "Handheld 3|handheld",
      notes: "Bring the nanosecond wire",
    });
    await saveSpeakerForm(page);

    await expect(speakerCards(page)).toHaveCount(9);
    await expect(speakerCards(page).first()).toContainText("Grace Hopper");
    await expect(speakerCards(page).first()).toContainText("Rear Admiral, US Navy");
    await expect(speakerCards(page).first()).toContainText("Handheld 3");
    await expect(page.locator("#count-handheld")).toHaveText("3");
    await expect(page.locator("#toast-container")).toContainText("Added Grace Hopper");

    const project = await readCurrentProject(page);
    expect(project.speakers).toHaveLength(9);
    const added = project.speakers[0];
    expect(added).toMatchObject({
      fullName: "Grace Hopper",
      title: "Rear Admiral, US Navy",
      mic: "Handheld 3",
      micType: "handheld",
      notes: "Bring the nanosecond wire",
    });
    expect(added.id).toMatch(/^spk-\d+$/);
    // Without a chosen photo the speaker gets a generated initials avatar
    expect(added.photo).toMatch(/^data:image\/svg\+xml,.*%3EGH%3C%2Ftext%3E/);
    expect(Object.keys(added).sort()).toEqual(["fullName", "id", "mic", "micType", "notes", "photo", "title"]);

    // Legacy key mirrors the speakers
    const legacy = await readJsonStorage(page, LEGACY_SPEAKERS_KEY);
    expect(legacy).toHaveLength(9);
    expect(legacy[0].fullName).toBe("Grace Hopper");
  });

  test("custom mic entry is stored with micType 'lav'", async ({ page }) => {
    await fillNewSpeaker(page, { name: "Custom Mic Person", title: "Host", micValue: "custom" });
    await expect(page.locator("#form-mic-custom")).toBeVisible();
    await page.locator("#form-mic-custom").fill("Boom Mic 2");
    await saveSpeakerForm(page);

    const project = await readCurrentProject(page);
    expect(project.speakers[0]).toMatchObject({ fullName: "Custom Mic Person", mic: "Boom Mic 2", micType: "lav" });
    await expect(page.locator("#count-lav")).toHaveText("4");
  });

  test("cancel closes the modal without adding", async ({ page }) => {
    await fillNewSpeaker(page, { name: "Never Saved", title: "Ghost" });
    await page.locator("#speaker-modal").getByRole("button", { name: "Cancel" }).click();
    await expect(page.locator("#speaker-modal")).toBeHidden();
    await expect(speakerCards(page)).toHaveCount(8);
    expect((await readCurrentProject(page)).speakers).toHaveLength(8);
  });

  test("edits an existing speaker", async ({ page }) => {
    const card = speakerCard(page, "Marcus Vance");
    await card.locator('[data-action="edit"]:visible').first().click();

    await expect(page.locator("#speaker-modal")).toBeVisible();
    await expect(page.locator("#modal-title")).toHaveText("Edit Speaker Profile");
    await expect(page.locator("#form-fullname")).toHaveValue("Marcus Vance");
    await expect(page.locator("#form-title")).toHaveValue("Chief Product Officer, Apex Cloud");
    await expect(page.locator("#form-mic-preset")).toHaveValue("Handheld 1|handheld");
    await expect(page.locator("#form-notes")).toHaveValue("Prefers handheld. Walks stage actively.");

    await page.locator("#form-title").fill("CEO, Apex Cloud");
    await page.locator("#form-mic-preset").selectOption("Headset 3|headset");
    await saveSpeakerForm(page);

    await expect(speakerCards(page)).toHaveCount(8);
    // Edited speaker keeps its position (#2)
    await expect(speakerCards(page).nth(1)).toContainText("CEO, Apex Cloud");
    await expect(speakerCards(page).nth(1)).toContainText("Headset 3");
    await expect(page.locator("#count-handheld")).toHaveText("1");
    await expect(page.locator("#count-headset")).toHaveText("3");
    await expect(page.locator("#toast-container")).toContainText("Updated Marcus Vance");

    const project = await readCurrentProject(page);
    expect(project.speakers[1]).toMatchObject({
      id: "spk-2",
      fullName: "Marcus Vance",
      title: "CEO, Apex Cloud",
      mic: "Headset 3",
      micType: "headset",
    });
  });

  test("deletes a speaker after confirming", async ({ page }) => {
    const dialog = acceptNextDialog(page);
    await speakerCard(page, "Kenji Takahashi").locator('[data-action="delete"]').click();
    expect(await dialog).toBe('Remove "Kenji Takahashi" from directory?');

    await expect(speakerCards(page)).toHaveCount(7);
    await expect(speakerCard(page, "Kenji Takahashi")).toHaveCount(0);
    await expect(page.locator("#count-lav")).toHaveText("2");
    await expect(page.locator("#toast-container")).toContainText("Speaker deleted");

    const project = await readCurrentProject(page);
    expect(project.speakers.map((s) => s.id)).not.toContain("spk-4");
    expect(project.speakers).toHaveLength(7);
  });

  test("keeps the speaker when the delete confirm is dismissed", async ({ page }) => {
    page.once("dialog", (d) => d.dismiss());
    await speakerCard(page, "Kenji Takahashi").locator('[data-action="delete"]').click();
    await expect(speakerCards(page)).toHaveCount(8);
    expect((await readCurrentProject(page)).speakers).toHaveLength(8);
  });

  test("assigns a mic via the quick mic menu on a card badge", async ({ page }) => {
    const card = speakerCard(page, "Dr. Elena Rostova");
    await card.locator('[data-action="quick-mic"]').click();

    const menu = page.locator("#quick-mic-menu");
    await expect(menu).toBeVisible();
    await expect(menu).toContainText("Switch Mic for Dr.");
    // One entry per mic in the inventory (17 defaults)
    await expect(menu.locator("[data-mic]")).toHaveCount(17);

    await menu.locator('[data-mic="Podium Mic"]').click();
    await expect(menu).toBeHidden();
    await expect(speakerCard(page, "Dr. Elena Rostova")).toContainText("Podium Mic");
    await expect(page.locator("#count-lav")).toHaveText("2");
    await expect(page.locator("#count-podium")).toHaveText("2");
    await expect(page.locator("#toast-container")).toContainText("Assigned Podium Mic to Dr.");

    const project = await readCurrentProject(page);
    expect(project.speakers[0]).toMatchObject({ id: "spk-1", mic: "Podium Mic", micType: "podium" });
  });

  test("quick mic menu closes on an outside click without changes", async ({ page }) => {
    await speakerCard(page, "Marcus Vance").locator('[data-action="quick-mic"]').click();
    await expect(page.locator("#quick-mic-menu")).toBeVisible();
    await page.locator("#speaker-count").click();
    await expect(page.locator("#quick-mic-menu")).toBeHidden();
    expect((await readCurrentProject(page)).speakers[1].mic).toBe("Handheld 1");
  });

  test("Remove All empties the directory after confirming in the modal", async ({ page }) => {
    await page.locator("#btn-remove-all-speakers").click();
    await expect(page.locator("#remove-all-modal")).toBeVisible();
    await expect(page.locator("#remove-all-count-display")).toHaveText("8 speakers");
    await page.locator("#btn-confirm-remove-all").click();

    await expect(page.locator("#remove-all-modal")).toBeHidden();
    await expect(speakerCards(page)).toHaveCount(0);
    await expect(page.getByText("No speakers found")).toBeVisible();
    await expect(page.locator("#count-all")).toHaveText("0");
    await expect(page.locator("#toast-container")).toContainText("Removed all 8 speakers");
    expect((await readCurrentProject(page)).speakers).toEqual([]);

    // With an empty directory the button only shows a toast
    await page.locator("#btn-remove-all-speakers").click();
    await expect(page.locator("#toast-container")).toContainText("Directory is already empty.");
    await expect(page.locator("#remove-all-modal")).toBeHidden();
  });
});

test.describe("reset to sample data (Advanced mode)", () => {
  test("Reset restores the 8 sample speakers after confirming", async ({ page, seedStorage }) => {
    await seedStorage({ spd_ui_mode: "advanced" });
    await gotoApp(page);

    await page.locator("#btn-remove-all-speakers").click();
    await page.locator("#btn-confirm-remove-all").click();
    await expect(speakerCards(page)).toHaveCount(0);

    const dialog = acceptNextDialog(page);
    await page.locator("#btn-reset-data").click();
    expect(await dialog).toBe("Reset this project directory to default sample speakers?");
    await expect(speakerCards(page)).toHaveCount(8);
    expect((await readCurrentProject(page)).speakers).toHaveLength(8);
  });
});
