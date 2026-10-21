// Phase 5 hardening: the util.js helpers, import/stored-data validation, the CSV parser/exporter, the image error
// fallbacks that replaced inline onerror handlers, and other fixes found while writing the characterization tests.
const fs = require("fs");
const {
  test,
  expect,
  gotoApp,
  speakerCards,
  speakerCard,
  readCurrentProject,
  readRegistry,
  acceptNextDialog,
  makeSpeaker,
  makeProject,
  REGISTRY_KEY,
  CURRENT_PROJECT_KEY,
  LEGACY_SPEAKERS_KEY,
  LEGACY_MICS_KEY,
  LEGACY_TITLE_KEY,
} = require("./fixtures");

const CSV_HEADER = "Full Name,Title,Mic Assignment,Mic Type,Photo URL,Notes";

async function importFile(page, name, mimeType, content) {
  await page.locator("#import-file-input").setInputFiles({ name, mimeType, buffer: Buffer.from(content, "utf8") });
}

async function downloadCsv(page) {
  const [dl] = await Promise.all([page.waitForEvent("download"), page.locator("#btn-export-csv").click()]);
  return { name: dl.suggestedFilename(), content: fs.readFileSync(await dl.path(), "utf8") };
}

function seedProject(seedStorage, project, extra = {}) {
  return seedStorage({ [REGISTRY_KEY]: [project], [CURRENT_PROJECT_KEY]: project.id, ...extra });
}

test.describe("util.js helpers", () => {
  test("escapeHtml, safeUrl and safeMicType", async ({ page }) => {
    await gotoApp(page);
    const r = await page.evaluate(() => ({
      esc: escapeHtml(`<a href="x" title='y'>&\`</a>`),
      escNull: [escapeHtml(null), escapeHtml(undefined), escapeHtml(42), escapeHtml(false)],
      urls: [
        safeUrl("  https://example.test/a.jpg  "),
        safeUrl("HTTP://example.test/a.jpg"),
        safeUrl("javascript:alert(1)"),
        safeUrl(" javascript:alert(1)"),
        safeUrl("file:///C:/Windows/win.ini"),
        safeUrl("data:image/png;base64,AAAA"),
        safeUrl("data:image/png;base64,AAAA", { allowData: true }),
        safeUrl("data:text/html,<script>1</script>", { allowData: true }),
        safeUrl("/relative.png"),
        safeUrl(null),
        safeUrl({ toString: () => "https://x.test" }),
      ],
      mics: ["lav", "handheld", "headset", "podium", "none", "LAV", 'x" onmouseover="1', undefined, 3].map(safeMicType),
    }));
    expect(r.esc).toBe("&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&#96;&lt;/a&gt;");
    expect(r.escNull).toEqual(["", "", "42", "false"]);
    expect(r.urls).toEqual([
      "https://example.test/a.jpg",
      "HTTP://example.test/a.jpg",
      "",
      "",
      "",
      "",
      "data:image/png;base64,AAAA",
      "",
      "",
      "",
      "",
    ]);
    expect(r.mics).toEqual(["lav", "handheld", "headset", "podium", "none", "none", "none", "none", "none"]);
  });

  test("normalizeSpeakers coerces fields, caps lengths, drops bad rows and makes ids unique", async ({ page }) => {
    await gotoApp(page);
    const out = await page.evaluate(() =>
      normalizeSpeakers([
        { id: "dup", fullName: "  Ada  ", title: { evil: 1 }, mic: 7, micType: "podium", notes: "n".repeat(5000) },
        { id: "dup", fullName: "B".repeat(500), photo: "javascript:alert(1)", extra: "dropped" },
        null,
        42,
        "string row",
        ["array row"],
        { fullName: "" },
        { fullName: "   " },
        { fullName: "No Id", photo: "data:image/png;base64,AAAA" },
      ]),
    );
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({
      id: "dup",
      fullName: "Ada",
      title: "",
      mic: "7",
      micType: "podium",
      photo: expect.stringMatching(/^data:image\/svg\+xml,.*%3EA%3C%2Ftext%3E/),
      notes: "n".repeat(1000),
    });
    expect(out[1].fullName).toHaveLength(200);
    expect(out[1].id).not.toBe("dup");
    expect(out[1].micType).toBe("none");
    expect(out[1].photo).toMatch(/^data:image\/svg\+xml,/);
    expect(Object.keys(out[1]).sort()).toEqual(["fullName", "id", "mic", "micType", "notes", "photo", "title"]);
    expect(out[2].id).toMatch(/^spk-/);
    expect(out[2].photo).toBe("data:image/png;base64,AAAA");
    expect(new Set(out.map((s) => s.id)).size).toBe(3);
  });

  test("parseCsv handles quotes, embedded commas/newlines, CRLF and a BOM", async ({ page }) => {
    await gotoApp(page);
    const rows = await page.evaluate(() =>
      parseCsv('\uFEFFa,b,c\r\n"x, y","say ""hi""","line1\nline2"\r\nplain,O\'Brien "Q" Jr.,#hash\n\n"",,last'),
    );
    expect(rows).toEqual([
      ["a", "b", "c"],
      ["x, y", 'say "hi"', "line1\nline2"],
      ["plain", `O'Brien "Q" Jr.`, "#hash"],
      [""],
      ["", "", "last"],
    ]);
  });
});

