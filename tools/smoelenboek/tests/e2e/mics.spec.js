const { test, expect, gotoApp, speakerCard, readCurrentProject, acceptNextDialog } = require("./fixtures");

const inventory = (page) => page.locator("#mic-inventory-container");

async function openMicManager(page) {
  await page.locator("#btn-manage-mics").click();
  await expect(page.locator("#mics-manager-modal")).toBeVisible();
}

test.describe("mic inventory (Advanced mode)", () => {
  test.beforeEach(async ({ page, seedStorage }) => {
    // Manage Mics is an Advanced-mode control
    await seedStorage({ spd_ui_mode: "advanced" });
    await gotoApp(page);
  });

  test("lists the 17 default mics, one delete button each", async ({ page }) => {
    await openMicManager(page);
    await expect(inventory(page).locator("[data-mic-name]")).toHaveCount(17);
    await expect(inventory(page)).toContainText("Lav 1 (Channel A)");
    await expect(inventory(page)).toContainText("Unassigned / Greenroom");
  });

  test("adds a custom mic that then appears in the speaker form dropdown and quick menu", async ({ page }) => {
    await openMicManager(page);
    await page.locator("#new-mic-name").fill("Shure Beta 58 #1");
    await page.locator("#new-mic-type").selectOption("handheld");
    await page.locator("#btn-add-new-mic").click();

    await expect(inventory(page).locator('[data-mic-name="Shure Beta 58 #1"]')).toHaveCount(1);
    await expect(page.locator("#new-mic-name")).toHaveValue("");
    await expect(page.locator("#toast-container")).toContainText("Microphone inventory updated!");

    const project = await readCurrentProject(page);
    expect(project.micInventory).toHaveLength(18);
    expect(project.micInventory.at(-1)).toEqual({ name: "Shure Beta 58 #1", type: "handheld" });

    await page.locator("#mics-manager-modal").getByRole("button", { name: "Done" }).click();
    await expect(page.locator("#mics-manager-modal")).toBeHidden();

    // Speaker form dropdown
    await page.locator("#btn-add-speaker").click();
    const option = page.locator('#form-mic-preset option[value="Shure Beta 58 #1|handheld"]');
    await expect(option).toHaveCount(1);
    await expect(option).toHaveText("Shure Beta 58 #1");
    await page.locator("#speaker-modal").getByRole("button", { name: "Cancel" }).click();
    await expect(page.locator("#speaker-modal")).toBeHidden();

    // Quick mic menu
    await speakerCard(page, "Marcus Vance").locator('[data-action="quick-mic"]').click();
    await expect(page.locator('#quick-mic-menu [data-mic="Shure Beta 58 #1"]')).toBeVisible();
  });

  test("rejects an empty name and a duplicate name (case-insensitive)", async ({ page }) => {
    await openMicManager(page);

    let dialog = acceptNextDialog(page);
    await page.locator("#btn-add-new-mic").click();
    expect(await dialog).toBe("Please enter a microphone name or channel number.");

    dialog = acceptNextDialog(page);
    await page.locator("#new-mic-name").fill("handheld 1");
    await page.locator("#btn-add-new-mic").click();
    expect(await dialog).toBe("A microphone with this name already exists in inventory.");
    expect((await readCurrentProject(page)).micInventory).toHaveLength(17);
  });

  test("deletes a mic from the inventory", async ({ page }) => {
    await openMicManager(page);
    await inventory(page).locator('[data-mic-name="Catchbox (Audience)"]').click();
    await expect(inventory(page).locator('[data-mic-name="Catchbox (Audience)"]')).toHaveCount(0);
    await expect(inventory(page).locator("[data-mic-name]")).toHaveCount(16);
    const project = await readCurrentProject(page);
    expect(project.micInventory.map((m) => m.name)).not.toContain("Catchbox (Audience)");
    // Speakers are untouched
    expect(project.speakers).toHaveLength(8);
  });

  test("Reset to Default Mics restores the default list after confirming", async ({ page }) => {
    await openMicManager(page);
    await inventory(page).locator('[data-mic-name="Lav 5"]').click();
    await expect(inventory(page).locator("[data-mic-name]")).toHaveCount(16);

    const dialog = acceptNextDialog(page);
    await page.locator("#btn-reset-mics").click();
    expect(await dialog).toBe("Reset microphone inventory list to default?");
    await expect(inventory(page).locator("[data-mic-name]")).toHaveCount(17);
    expect((await readCurrentProject(page)).micInventory).toHaveLength(17);
  });
});
