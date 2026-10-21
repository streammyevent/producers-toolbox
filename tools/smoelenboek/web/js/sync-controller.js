// --- Backup folder controller (the "Backup folder" modal and the top-bar pill) ---

const SYNC_UNSUPPORTED =
  "Backup folders need the desktop app, or Chrome or Edge opened from this computer (file:// or localhost).";

class SyncFolderController {
  constructor(appInstance) {
    this.app = appInstance;
    this.service = window.syncFolderService;
    this.autoSyncTimeout = null;
    this.syncing = false;

    this.initElements();
    this.attachEventListeners();
    this.updateUI();
    // The folder status is async (IPC / IndexedDB): render again once it is known
    this.service.refresh().then(() => this.updateUI());
  }

  initElements() {
    this.btnMenu = document.getElementById("btn-sync-menu");
    this.btnLabel = document.getElementById("sync-btn-label");
    this.statusDot = document.getElementById("sync-status-dot");

    this.unsupportedNote = document.getElementById("sync-unsupported-note");
    this.folderLabel = document.getElementById("sync-folder-label");
    this.folderPath = document.getElementById("sync-folder-path");
    this.folderStatus = document.getElementById("sync-folder-status");
    this.btnChoose = document.getElementById("btn-sync-choose-folder");
    this.btnReconnect = document.getElementById("btn-sync-reconnect");
    this.btnForget = document.getElementById("btn-sync-forget-folder");
    this.btnReveal = document.getElementById("btn-sync-reveal-folder");

    this.actionsSection = document.getElementById("sync-actions-section");
    this.restoreSection = document.getElementById("sync-restore-section");
    this.btnSyncNow = document.getElementById("btn-sync-now");
    this.btnExportCsv = document.getElementById("btn-sync-export-csv");
    this.autoSyncToggle = document.getElementById("sync-autosync-toggle");
    this.lastSyncLabel = document.getElementById("sync-last-sync-label");
    this.btnRefreshBackups = document.getElementById("btn-sync-refresh-backups");
    this.backupsContainer = document.getElementById("sync-backups-container");
  }