test.describe("JSON import validation (Advanced mode)", () => {
  test.beforeEach(async ({ page, seedStorage }) => {
    await seedStorage({ spd_ui_mode: "advanced" });
    await gotoApp(page);
    await page.locator("#btn-import-export").click();
  });

  for (const [label, content] of [
    ["an object without a speakers list", JSON.stringify({ foo: 1 })],
    ["a speakers field that is not an array", JSON.stringify({ speakers: "nope" })],
    ["a JSON string", JSON.stringify("hello")],
    ["JSON null", "null"],
  ]) {
    test(`rejects ${label} and changes nothing`, async ({ page }) => {
      const dialog = acceptNextDialog(page);
      await importFile(page, "bad.json", "application/json", content);
      expect(await dialog).toBe("Invalid JSON file format.");
      await expect(speakerCards(page)).toHaveCount(8);
      expect((await readCurrentProject(page)).speakers).toHaveLength(8);
    });
  }

  test("rejects a list without a single valid speaker", async ({ page }) => {
    const dialog = acceptNextDialog(page);
    await importFile(page, "bad.json", "application/json", JSON.stringify([1, null, "x", { fullName: "" }]));
    expect(await dialog).toBe("No valid speakers found in this file.");
    await expect(speakerCards(page)).toHaveCount(8);
  });

  test("normalizes non-string, oversized and duplicate-id rows", async ({ page }) => {
    const data = {
      projectTitle: "T".repeat(500),
      speakers: [
        { id: "same", fullName: 123, title: ["x"], notes: "n".repeat(3000), micType: "laser" },
        { id: "same", fullName: "Second", mic: "M".repeat(300) },
        { nonsense: true },
      ],
      micInventory: [{ name: "Only Mic", type: "handheld" }, { name: "" }, 5, { name: "Bad Type", type: "x" }],
    };
    await importFile(page, "messy.json", "application/json", JSON.stringify(data));
    await expect(speakerCards(page)).toHaveCount(2);
    await expect(page.locator("#toast-container")).toContainText("Imported 2 speakers!");

    const project = await readCurrentProject(page);
    expect(project.title).toBe("T".repeat(200));
    expect(project.speakers[0]).toMatchObject({ id: "same", fullName: "123", title: "", micType: "none" });
    expect(project.speakers[0].notes).toHaveLength(1000);
    expect(project.speakers[1].id).not.toBe("same");
    expect(project.speakers[1].mic).toHaveLength(100);
    expect(project.micInventory).toEqual([
      { name: "Only Mic", type: "handheld" },
      { name: "Bad Type", type: "none" },
    ]);

    // The imported inventory is used by the speaker form right away
    await page.locator("#btn-add-speaker").click();
    await expect(page.locator("#form-mic-preset option")).toHaveText([
      "Only Mic",
      "Bad Type",
      "-- Custom Mic Entry --",
    ]);
  });

  test("the file input is reset, so the same file can be imported twice", async ({ page }) => {
    const file = JSON.stringify([makeSpeaker({ id: "a", fullName: "Twice" })]);
    await importFile(page, "same.json", "application/json", file);
    await expect(speakerCards(page)).toHaveCount(1);
    await expect(page.locator("#import-file-input")).toHaveValue("");

    await page.evaluate(() => {
      app.speakers = [];
      app.saveSpeakers();
      app.render();
    });
    await expect(speakerCards(page)).toHaveCount(0);
    await page.locator("#btn-import-export").click();
    await importFile(page, "same.json", "application/json", file);
    await expect(speakerCards(page)).toHaveCount(1);
  });
});

