const {
  test,
  expect,
  gotoApp,
  speakerCards,
  readRegistry,
  readCurrentProject,
  readStorage,
  readJsonStorage,
  acceptNextDialog,
  makeProject,
  makeSpeaker,
  CURRENT_PROJECT_KEY,
  LEGACY_SPEAKERS_KEY,
  LEGACY_MICS_KEY,
  LEGACY_TITLE_KEY,
} = require("./fixtures");

const PROJECT_KEYS = ["id", "lastModified", "micInventory", "speakers", "title"];

function expectProjectShape(project) {
  expect(Object.keys(project).sort()).toEqual(PROJECT_KEYS);
  expect(typeof project.id).toBe("string");
  expect(typeof project.title).toBe("string");
  expect(Array.isArray(project.speakers)).toBe(true);
  expect(Array.isArray(project.micInventory)).toBe(true);
  expect(Number.isNaN(Date.parse(project.lastModified))).toBe(false);
}

async function openProjectsModal(page) {
  await page.locator("#btn-projects-menu").click();
  await expect(page.locator("#projects-modal")).toBeVisible();
}

const projectsList = (page) => page.locator("#projects-list-container");

test.describe("projects", () => {
  test("creates a new empty project and makes it active", async ({ page }) => {
    await gotoApp(page);
    const original = await readCurrentProject(page);

    await openProjectsModal(page);
    // One Duplicate button per saved project; the active project has no Open button
    await expect(projectsList(page).locator('[data-action="duplicate-project"]')).toHaveCount(1);
    await expect(projectsList(page).locator('[data-action="open-project"]')).toHaveCount(0);
    await expect(projectsList(page)).toContainText("Speaker Photo Directory");
    await expect(projectsList(page)).toContainText("8 Speakers");

    await page.locator("#new-project-title-input").fill("AI Vision Summit 2026");
    await page.locator("#btn-create-new-project").click();

    await expect(page.locator("#projects-modal")).toBeHidden();
    await expect(page.locator("#project-title-display")).toHaveText("AI Vision Summit 2026");
    await expect(page).toHaveTitle("AI Vision Summit 2026");
    await expect(speakerCards(page)).toHaveCount(0);
    await expect(page.getByText("No speakers found")).toBeVisible();
    await expect(page.locator("#toast-container")).toContainText('Created new project: "AI Vision Summit 2026"');

    const registry = await readRegistry(page);
    expect(registry).toHaveLength(2);
    registry.forEach(expectProjectShape);
    // New projects are prepended
    expect(registry[0].title).toBe("AI Vision Summit 2026");
    expect(registry[0].speakers).toEqual([]);
    expect(registry[0].micInventory).toHaveLength(17);
    expect(registry[0].id).toMatch(/^proj-\d+$/);
    expect(registry[1].id).toBe(original.id);
    expect(registry[1].speakers).toHaveLength(8);
    expect(await readStorage(page, CURRENT_PROJECT_KEY)).toBe(registry[0].id);

    // Legacy keys are still written and mirror the active project
    expect(await readStorage(page, LEGACY_TITLE_KEY)).toBe("AI Vision Summit 2026");
    expect(await readJsonStorage(page, LEGACY_SPEAKERS_KEY)).toEqual([]);
    expect(await readJsonStorage(page, LEGACY_MICS_KEY)).toEqual(registry[0].micInventory);
  });

  test("creating with an empty title uses 'Untitled Event Directory' (Enter key)", async ({ page }) => {
    await gotoApp(page);
    await openProjectsModal(page);
    await page.locator("#new-project-title-input").press("Enter");
    await expect(page.locator("#project-title-display")).toHaveText("Untitled Event Directory");
    expect((await readRegistry(page))[0].title).toBe("Untitled Event Directory");
  });

  test("duplicates a project (deep copy, not activated)", async ({ page }) => {
    await gotoApp(page);
    const original = await readCurrentProject(page);

    await openProjectsModal(page);
    await projectsList(page).locator(`[data-action="duplicate-project"][data-id="${original.id}"]`).click();

    // The modal stays open and lists both projects
    await expect(projectsList(page).locator('[data-action="duplicate-project"]')).toHaveCount(2);
    await expect(projectsList(page)).toContainText("Speaker Photo Directory (Copy)");
    await expect(page.locator("#toast-container")).toContainText('Duplicated "Speaker Photo Directory"');

    const registry = await readRegistry(page);
    expect(registry).toHaveLength(2);
    registry.forEach(expectProjectShape);
    const [copy, orig] = registry;
    expect(copy.title).toBe("Speaker Photo Directory (Copy)");
    expect(copy.id).not.toBe(orig.id);
    expect(copy.speakers).toEqual(orig.speakers);
    expect(copy.micInventory).toEqual(orig.micInventory);
    // The original stays active
    expect(await readStorage(page, CURRENT_PROJECT_KEY)).toBe(original.id);
    await expect(page.locator("#project-title-display")).toHaveText("Speaker Photo Directory");
  });

  test("switches to another project via Open", async ({ page, seedStorage }) => {
    const first = makeProject({ id: "proj-1", title: "First Event" });
    const second = makeProject({
      id: "proj-2",
      title: "Second Event",
      speakers: [
        makeSpeaker({ id: "spk-a", fullName: "Alice Second" }),
        makeSpeaker({ id: "spk-b", fullName: "Bob Second", mic: "Handheld 1", micType: "handheld" }),
      ],
    });
    await seedStorage({ speaker_projects_registry_v1: [first, second], speaker_current_project_id_v1: "proj-1" });
    await gotoApp(page);

    await expect(page.locator("#project-title-display")).toHaveText("First Event");
    await expect(speakerCards(page)).toHaveCount(1);

    await openProjectsModal(page);
    await projectsList(page).locator('[data-action="open-project"][data-id="proj-2"]').click();

    await expect(page.locator("#projects-modal")).toBeHidden();
    await expect(page.locator("#project-title-display")).toHaveText("Second Event");
    await expect(speakerCards(page)).toHaveCount(2);
    await expect(page.locator("#count-handheld")).toHaveText("1");
    await expect(page.locator("#toast-container")).toContainText('Opened "Second Event"');
    expect(await readStorage(page, CURRENT_PROJECT_KEY)).toBe("proj-2");
    expect(await readStorage(page, LEGACY_TITLE_KEY)).toBe("Second Event");
    expect((await readJsonStorage(page, LEGACY_SPEAKERS_KEY)).map((s) => s.id)).toEqual(["spk-a", "spk-b"]);

    // Registry order is unchanged by opening
    expect((await readRegistry(page)).map((p) => p.id)).toEqual(["proj-1", "proj-2"]);
  });

  test("deletes a non-active project after confirming", async ({ page, seedStorage }) => {
    await seedStorage({
      speaker_projects_registry_v1: [
        makeProject({ id: "proj-1", title: "Keep Me" }),
        makeProject({ id: "proj-2", title: "Delete Me" }),
      ],
      speaker_current_project_id_v1: "proj-1",
    });
    await gotoApp(page);
    await openProjectsModal(page);

    const dialog = acceptNextDialog(page);
    await projectsList(page).locator('[data-action="delete-project"][data-id="proj-2"]').click();
    expect(await dialog).toBe('Are you sure you want to permanently delete the project "Delete Me"?');

    await expect(projectsList(page).locator('[data-action="duplicate-project"]')).toHaveCount(1);
    await expect(projectsList(page)).not.toContainText("Delete Me");
    await expect(page.locator("#toast-container")).toContainText("Project deleted");
    expect((await readRegistry(page)).map((p) => p.id)).toEqual(["proj-1"]);
    expect(await readStorage(page, CURRENT_PROJECT_KEY)).toBe("proj-1");
  });

  test("deleting the active project opens the first remaining one", async ({ page, seedStorage }) => {
    await seedStorage({
      speaker_projects_registry_v1: [
        makeProject({ id: "proj-1", title: "Other Event" }),
        makeProject({ id: "proj-2", title: "Active Event", speakers: [] }),
      ],
      speaker_current_project_id_v1: "proj-2",
    });
    await gotoApp(page);
    await expect(page.locator("#project-title-display")).toHaveText("Active Event");
    await openProjectsModal(page);

    const dialog = acceptNextDialog(page);
    await projectsList(page).locator('[data-action="delete-project"][data-id="proj-2"]').click();
    await dialog;

    await expect(page.locator("#project-title-display")).toHaveText("Other Event");
    await expect(speakerCards(page)).toHaveCount(1);
    expect((await readRegistry(page)).map((p) => p.id)).toEqual(["proj-1"]);
    expect(await readStorage(page, CURRENT_PROJECT_KEY)).toBe("proj-1");
  });

  test("dismissing the delete confirm keeps the project", async ({ page, seedStorage }) => {
    await seedStorage({
      speaker_projects_registry_v1: [makeProject({ id: "proj-1" }), makeProject({ id: "proj-2", title: "Stays" })],
      speaker_current_project_id_v1: "proj-1",
    });
    await gotoApp(page);
    await openProjectsModal(page);
    page.once("dialog", (d) => d.dismiss());
    await projectsList(page).locator('[data-action="delete-project"][data-id="proj-2"]').click();
    await expect(projectsList(page).locator('[data-action="duplicate-project"]')).toHaveCount(2);
    expect(await readRegistry(page)).toHaveLength(2);
  });

  test("the last remaining project cannot be deleted (alert)", async ({ page }) => {
    await gotoApp(page);
    const original = await readCurrentProject(page);
    await openProjectsModal(page);

    const dialog = acceptNextDialog(page);
    await projectsList(page).locator(`[data-action="delete-project"][data-id="${original.id}"]`).click();
    expect(await dialog).toBe("You must have at least one project. Create a new project before deleting this one.");
    expect(await readRegistry(page)).toHaveLength(1);
  });

  test("an unknown current project id falls back to the first project", async ({ page, seedStorage }) => {
    await seedStorage({
      speaker_projects_registry_v1: [makeProject({ id: "proj-1", title: "Fallback Event" })],
      speaker_current_project_id_v1: "proj-does-not-exist",
    });
    await gotoApp(page);
    await expect(page.locator("#project-title-display")).toHaveText("Fallback Event");
    expect(await readStorage(page, CURRENT_PROJECT_KEY)).toBe("proj-1");
  });

  test("legacy keys are migrated into a project on first run", async ({ page, seedStorage }) => {
    await seedStorage({
      speaker_project_title_v1: "Legacy Event",
      speaker_photo_directory_v1: [makeSpeaker({ id: "spk-legacy", fullName: "Legacy Person" })],
      speaker_mic_inventory_v1: [{ name: "Old Lav", type: "lav" }],
    });
    await gotoApp(page);

    await expect(page.locator("#project-title-display")).toHaveText("Legacy Event");
    await expect(speakerCards(page)).toHaveCount(1);
    await expect(speakerCards(page).first()).toContainText("Legacy Person");
    const registry = await readRegistry(page);
    expect(registry).toHaveLength(1);
    expectProjectShape(registry[0]);
    expect(registry[0]).toMatchObject({ title: "Legacy Event", micInventory: [{ name: "Old Lav", type: "lav" }] });
  });
});

