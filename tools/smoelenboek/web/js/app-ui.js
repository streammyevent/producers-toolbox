// SpeakerDirectoryApp: Basic/Advanced UI mode, plus the global desktop integration and image fallbacks.

Object.assign(SpeakerDirectoryApp.prototype, {
  // --- Basic / Advanced UI Mode Management ---
  initUiMode() {
    const isAdv = this.uiMode === "advanced";
    if (this.toggleModeSwitch) {
      this.toggleModeSwitch.checked = isAdv;
    }
    if (isAdv) {
      document.body.classList.remove("ui-mode-basic");
      document.body.classList.add("ui-mode-advanced");
      if (this.modeLabelBasic) this.modeLabelBasic.classList.remove("active");
      if (this.modeLabelAdv) this.modeLabelAdv.classList.add("active");
    } else {
      document.body.classList.remove("ui-mode-advanced");
      document.body.classList.add("ui-mode-basic");
      if (this.modeLabelBasic) this.modeLabelBasic.classList.add("active");
      if (this.modeLabelAdv) this.modeLabelAdv.classList.remove("active");
    }
  },

  setUiMode(mode) {
    this.uiMode = mode;
    localStorage.setItem("spd_ui_mode", mode);
    this.initUiMode();
    this.showToast(mode === "advanced" ? "Switched to Advanced Mode" : "Switched to Basic Mode");
  },
});

// Desktop App Lifecycle & Shutdown integration
function initDesktopAppIntegration(appInstance) {
  if (window.electronAPI && window.electronAPI.isDesktop) {
    const desktopQuitBtn = document.getElementById("btn-desktop-quit");
    if (desktopQuitBtn) {
      desktopQuitBtn.style.display = "inline-flex";
      desktopQuitBtn.addEventListener("click", () => {
        if (appInstance && typeof appInstance.saveCurrentProjectState === "function") {
          appInstance.saveCurrentProjectState();
        }
        window.electronAPI.quitApp();
      });
    }

    // Keyboard shortcut handler for Ctrl+Q / Cmd+Q
    window.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "q" || e.key === "Q")) {
        e.preventDefault();
        if (appInstance && typeof appInstance.saveCurrentProjectState === "function") {
          appInstance.saveCurrentProjectState();
        }
        window.electronAPI.quitApp();
      }
    });
  }
}

// Image error fallbacks, replacing inline onerror handlers (which a Content-Security-Policy forbids).
// `error` does not bubble, so listen in the capture phase.
// - img[data-fallback-name]: swap in the generated initials avatar, once (no loop if that fails too)
// - img[data-hide-on-error]: hide the thumbnail's container
function handleImageError(event) {
  const img = event.target;
  if (!(img instanceof HTMLImageElement)) return;
  if (img.hasAttribute("data-hide-on-error")) {
    if (img.parentElement) img.parentElement.style.display = "none";
    return;
  }
  if (img.hasAttribute("data-fallback-name") && !img.hasAttribute("data-fallback-applied")) {
    img.setAttribute("data-fallback-applied", "");
    const size = parseInt(img.getAttribute("data-fallback-size"), 10) || 512;
    img.src = defaultAvatarUrl(img.getAttribute("data-fallback-name"), size);
  }
}
document.addEventListener("error", handleImageError, true);
