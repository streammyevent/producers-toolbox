const { test, expect, gotoApp } = require("./fixtures");

// The renderer is split over classic scripts that share globals (see CLAUDE.md). A missing or mis-ordered
// <script> tag in index.html shows up here as a missing global or prototype method.
test.describe("renderer script structure", () => {
  test("the shared globals and the SpeakerDirectoryApp mixin methods exist", async ({ page, consoleErrors }) => {
    await gotoApp(page);
    const result = await page.evaluate(() => ({
      globals: {
        SpeakerDirectoryApp: typeof SpeakerDirectoryApp,
        SyncFolderController: typeof SyncFolderController,
        SyncFolderService: typeof SyncFolderService,
        SecretStore: typeof SecretStore,
        escapeHtml: typeof escapeHtml,
        appIsInstance: app instanceof SpeakerDirectoryApp,
        controllerIsInstance: window.syncController instanceof SyncFolderController,
        serviceIsInstance: window.syncFolderService instanceof SyncFolderService,
        noDriveLeftovers: [typeof window.gDriveService, typeof window.google].join(),
      },
      methods: Object.fromEntries(
        [
          "render", // app-speakers.js
          "saveCurrentProjectState", // app-projects.js
          "importFile", // app-io.js
          "exportJson", // app-io.js
          "renderPrintPreview", // app-print.js
          "showQuickMicMenu", // app-mics.js
          "executeOnlineSearch", // app-photos.js
          "selectPhoto", // app-photos.js
          "setUiMode", // app-ui.js
          "showToast", // app-core.js
        ].map((name) => [name, typeof SpeakerDirectoryApp.prototype[name]]),
      ),
      desktopIntegration: typeof initDesktopAppIntegration,
      imageFallback: typeof handleImageError,
    }));

    expect(result.globals).toEqual({
      SpeakerDirectoryApp: "function",
      SyncFolderController: "function",
      SyncFolderService: "function",
      SecretStore: "object",
      escapeHtml: "function",
      appIsInstance: true,
      controllerIsInstance: true,
      serviceIsInstance: true,
      noDriveLeftovers: "undefined,undefined",
    });
    for (const [name, type] of Object.entries(result.methods)) expect(type, name).toBe("function");
    expect(result.desktopIntegration).toBe("function");
    expect(result.imageFallback).toBe("function");
    expect(consoleErrors).toEqual([]);
  });
});