test.describe("stored data is validated on load", () => {
  test("a corrupted registry falls back to the sample data without errors", async ({
    page,
    seedStorage,
    consoleErrors,
  }) => {
    await seedStorage({ [REGISTRY_KEY]: "{not json", [CURRENT_PROJECT_KEY]: "missing" });
    await gotoApp(page);
    await expect(speakerCards(page)).toHaveCount(8);
    const registry = await readRegistry(page);
    expect(registry).toHaveLength(1);
    expect(registry[0].speakers).toHaveLength(8);
    expect(consoleErrors.filter((e) => e.startsWith("pageerror"))).toEqual([]);
  });

  test("a registry of the wrong type or with garbage entries is repaired", async ({ page, seedStorage }) => {
    await seedStorage({
      [REGISTRY_KEY]: [
        null,
        5,
        "x",
        { id: "p1", title: { x: 1 }, speakers: "nope", micInventory: 7, lastModified: "yesterday" },
        { id: "p1", title: "Duplicate id", speakers: [makeSpeaker({ id: "s1" }), { fullName: 9 }, null] },
      ],
      [CURRENT_PROJECT_KEY]: "p1",
    });
    await gotoApp(page);
    await expect(speakerCards(page)).toHaveCount(0);
    await expect(page.locator("#project-title-display")).toHaveText("Speaker Photo Directory");
    const state = await page.evaluate(() => ({
      registry: app.projectsRegistry,
      mics: app.micInventory.length,
    }));
    expect(state.registry).toHaveLength(2);
    expect(state.registry[0]).toMatchObject({ id: "p1", title: "Speaker Photo Directory", speakers: [] });
    expect(Date.parse(state.registry[0].lastModified)).not.toBeNaN();
    expect(state.mics).toBe(17);
    expect(state.registry[1].id).not.toBe("p1");
    expect(state.registry[1].speakers.map((s) => s.fullName)).toEqual(["Test Speaker", "9"]);
  });

  test("a registry that is an object (not an array) falls back to the legacy keys", async ({ page, seedStorage }) => {
    await seedStorage({
      [REGISTRY_KEY]: { evil: true },
      [LEGACY_TITLE_KEY]: "Legacy Title",
      [LEGACY_SPEAKERS_KEY]: [makeSpeaker({ id: "l1", fullName: "Legacy Person", micType: "bogus" }), 3],
      [LEGACY_MICS_KEY]: "{broken",
    });
    await gotoApp(page);
    await expect(speakerCards(page)).toHaveCount(1);
    await expect(page.locator("#project-title-display")).toHaveText("Legacy Title");
    const project = await readCurrentProject(page);
    expect(project.speakers[0]).toMatchObject({ fullName: "Legacy Person", micType: "none" });
    expect(project.micInventory).toHaveLength(17);
  });
});

test.describe("CSV export / import", () => {
  const tricky = [
    makeSpeaker({
      id: "c1",
      fullName: 'Smith, "Jr." #1',
      title: "Head of R&D, Acme # Corp",
      mic: "Lav #3, spare",
      micType: "headset",
      photo: "https://images.example.test/a.jpg?x=1&y=2#frag",
      notes: 'Line one\nLine two, with "quotes"\r\nand # hash',
    }),
    makeSpeaker({ id: "c2", fullName: "O'Brien", title: "", mic: "", micType: "none", notes: "" }),
  ];

  test("export then import is lossless for commas, quotes, # and newlines", async ({ page, seedStorage }) => {
    await seedProject(seedStorage, makeProject({ id: "csv", speakers: tricky }), { spd_ui_mode: "advanced" });
    await gotoApp(page);
    await page.locator("#btn-import-export").click();
    const exported = await downloadCsv(page);
    expect(exported.content.startsWith(CSV_HEADER + "\n")).toBe(true);
    // The whole file is downloaded (it used to be cut off at the first '#')
    expect(exported.content).toContain("and # hash");

    await importFile(page, exported.name, "text/csv", exported.content);
    await expect(page.locator("#toast-container")).toContainText("Imported 2 speakers from CSV!");
    const after = (await readCurrentProject(page)).speakers;
    const fields = ({ fullName, title, mic, micType, photo, notes }) => ({
      fullName,
      title,
      mic,
      micType,
      photo,
      notes,
    });
    expect(after.map(fields)).toEqual([
      fields(tricky[0]),
      // Empty CSV cells get the import defaults
      { ...fields(tricky[1]), title: "Guest Speaker", mic: "Unassigned" },
    ]);
    await expect(speakerCard(page, 'Smith, "Jr." #1')).toContainText("Head of R&D, Acme # Corp");
  });
});

