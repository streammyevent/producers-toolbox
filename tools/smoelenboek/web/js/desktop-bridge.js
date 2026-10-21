// @ts-check
// Inside the Producers Toolbox app: offer the shell's window.toolbox as the window.electronAPI this app was written
// against (secrets, backup folder, close). In a plain browser there is no window.toolbox and this does nothing.
(function () {
  const toolbox = window.toolbox;
  if (!toolbox || "electronAPI" in window) return;
  /** @type {any} */ (window).electronAPI = Object.freeze({
    isDesktop: true,
    platform: toolbox.platform,
    quitApp: () => toolbox.close(),
    secrets: toolbox.secrets,
    syncFolder: toolbox.folder,
  });
})();
