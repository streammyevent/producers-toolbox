// SpeakerDirectoryApp: project registry, localStorage helpers, saving and the editable title.

Object.assign(SpeakerDirectoryApp.prototype, {
  // --- Multi-Project Registry Management ---
  getDefaultMicInventory() {
    return [
      { name: "Lav 1 (Channel A)", type: "lav" },
      { name: "Lav 2 (Channel B)", type: "lav" },
      { name: "Lav 3 (Channel C)", type: "lav" },
      { name: "Lav 4 (Channel D)", type: "lav" },
      { name: "Lav 5", type: "lav" },
      { name: "Lav 6", type: "lav" },
      { name: "Handheld 1", type: "handheld" },
      { name: "Handheld 2", type: "handheld" },
      { name: "Handheld 3", type: "handheld" },
      { name: "Handheld 4", type: "handheld" },
      { name: "Catchbox (Audience)", type: "handheld" },
      { name: "Headset 1", type: "headset" },
      { name: "Headset 2", type: "headset" },
      { name: "Headset 3", type: "headset" },
      { name: "Podium Mic", type: "podium" },
      { name: "Panel Table Mic", type: "podium" },
      { name: "Unassigned / Greenroom", type: "none" },
    ];
  },

  /** Normalized copy of the sample speakers (fills in their avatars), so edits never mutate the INITIAL_SPEAKERS seed. */
  getSampleSpeakers() {
    return normalizeSpeakers(INITIAL_SPEAKERS);
  },

  /** Reads and JSON-parses a localStorage key. Returns undefined when it is missing, unreadable or invalid. */
  readStoredJson(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : undefined;
    } catch (e) {
      console.warn(`Ignoring unreadable localStorage entry "${key}":`, e);
      return undefined;
    }
  },

  readStoredString(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },

  writeStorage(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      console.warn(`Could not write localStorage entry "${key}":`, e);
    }
  },

  // Loads the registry from localStorage. Stored data is normalized like an import: corrupted or tampered entries
  // are dropped or repaired, and if nothing usable is left the legacy keys or the sample data are used instead.
  initProjects() {
    const normalizeOptions = { defaultMicInventory: () => this.getDefaultMicInventory() };
    let registry = normalizeProjects(this.readStoredJson(this.registryKey), normalizeOptions);

    if (registry.length === 0) {
      // Migrate from legacy or create initial demo project
      const legacyTitle =
        cleanText(this.readStoredString(this.legacyTitleKey), FIELD_LIMITS.projectTitle) || DEFAULT_PROJECT_TITLE;

      const rawLegacySpeakers = this.readStoredJson(this.legacySpeakersKey);
      const legacySpeakers = Array.isArray(rawLegacySpeakers)
        ? normalizeSpeakers(rawLegacySpeakers)
        : this.getSampleSpeakers();

      const legacyMics = normalizeMicInventory(this.readStoredJson(this.legacyMicKey)) || this.getDefaultMicInventory();

      const defaultProject = {
        id: "proj-" + Date.now(),
        title: legacyTitle,
        speakers: legacySpeakers,
        micInventory: legacyMics,
        lastModified: new Date().toISOString(),
      };

      registry = [defaultProject];
      this.writeStorage(this.registryKey, JSON.stringify(registry));
      this.writeStorage(this.currentProjectIdKey, defaultProject.id);
    }

    this.projectsRegistry = registry;
    const currentId = this.readStoredString(this.currentProjectIdKey);
    let activeProj = this.projectsRegistry.find((p) => p.id === currentId);

    if (!activeProj) {
      activeProj = this.projectsRegistry[0];
      this.writeStorage(this.currentProjectIdKey, activeProj.id);
    }

    this.currentProjectId = activeProj.id;
    this.projectTitle = activeProj.title;
    this.speakers = activeProj.speakers;
    this.micInventory = activeProj.micInventory;
  },

  saveCurrentProjectState() {
    const projIndex = this.projectsRegistry.findIndex((p) => p.id === this.currentProjectId);
    const updatedProj = {
      id: this.currentProjectId,
      title: this.projectTitle,
      speakers: this.speakers,
      micInventory: this.micInventory,
      lastModified: new Date().toISOString(),
    };

    if (projIndex >= 0) {
      this.projectsRegistry[projIndex] = updatedProj;
    } else {
      this.projectsRegistry.push(updatedProj);
    }

    localStorage.setItem(this.registryKey, JSON.stringify(this.projectsRegistry));
    localStorage.setItem(this.currentProjectIdKey, this.currentProjectId);

    // Also sync to fallback keys for compatibility
    localStorage.setItem(this.legacyTitleKey, this.projectTitle);
    localStorage.setItem(this.legacySpeakersKey, JSON.stringify(this.speakers));
    localStorage.setItem(this.legacyMicKey, JSON.stringify(this.micInventory));

    this.flashSaveIndicator();
    if (window.syncController && typeof window.syncController.onProjectSaved === "function") {
      window.syncController.onProjectSaved();
    }
  },

  createNewProject(title) {
    if (this.isViewOnly) return;
    const cleanTitle = cleanText(title, FIELD_LIMITS.projectTitle) || "Untitled Event Directory";
    // Date.now() ids can collide when two projects are made within the same millisecond
    let stamp = Date.now();
    while (this.projectsRegistry.some((p) => p.id === "proj-" + stamp)) stamp++;
    const newProj = {
      id: "proj-" + stamp,
      title: cleanTitle,
      speakers: [],
      micInventory: this.getDefaultMicInventory(),
      lastModified: new Date().toISOString(),
    };

    this.projectsRegistry.unshift(newProj);
    this.openProject(newProj.id);
    this.showToast(`Created new project: "${cleanTitle}"`);
  },

  openProject(projectId) {
    const proj = this.projectsRegistry.find((p) => p.id === projectId);
    if (!proj) return;

    this.currentProjectId = proj.id;
    this.projectTitle = proj.title || "Speaker Photo Directory";
    this.speakers = proj.speakers || [];
    this.micInventory = proj.micInventory || this.getDefaultMicInventory();

    this.saveCurrentProjectState();
    this.renderTitle();
    this.renderMicDropdown();
    this.render();
    this.closeModal("projects-modal");
    this.showToast(`Opened "${this.projectTitle}"`);
  },

  duplicateProject(projectId) {
    if (this.isViewOnly) return;
    const orig = this.projectsRegistry.find((p) => p.id === projectId);
    if (!orig) return;

    let stamp = Date.now();
    while (this.projectsRegistry.some((p) => p.id === "proj-" + stamp)) stamp++;
    const copy = {
      id: "proj-" + stamp,
      title: `${orig.title} (Copy)`,
      speakers: JSON.parse(JSON.stringify(orig.speakers || [])),
      micInventory: JSON.parse(JSON.stringify(orig.micInventory || this.getDefaultMicInventory())),
      lastModified: new Date().toISOString(),
    };

    this.projectsRegistry.unshift(copy);
    localStorage.setItem(this.registryKey, JSON.stringify(this.projectsRegistry));
    this.renderProjectsModalList();
    this.showToast(`Duplicated "${orig.title}"`);
  },

  deleteProject(projectId) {
    if (this.isViewOnly) return;
    if (this.projectsRegistry.length <= 1) {
      alert("You must have at least one project. Create a new project before deleting this one.");
      return;
    }

    const proj = this.projectsRegistry.find((p) => p.id === projectId);
    if (!confirm(`Are you sure you want to permanently delete the project "${proj ? proj.title : ""}"?`)) {
      return;
    }

    this.projectsRegistry = this.projectsRegistry.filter((p) => p.id !== projectId);
    localStorage.setItem(this.registryKey, JSON.stringify(this.projectsRegistry));

    if (this.currentProjectId === projectId) {
      this.openProject(this.projectsRegistry[0].id);
    } else {
      this.renderProjectsModalList();
    }
    this.showToast("Project deleted");
  },

  renderProjectsModalList() {
    const container = document.getElementById("projects-list-container");
    if (!container) return;

    if (this.projectsRegistry.length === 0) {
      container.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 20px;">No saved projects found.</div>`;
      return;
    }

    container.innerHTML = this.projectsRegistry
      .map((p) => {
        const isActive = p.id === this.currentProjectId;
        const count = (p.speakers || []).length;
        const dateStr = p.lastModified
          ? new Date(p.lastModified).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })
          : "Recent";

        return `
        <div class="project-item-card ${isActive ? "active-project" : ""}">
          <div>
            <div class="project-item-title">
              <span>${escapeHtml(p.title)}</span>
              ${isActive ? '<span class="a4-badge" style="background: var(--ok-bg); color: var(--ok-text);">Active</span>' : ""}
            </div>
            <div class="project-item-meta">
              <span>👥 ${count} Speaker${count === 1 ? "" : "s"}</span> • <span>🕒 ${escapeHtml(dateStr)}</span>
            </div>
          </div>
          <div class="project-item-actions">
            ${!isActive ? `<button type="button" class="btn btn-secondary" style="padding: 6px 12px; font-size: 0.8rem;" data-action="open-project" data-id="${escapeHtml(p.id)}">Open</button>` : ""}
            <button type="button" class="btn btn-secondary" style="padding: 6px 10px; font-size: 0.8rem;" data-action="duplicate-project" data-id="${escapeHtml(p.id)}" title="Duplicate / Clone Project">Duplicate</button>
            <button type="button" class="btn btn-danger" style="padding: 6px 10px; font-size: 0.8rem;" data-action="delete-project" data-id="${escapeHtml(p.id)}" title="Delete Project">✕</button>
          </div>
        </div>
      `;
      })
      .join("");

    // Attach project action listeners
    container.querySelectorAll('[data-action="open-project"]').forEach((btn) => {
      btn.addEventListener("click", () => this.openProject(btn.dataset.id));
    });

    container.querySelectorAll('[data-action="duplicate-project"]').forEach((btn) => {
      btn.addEventListener("click", () => this.duplicateProject(btn.dataset.id));
    });

    container.querySelectorAll('[data-action="delete-project"]').forEach((btn) => {
      btn.addEventListener("click", () => this.deleteProject(btn.dataset.id));
    });
  },

  saveProjectTitle(newTitle) {
    if (this.isViewOnly) return;
    this.projectTitle = cleanText(newTitle, FIELD_LIMITS.projectTitle) || DEFAULT_PROJECT_TITLE;
    this.saveCurrentProjectState();
    this.renderTitle();
    this.showToast("Project title updated!");
  },

  renderTitle() {
    const display = document.getElementById("project-title-display");
    const input = document.getElementById("project-title-input");
    const printTitle = document.getElementById("print-project-title");
    const previewSheetTitle = document.getElementById("preview-sheet-title");

    if (display) display.textContent = this.projectTitle;
    if (input) input.value = this.projectTitle;
    if (printTitle) printTitle.textContent = this.projectTitle;
    if (previewSheetTitle) previewSheetTitle.textContent = this.projectTitle;
    document.title = this.projectTitle || "Speaker Photo Directory";
  },

  saveSpeakers() {
    this.saveCurrentProjectState();
  },

  saveMicInventory() {
    if (this.isViewOnly) return;
    this.saveCurrentProjectState();
    this.renderMicDropdown();
    this.renderMicInventoryModal();
    this.render();
    this.showToast("Microphone inventory updated!");
  },

  flashSaveIndicator() {
    const ind = document.getElementById("save-status-indicator");
    if (ind) {
      ind.style.transform = "scale(1.08)";
      ind.style.borderColor = "var(--ok)";
      setTimeout(() => {
        ind.style.transform = "scale(1)";
      }, 300);
    }
  },

  // --- Title Editing ---
  enableTitleEditing() {
    if (this.isViewOnly) return;
    this.projectTitleDisplay.style.display = "none";
    this.projectTitleInput.style.display = "block";
    this.projectTitleInput.value = this.projectTitle;
    this.projectTitleInput.focus();
    this.projectTitleInput.select();
  },

  finishTitleEditing() {
    const val = this.projectTitleInput.value.trim();
    if (val) {
      this.saveProjectTitle(val);
    }
    this.projectTitleInput.style.display = "none";
    this.projectTitleDisplay.style.display = "block";
  },
});