test.describe("project title", () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
  });

  test("renames the project by clicking the title and pressing Enter", async ({ page }) => {
    const input = page.locator("#project-title-input");
    await expect(input).toBeHidden();
    await page.locator("#project-title-display").click();
    await expect(input).toBeVisible();
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("Speaker Photo Directory");

    await input.fill("Annual Gala 2026");
    await input.press("Enter");

    await expect(input).toBeHidden();
    await expect(page.locator("#project-title-display")).toHaveText("Annual Gala 2026");
    await expect(page).toHaveTitle("Annual Gala 2026");
    await expect(page.locator("#toast-container")).toContainText("Project title updated!");
    expect((await readCurrentProject(page)).title).toBe("Annual Gala 2026");
    expect(await readStorage(page, LEGACY_TITLE_KEY)).toBe("Annual Gala 2026");
  });

  test("the pencil button also starts editing; blur saves", async ({ page }) => {
    await page.locator("#btn-edit-title").click();
    const input = page.locator("#project-title-input");
    await expect(input).toBeVisible();
    await input.fill("Saved On Blur");
    await page.locator("#search-input").click();
    await expect(page.locator("#project-title-display")).toHaveText("Saved On Blur");
    expect((await readCurrentProject(page)).title).toBe("Saved On Blur");
  });

  test("an empty title is ignored and the old title kept", async ({ page }) => {
    await page.locator("#project-title-display").click();
    await page.locator("#project-title-input").fill("   ");
    await page.locator("#project-title-input").press("Enter");
    await expect(page.locator("#project-title-display")).toHaveText("Speaker Photo Directory");
    expect((await readCurrentProject(page)).title).toBe("Speaker Photo Directory");
  });
});
