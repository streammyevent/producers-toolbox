// Renderer bootstrap. Loaded last, after every other script in index.html.

// Global App Instance
let app;
document.addEventListener("DOMContentLoaded", async () => {
  // Secrets first: load the encrypted store (desktop app), purge any plaintext secret an older version left in
  // localStorage, and only then let the app read from the in-memory cache.
  await SecretStore.init();
  await SecretStore.migrateLegacy();

  app = new SpeakerDirectoryApp();
  initDesktopAppIntegration(app);
  window.syncController = new SyncFolderController(app);
});