test.describe("other fixes", () => {
  test("Reset to sample data restores the original seed even after in-place edits", async ({ page, seedStorage }) => {
    await seedStorage({ spd_ui_mode: "advanced" });
    await gotoApp(page);
    // The quick mic menu edits the speaker object in place; it used to edit INITIAL_SPEAKERS too
    await speakerCard(page, "Dr. Elena Rostova").locator('[data-action="quick-mic"]').click();
    await page.locator('#quick-mic-menu [data-mic="Podium Mic"]').click();
    await expect(speakerCard(page, "Dr. Elena Rostova")).toContainText("Podium Mic");

    page.once("dialog", (d) => d.accept());
    await page.locator("#btn-reset-data").click();
    await expect(page.locator("#toast-container")).toContainText("Reset to default speakers");
    await expect(speakerCard(page, "Dr. Elena Rostova")).toContainText("Lav 1 (Channel A)");
    expect(await page.evaluate(() => INITIAL_SPEAKERS[0].mic)).toBe("Lav 1 (Channel A)");
    // The restored speakers are copies, not the seed objects themselves
    expect(await page.evaluate(() => app.speakers[0] !== INITIAL_SPEAKERS[0])).toBe(true);
  });

  test("a mic name containing | and % round-trips through the speaker form dropdown", async ({ page, seedStorage }) => {
    const micName = "Wireless | Ch 5 %20 & <b>";
    await seedStorage({ spd_ui_mode: "advanced" });
    await gotoApp(page);
    await page.locator("#btn-manage-mics").click();
    await page.locator("#new-mic-name").fill(micName);
    await page.locator("#new-mic-type").selectOption("headset");
    await page.locator("#btn-add-new-mic").click();
    await page.locator("#mics-manager-modal").getByRole("button", { name: "Done" }).click();

    await page.locator("#btn-add-speaker").click();
    await page.locator("#form-fullname").fill("Pipe Person");
    await page.locator("#form-title").fill("Tester");
    await page.locator("#form-mic-preset").selectOption({ label: micName });
    await page.locator("#speaker-modal").getByRole("button", { name: "Save Speaker" }).click();

    const project = await readCurrentProject(page);
    expect(project.speakers[0]).toMatchObject({ fullName: "Pipe Person", mic: micName, micType: "headset" });
    await expect(speakerCards(page).first()).toContainText(micName);

    // Editing preselects the same option
    await speakerCards(page).first().locator('[data-action="edit"]:visible').first().click();
    await expect(page.locator("#form-mic-preset option:checked")).toHaveText(micName);
  });

  test("toasts show messages as literal text", async ({ page }) => {
    await gotoApp(page);
    await page.evaluate(() => app.showToast(`<b>bold</b> & "quoted" O'Brien`));
    const toast = page.locator("#toast-container .toast-msg").last();
    await expect(toast).toHaveText(`✓ <b>bold</b> & "quoted" O'Brien`);
    await expect(toast.locator("b")).toHaveCount(0);
    await expect(toast.locator("span")).toHaveCount(2);
  });

  test("a broken photo falls back to the initials avatar in the card and the print preview", async ({
    page,
    seedStorage,
  }) => {
    await page.route("https://broken.example.test/**", (route) => route.fulfill({ status: 404, body: "" }));
    await seedProject(
      seedStorage,
      makeProject({
        id: "img",
        speakers: [makeSpeaker({ fullName: "Broken O'Photo", photo: "https://broken.example.test/x.jpg" })],
      }),
    );
    await gotoApp(page);
    const img = speakerCards(page).first().locator("img.speaker-img");
    await expect(img).toHaveAttribute("src", /^data:image\/svg\+xml,.*width%3D%22512%22.*%3EBO%3C%2Ftext%3E/);
    await page.locator("#btn-open-print-modal").click();
    await expect(page.locator("#print-preview-grid img")).toHaveAttribute(
      "src",
      /^data:image\/svg\+xml,.*width%3D%22200%22/,
    );
  });

  test("a broken search result thumbnail is hidden", async ({ page }) => {
    await page.route("https://en.wikipedia.org/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({
          query: {
            pages: {
              1: { title: "Good", thumbnail: { source: "https://upload.example.test/good.jpg" } },
              2: { title: "Broken", thumbnail: { source: "https://broken.example.test/bad.jpg" } },
            },
          },
        }),
      }),
    );
    await page.route("https://broken.example.test/**", (route) => route.fulfill({ status: 404, body: "" }));
    await gotoApp(page);
    await page.evaluate(() => app.openPhotoLookupModal("Ada"));
    const items = page.locator("#online-search-results .photo-result-item");
    await expect(items).toHaveCount(2);
    await expect(items.filter({ hasText: "Broken" })).toBeHidden();
    await expect(items.filter({ hasText: "Good" })).toBeVisible();
  });

  test("the empty state's Show All button clears search and filters (also in view-only mode)", async ({ page }) => {
    for (const path of ["/", "/?view=readonly"]) {
      await gotoApp(page, path);
      await page.locator("#search-input").fill("no such speaker");
      await expect(speakerCards(page)).toHaveCount(0);
      await page.locator('#speakers-container [data-action="clear-filters"]').click();
      await expect(speakerCards(page)).toHaveCount(8);
      await expect(page.locator("#search-input")).toHaveValue("");
    }
  });

  test("no inline event-handler attributes or CSP violations after visiting every screen", async ({
    page,
    seedStorage,
    desktopSecrets,
    desktopSyncFolder,
    consoleErrors,
  }) => {
    // Fake desktop bridges, so the backup folder screen can be visited with a folder chosen
    await desktopSecrets();
    await desktopSyncFolder({ files: { "Backup_Seed.json": "{}" } });
    await seedStorage({ spd_ui_mode: "advanced" });
    await page.addInitScript(() => {
      window.__cspViolations = [];
      document.addEventListener("securitypolicyviolation", (e) =>
        window.__cspViolations.push(`${e.violatedDirective} ${e.blockedURI}`),
      );
    });
    await page.route("https://en.wikipedia.org/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({
          query: { pages: { 1: { title: "Result", thumbnail: { source: "https://upload.example.test/r.jpg" } } } },
        }),
      }),
    );
    const inlineHandlers = () =>
      page.evaluate(() =>
        [...document.querySelectorAll("*")].flatMap((el) =>
          [...el.attributes].filter((a) => /^on/i.test(a.name)).map((a) => `${el.tagName}[${a.name}]`),
        ),
      );
    await gotoApp(page);
    await page.locator("#btn-add-speaker").click();
    await page.locator("#speaker-modal").getByRole("button", { name: "Cancel" }).click();
    await page.locator("#btn-manage-mics").click();
    await page.locator("#mics-manager-modal").getByRole("button", { name: "Done" }).click();
    await speakerCards(page).first().locator('[data-action="quick-mic"]').click();
    await page.locator("#speaker-count").click();
    await page.locator("#btn-projects-menu").click();
    await page.evaluate(() => app.closeModal("projects-modal"));
    await page.locator("#btn-open-print-modal").click();
    await page.evaluate(() => app.closeModal("print-modal"));
    await page.locator("#btn-import-export").click();
    await page.evaluate(() => app.closeModal("import-export-modal"));
    await page.evaluate(() => app.openPhotoLookupModal("Ada"));
    await expect(page.locator("#online-search-results .photo-result-item")).toHaveCount(1);
    await page.evaluate(() => app.closeModal("photo-lookup-modal"));
    await page.locator("#btn-sync-menu").click();
    await expect(page.locator("#sync-backups-container")).toContainText("Backup_Seed.json");
    await page.evaluate(() => app.closeModal("sync-modal"));
    await page.evaluate(() => app.toggleReorderMode(true));
    await page.evaluate(() => app.toggleReorderMode(false));
    await page.locator("#search-input").fill("no such speaker");
    await expect(page.locator('[data-action="clear-filters"]')).toBeVisible();

    expect(await inlineHandlers()).toEqual([]);
    expect(await page.locator("[onerror],[onclick],[onmouseover],[onload]").count()).toBe(0);
    // The Content-Security-Policy <meta> in index.html is in force and nothing the app does violates it
    expect(
      await page.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content),
    ).toContain("script-src 'self';");
    expect(await page.evaluate(() => window.__cspViolations)).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});

test("the Content-Security-Policy blocks injected inline handlers (defense in depth)", async ({ page }) => {
  await gotoApp(page);
  const result = await page.evaluate(
    () =>
      new Promise((resolve) => {
        document.addEventListener("securitypolicyviolation", (e) => resolve(e.violatedDirective), { once: true });
        const div = document.createElement("div");
        div.innerHTML = '<img src="data:image/png;base64,broken" onerror="window.__cspProbe=1">';
        document.body.appendChild(div);
        setTimeout(() => resolve("no violation"), 2000);
      }),
  );
  expect(result).toMatch(/^script-src/);
  expect(await page.evaluate(() => window.__cspProbe)).toBeUndefined();
});