  attachEventListeners() {
    this.btnMenu?.addEventListener("click", async () => {
      this.app.openModal("sync-modal");
      this.updateUI();
      await this.service.refresh();
      this.updateUI();
      this.refreshBackupsList();
    });

    this.btnChoose?.addEventListener("click", async () => {
      try {
        this.btnChoose.disabled = true;
        if (!(await this.service.choose())) return;
        this.app.showToast(`Backup folder: "${this.service.folder.name}"`);
        this.updateUI();
        this.refreshBackupsList();
      } catch (err) {
        alert("Could not use this folder: " + syncErrorMessage(err));
      } finally {
        this.btnChoose.disabled = false;
        this.updateUI();
      }
    });

    this.btnReconnect?.addEventListener("click", async () => {
      try {
        await this.service.reconnect();
        if (this.service.isReady) this.app.showToast("Backup folder reconnected");
      } catch (err) {
        alert("Could not reconnect the folder: " + syncErrorMessage(err));
      }
      this.updateUI();
      this.refreshBackupsList();
    });

    this.btnForget?.addEventListener("click", async () => {
      if (!confirm("Forget this backup folder? The files in it are kept.")) return;
      await this.service.clear();
      this.app.showToast("Backup folder forgotten");
      this.updateUI();
      this.refreshBackupsList();
    });

    this.btnReveal?.addEventListener("click", () => {
      this.service.reveal().catch((err) => alert("Could not open the folder: " + syncErrorMessage(err)));
    });

    this.btnSyncNow?.addEventListener("click", () => this.syncCurrentProject(true));
    this.btnExportCsv?.addEventListener("click", () => this.exportCsv());
    this.btnRefreshBackups?.addEventListener("click", () => this.refreshBackupsList());

    this.autoSyncToggle?.addEventListener("change", (e) => {
      if (!this.service.supported) {
        e.target.checked = false;
        return;
      }
      this.service.setAutoSync(e.target.checked);
      this.app.showToast(e.target.checked ? "Auto-backup on save enabled" : "Auto-backup disabled");
    });

    this.backupsContainer?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn || !this.backupsContainer.contains(btn)) return;
      if (btn.dataset.action === "restore-backup") this.restoreBackup(btn);
      if (btn.dataset.action === "reveal-backup") {
        this.service.reveal(btn.dataset.file).catch((err) => alert(syncErrorMessage(err)));
      }
    });
  }

  updateUI() {
    const { supported } = this.service;
    const folder = this.service.folder;
    const ready = supported && folder.state === "ready";

    if (this.unsupportedNote) this.unsupportedNote.hidden = supported;
    [this.btnChoose, this.btnSyncNow, this.btnExportCsv, this.autoSyncToggle, this.btnRefreshBackups].forEach((el) => {
      if (el) el.disabled = !supported || (el !== this.btnChoose && !ready) || (el === this.btnSyncNow && this.syncing);
    });
    if (this.btnReconnect) this.btnReconnect.hidden = !(supported && folder.state === "needsPermission");
    if (this.btnForget) this.btnForget.hidden = !(supported && folder.state !== "none");
    if (this.btnReveal) this.btnReveal.hidden = !(ready && this.service.canReveal);
    if (this.btnChoose) this.btnChoose.textContent = folder.state === "none" ? "Choose folder…" : "Change folder…";
    if (this.autoSyncToggle) this.autoSyncToggle.checked = supported && this.service.config.autoSync;
    this.actionsSection?.classList.toggle("sync-disabled", !ready);
    this.restoreSection?.classList.toggle("sync-disabled", !ready);

    const describe = {
      none: ["Choose a folder to start backing up", "sync-dot-off"],
      ready: ["Ready", "sync-dot-ok"],
      needsPermission: ["The browser needs your permission again", "sync-dot-warn"],
      unavailable: ["Folder not found (is Google Drive running?)", "sync-dot-warn"],
    };
    const [statusText, dotClass] = supported
      ? describe[folder.state] || describe.none
      : [SYNC_UNSUPPORTED, "sync-dot-off"];

    if (this.folderLabel) this.folderLabel.textContent = folder.name || "No folder chosen";
    if (this.folderPath) {
      this.folderPath.textContent = folder.path;
      this.folderPath.hidden = !folder.path;
    }
    if (this.folderStatus) this.folderStatus.textContent = statusText;

    if (this.statusDot) {
      this.statusDot.className = `sync-dot ${this.syncing ? "sync-dot-syncing" : dotClass}`;
      this.statusDot.title = statusText;
    }
    if (this.btnMenu) this.btnMenu.title = supported ? `Backup folder: ${statusText}` : SYNC_UNSUPPORTED;
    if (this.btnLabel) {
      const name = folder.name.length > 16 ? folder.name.slice(0, 15) + "…" : folder.name;
      this.btnLabel.textContent = !supported ? "Backups (desktop app)" : ready ? `Backups: ${name}` : "Backup folder";
    }
    if (this.lastSyncLabel) {
      const last = this.service.config.lastSyncTime;
      this.lastSyncLabel.textContent = last
        ? `Last backup: ${new Date(last).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
        : "Last backup: never";
    }
  }

  /** The active project as stored in the registry (falls back to the live fields). */
  activeProject() {
    return (
      this.app.projectsRegistry.find((p) => p.id === this.app.currentProjectId) || {
        id: this.app.currentProjectId,
        title: this.app.projectTitle,
        speakers: this.app.speakers,
        micInventory: this.app.micInventory,
      }
    );
  }

  async syncCurrentProject(showNotification = false) {
    if (!this.service.isReady) {
      if (showNotification) alert("Choose a backup folder first.");
      return;
    }
    const project = this.activeProject();
    const fileName = syncFileName("Backup", project.title, "json");
    // Only the project's own fields, and never anything secret-shaped
    const payload = JSON.stringify(
      stripSecretFields({
        schemaVersion: "speaker-directory-v1",
        exportedAt: new Date().toISOString(),
        project: {
          id: project.id,
          title: project.title,
          speakers: project.speakers,
          micInventory: project.micInventory,
          lastModified: project.lastModified,
        },
      }),
      null,
      2,
    );

    try {
      this.syncing = true;
      this.updateUI();
      await this.service.write(fileName, payload);
      this.service.markSynced();
      if (showNotification) this.app.showToast(`Saved "${fileName}" to the backup folder`);
      this.refreshBackupsList();
    } catch (err) {
      console.error("Backup error:", err);
      if (showNotification) alert("Backup failed: " + syncErrorMessage(err));
      // The folder may have gone away (Drive stopped, permission revoked): show that
      await this.service.refresh();
    } finally {
      this.syncing = false;
      this.updateUI();
    }
  }

  async exportCsv() {
    if (!this.service.isReady) {
      alert("Choose a backup folder first.");
      return;
    }
    const fileName = syncFileName("RunSheet", this.app.projectTitle, "csv");
    let csv = "Full Name,Job Title,Microphone,Mic Type,Photo URL,Stage Notes\n";
    (this.app.speakers || []).forEach((s) => {
      csv += [s.fullName, s.title, s.mic, s.micType || "lav", s.photo, s.notes].map(csvQuote).join(",") + "\n";
    });

    try {
      if (this.btnExportCsv) this.btnExportCsv.disabled = true;
      await this.service.write(fileName, csv);
      this.app.showToast(`Saved "${fileName}" to the backup folder`);
      this.refreshBackupsList();
    } catch (err) {
      alert("CSV export failed: " + syncErrorMessage(err));
    } finally {
      this.updateUI();
    }
  }

  message(text, tone = "muted") {
    const color = tone === "danger" ? "var(--danger)" : "var(--text-muted)";
    return `<div style="text-align: center; color: ${color}; font-size: 0.825rem; padding: 10px;">${escapeHtml(text)}</div>`;
  }

  async refreshBackupsList() {
    if (!this.backupsContainer) return;
    if (!this.service.isReady) {
      this.backupsContainer.innerHTML = this.message(
        this.service.supported ? "Choose a backup folder to see its backups." : SYNC_UNSUPPORTED,
      );
      return;
    }
    try {
      this.backupsContainer.innerHTML = this.message("Loading backups...");
      const files = await this.service.list();
      if (files.length === 0) {
        this.backupsContainer.innerHTML = this.message("No backups in this folder yet. Click 'Back up now' above.");
        return;
      }

      const reveal = this.service.canReveal;
      this.backupsContainer.innerHTML = files
        .map((f) => {
          const name = String(f.name ?? "");
          const isJson = name.endsWith(".json");
          const date = new Date(f.modifiedTime);
          const dateStr = isNaN(date)
            ? ""
            : date.toLocaleDateString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

          return `
          <div class="sync-backup-item">
            <div>
              <div style="font-weight: 600; color: var(--text-primary);">${isJson ? "📄" : "📊"} ${escapeHtml(name)}</div>
              <div style="font-size: 0.75rem; color: var(--text-muted);">🕒 ${escapeHtml(dateStr)}</div>
            </div>
            <div style="display: flex; gap: 6px;">
              ${isJson ? `<button type="button" class="btn btn-secondary" style="padding: 4px 10px; font-size: 0.775rem;" data-action="restore-backup" data-file="${escapeHtml(name)}">Restore</button>` : ""}
              ${reveal ? `<button type="button" class="btn btn-secondary" style="padding: 4px 8px; font-size: 0.775rem;" data-action="reveal-backup" data-file="${escapeHtml(name)}" title="Show in folder">↗</button>` : ""}
            </div>
          </div>
        `;
        })
        .join("");
    } catch (err) {
      this.backupsContainer.innerHTML = this.message("Failed to load backups: " + syncErrorMessage(err), "danger");
    }
  }

  async restoreBackup(btn) {
    if (this.app.isViewOnly) {
      alert("Restoring is not available in view-only mode.");
      return;
    }
    if (!confirm("Restore this project from the backup folder? Your active workspace will load this backup.")) return;
    try {
      btn.disabled = true;
      btn.textContent = "Restoring...";
      const parsed = JSON.parse(await this.service.read(btn.dataset.file));
      const p =
        parsed && typeof parsed === "object"
          ? normalizeProject(parsed.project, { defaultMicInventory: () => this.app.getDefaultMicInventory() })
          : null;
      if (!p) {
        alert("Unsupported backup format.");
        return;
      }
      this.app.projectTitle = p.title;
      this.app.speakers = p.speakers;
      this.app.micInventory = p.micInventory;
      this.app.saveCurrentProjectState();
      this.app.renderTitle();
      this.app.renderMicDropdown();
      this.app.render();
      this.app.closeModal("sync-modal");
      this.app.showToast(`Restored "${p.title}" from the backup folder`);
    } catch (e) {
      alert("Failed to restore backup: " + syncErrorMessage(e));
    } finally {
      btn.disabled = false;
      btn.textContent = "Restore";
    }
  }

  onProjectSaved() {
    if (!this.service.config.autoSync || !this.service.isReady) return;
    if (this.autoSyncTimeout) clearTimeout(this.autoSyncTimeout);
    this.autoSyncTimeout = setTimeout(() => this.syncCurrentProject(false), 3000);
  }
}
