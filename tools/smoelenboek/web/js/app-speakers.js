// SpeakerDirectoryApp: speaker grid (filtering, rendering, reordering), the speaker modal and removal.

Object.assign(SpeakerDirectoryApp.prototype, {
  resetToSampleData() {
    if (this.isViewOnly) return;
    if (confirm("Reset this project directory to default sample speakers?")) {
      this.speakers = this.getSampleSpeakers();
      this.saveSpeakers();
      this.render();
      this.showToast("Reset to default speakers");
    }
  },

  // --- Speaker Reordering Mode (Explicit Toggle & Drag / Click) ---
  toggleReorderMode(forceState = null) {
    if (this.isViewOnly) return;
    this.isReorderMode = forceState !== null ? forceState : !this.isReorderMode;
    document.body.classList.toggle("reorder-mode", this.isReorderMode);

    if (this.btnToggleReorder) {
      this.btnToggleReorder.classList.toggle("active", this.isReorderMode);
      if (this.reorderBtnText) {
        this.reorderBtnText.textContent = this.isReorderMode ? "✓ Done Reordering" : "⇄ Reorder";
      }
    }

    // If entering reorder mode and active filter/search is restricting results, reset to "all" to allow complete sequencing
    if (this.isReorderMode && (this.activeFilter !== "all" || this.searchQuery)) {
      this.activeFilter = "all";
      this.searchQuery = "";
      this.searchInput.value = "";
      this.clearSearchBtn.style.display = "none";
      this.filterPills.forEach((p) => p.classList.remove("active"));
      const allPill = document.querySelector('.filter-pill[data-filter="all"]');
      if (allPill) allPill.classList.add("active");
    }

    this.render();
    if (this.isReorderMode) {
      this.showToast("Reorder mode active: Drag boxes or use ▲ / ▼.");
    } else {
      this.showToast("Speaker sequence saved!");
    }
  },

  moveSpeaker(speakerId, direction) {
    if (this.isViewOnly) return;
    const index = this.speakers.findIndex((s) => s.id === speakerId);
    if (index === -1) return;

    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= this.speakers.length) return;

    const [moved] = this.speakers.splice(index, 1);
    this.speakers.splice(newIndex, 0, moved);

    this.saveSpeakers();
    this.render();
    this.showToast(`Moved #${index + 1} ${moved.fullName.split(" ")[0]} ➔ #${newIndex + 1}`);
  },

  reorderSpeakers(sourceId, targetId) {
    if (this.isViewOnly) return;
    if (!sourceId || !targetId || sourceId === targetId) return;

    const sourceIndex = this.speakers.findIndex((s) => s.id === sourceId);
    const targetIndex = this.speakers.findIndex((s) => s.id === targetId);

    if (sourceIndex === -1 || targetIndex === -1) return;

    const [dragged] = this.speakers.splice(sourceIndex, 1);
    this.speakers.splice(targetIndex, 0, dragged);

    this.saveSpeakers();
    this.render();
    this.showToast(`Moved ${dragged.fullName.split(" ")[0]} to position #${targetIndex + 1}`);
  },

  // --- Rendering ---
  getFilteredSpeakers() {
    return this.speakers.filter((spk) => {
      // Filter by mic type
      if (this.activeFilter !== "all") {
        if (this.activeFilter === "none") {
          if (spk.micType && spk.micType !== "none") return false;
        } else if (spk.micType !== this.activeFilter) {
          return false;
        }
      }

      // Filter by search query
      if (this.searchQuery) {
        const full = `${spk.fullName} ${spk.title} ${spk.mic} ${spk.notes || ""}`.toLowerCase();
        if (!full.includes(this.searchQuery)) {
          return false;
        }
      }

      return true;
    });
  },

  updateFilterCounts() {
    const counts = {
      all: this.speakers.length,
      lav: 0,
      handheld: 0,
      headset: 0,
      podium: 0,
      none: 0,
    };

    this.speakers.forEach((spk) => {
      const type = spk.micType || "none";
      if (counts[type] !== undefined) {
        counts[type]++;
      } else {
        counts.none++;
      }
    });

    document.getElementById("count-all").textContent = counts.all;
    document.getElementById("count-lav").textContent = counts.lav;
    document.getElementById("count-handheld").textContent = counts.handheld;
    document.getElementById("count-headset").textContent = counts.headset;
    document.getElementById("count-podium").textContent = counts.podium;
    document.getElementById("count-none").textContent = counts.none;
  },

  render() {
    this.updateFilterCounts();
    const filtered = this.getFilteredSpeakers();
    this.speakerCountEl.textContent = `${filtered.length} Speaker${filtered.length === 1 ? "" : "s"}`;

    if (filtered.length === 0) {
      this.container.innerHTML = `
        <div class="empty-state">
          <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="8" y1="12" x2="16" y2="12"></line>
          </svg>
          <h3 class="empty-state-title">No speakers found</h3>
          <p class="empty-state-desc">Try clearing your search query or mic filter to see all speaker profiles.</p>
          <button type="button" class="btn btn-primary" data-action="clear-filters">Show All Speakers</button>
        </div>
      `;
      return;
    }

    this.container.innerHTML = filtered.map((spk, idx) => this.renderSpeakerCard(spk, idx, filtered.length)).join("");
    this.attachCardEventListeners();
  },

  renderSpeakerCard(spk, index, total) {
    // Every user-provided value is escaped; the mic type is allowlisted because it becomes a class name.
    const micClass = `mic-${safeMicType(spk.micType)}`;
    const photoUrl = safeUrl(spk.photo, { allowData: true }) || defaultAvatarUrl(spk.fullName);
    const isDraggable = !this.isViewOnly && this.isReorderMode;
    const id = escapeHtml(spk.id);
    const name = escapeHtml(spk.fullName);

    return `
      <div class="speaker-card" data-id="${id}" ${isDraggable ? 'draggable="true"' : 'draggable="false"'} title="${this.isReorderMode ? "Drag box to reorder speaker position" : ""}">
        <div class="card-photo-wrapper">
          <img src="${escapeHtml(photoUrl)}" alt="${name}" class="speaker-img" data-fallback-name="${name}" data-fallback-size="512">
          
          <!-- Order Badge (Shown when Reordering) -->
          <div class="card-order-badge" title="Run sheet position #${index + 1}">
            #${index + 1}
          </div>

          <!-- Drag Handle Badge (Shown when Reordering) -->
          <div class="drag-handle-badge" title="Drag box to reorder">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/>
              <circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/>
            </svg>
            <span>Drag</span>
          </div>

          <!-- Photo Edit & Search overlay actions (Hidden in Reorder Mode) -->
          <div class="photo-overlay-actions">
            <button class="overlay-btn btn-photo-lookup" title="Search / Change Photo" data-action="lookup-photo" data-id="${id}" data-name="${name}">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
            </button>
            <button class="overlay-btn" title="Edit Profile" data-action="edit" data-id="${id}">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
              </svg>
            </button>
          </div>

          <div class="mic-badge-overlay">
            <div class="mic-badge ${micClass}" data-action="quick-mic" data-id="${id}" title="${this.isViewOnly ? escapeHtml(spk.mic) : "Click to quickly switch mic (75% Glass Style)"}">
              <svg class="mic-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                <line x1="12" x2="12" y1="19" y2="22"/>
              </svg>
              <span>${escapeHtml(spk.mic || "Unassigned")}</span>
            </div>
          </div>
        </div>

        <div class="card-content">
          <h3 class="speaker-name">${name}</h3>
          <p class="speaker-title">${escapeHtml(spk.title)}</p>
          
          <div class="card-footer">
            ${spk.notes ? `<span class="card-notes" title="${escapeHtml(spk.notes)}">📝 ${escapeHtml(spk.notes)}</span>` : '<span class="card-notes"></span>'}
            
            <!-- Move Arrows (Shown when Reordering) -->
            <div class="reorder-arrows">
              <button type="button" class="btn-move" data-action="move-up" data-id="${id}" title="Move speaker earlier (#${index})" ${index === 0 ? 'disabled style="opacity:0.3; cursor:not-allowed;"' : ""}>▲</button>
              <button type="button" class="btn-move" data-action="move-down" data-id="${id}" title="Move speaker later (#${index + 2})" ${index === total - 1 ? 'disabled style="opacity:0.3; cursor:not-allowed;"' : ""}>▼</button>
            </div>

            <div class="card-action-btns">
              <button class="card-action-btn" data-action="edit" data-id="${id}" title="Edit Speaker">
                Edit
              </button>
              <button class="card-action-btn" data-action="delete" data-id="${id}" title="Delete Speaker" style="color: var(--danger);">
                ✕
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  },

  attachCardEventListeners() {
    if (this.isViewOnly) return;

    // Quick photo lookup from card
    this.container.querySelectorAll('[data-action="lookup-photo"]').forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const name = btn.dataset.name;
        this.activeTargetSpeakerIdForPhoto = id;
        this.openPhotoLookupModal(name);
      });
    });

    // Edit from card
    this.container.querySelectorAll('[data-action="edit"]').forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        this.openSpeakerModal(id);
      });
    });

    // Delete from card
    this.container.querySelectorAll('[data-action="delete"]').forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        this.deleteSpeaker(id);
      });
    });

    // Quick Mic Switcher on Badge Click
    this.container.querySelectorAll('[data-action="quick-mic"]').forEach((badge) => {
      badge.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = badge.dataset.id;
        this.showQuickMicMenu(e, id);
      });
    });

    // Move Up & Down quick buttons (when in reorder mode)
    if (this.isReorderMode) {
      this.container.querySelectorAll('[data-action="move-up"]').forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.moveSpeaker(btn.dataset.id, -1);
        });
      });

      this.container.querySelectorAll('[data-action="move-down"]').forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.moveSpeaker(btn.dataset.id, 1);
        });
      });

      // Drag and Drop event listeners on cards
      const cards = this.container.querySelectorAll(".speaker-card");
      cards.forEach((card) => {
        card.addEventListener("dragstart", (e) => {
          this.draggedSpeakerId = card.dataset.id;
          card.classList.add("dragging");
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", card.dataset.id);
        });

        card.addEventListener("dragend", () => {
          card.classList.remove("dragging");
          cards.forEach((c) => c.classList.remove("drag-over"));
        });

        card.addEventListener("dragover", (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          if (card.dataset.id !== this.draggedSpeakerId) {
            card.classList.add("drag-over");
          }
        });

        card.addEventListener("dragleave", () => {
          card.classList.remove("drag-over");
        });

        card.addEventListener("drop", (e) => {
          e.preventDefault();
          card.classList.remove("drag-over");
          const targetId = card.dataset.id;
          if (this.draggedSpeakerId && targetId && this.draggedSpeakerId !== targetId) {
            this.reorderSpeakers(this.draggedSpeakerId, targetId);
          }
        });
      });
    }
  },

  clearSearchAndFilters() {
    this.searchInput.value = "";
    this.searchQuery = "";
    this.clearSearchBtn.style.display = "none";
    this.activeFilter = "all";
    this.filterPills.forEach((p) => p.classList.remove("active"));
    document.querySelector('.filter-pill[data-filter="all"]').classList.add("active");
    this.render();
  },

  // --- Speaker Modal CRUD ---
  openSpeakerModal(speakerId = null) {
    if (this.isViewOnly) return;
    this.currentEditingId = speakerId;
    this.renderMicDropdown();

    if (speakerId) {
      const spk = this.speakers.find((s) => s.id === speakerId);
      if (!spk) return;
      this.modalTitle.textContent = "Edit Speaker Profile";
      this.editSpeakerId.value = spk.id;
      this.formFullName.value = spk.fullName;
      this.formTitle.value = spk.title;
      this.formNotes.value = spk.notes || "";
      const photo = safeUrl(spk.photo, { allowData: true }) || defaultAvatarUrl(spk.fullName);
      this.formPhotoUrl.value = photo;
      this.formPhotoPreview.src = photo;

      // Match preset or set custom
      const matchedOption = Array.from(this.formMicPreset.options).find((opt) => opt.dataset.micName === spk.mic);
      if (matchedOption) {
        matchedOption.selected = true;
        this.customMicContainer.style.display = "none";
      } else {
        this.formMicPreset.value = "custom";
        this.formMicCustom.value = spk.mic;
        this.customMicContainer.style.display = "block";
      }
    } else {
      this.modalTitle.textContent = "Add Speaker Profile";
      this.speakerForm.reset();
      this.editSpeakerId.value = "";
      this.formPhotoUrl.value = "";
      this.formPhotoPreview.src = defaultAvatarUrl("");
      this.customMicContainer.style.display = "none";
      if (this.formMicPreset.options.length > 0) {
        this.formMicPreset.selectedIndex = 0;
      }
    }

    this.debounceSuggestPhotos();
    this.openModal("speaker-modal");
  },

  handleFormSubmit() {
    if (this.isViewOnly) return;
    let id = this.editSpeakerId.value;
    if (!id) {
      // Date.now() ids can collide when two speakers are added within the same millisecond
      let stamp = Date.now();
      while (this.speakers.some((s) => s.id === "spk-" + stamp)) stamp++;
      id = "spk-" + stamp;
    }

    let mic;
    let micType;

    const selected = this.formMicPreset.selectedOptions[0];
    if (!selected || this.formMicPreset.value === "custom") {
      mic = this.formMicCustom.value.trim() || "Custom Mic";
      micType = "lav";
    } else {
      mic = selected.dataset.micName ?? "";
      micType = selected.dataset.micType || "none";
    }

    // Same normalization as imports: trims, caps lengths, allowlists the mic type and the photo URL scheme
    const speakerData = normalizeSpeaker({
      id,
      fullName: this.formFullName.value,
      title: this.formTitle.value,
      mic,
      micType,
      photo: this.formPhotoUrl.value,
      notes: this.formNotes.value,
    });
    if (!speakerData) {
      alert("Please enter the speaker's full name.");
      return;
    }
    const { fullName } = speakerData;

    const existingIndex = this.speakers.findIndex((s) => s.id === id);
    if (existingIndex >= 0) {
      this.speakers[existingIndex] = speakerData;
      this.showToast(`Updated ${fullName}`);
    } else {
      this.speakers.unshift(speakerData);
      this.showToast(`Added ${fullName}`);
    }

    this.saveSpeakers();
    this.closeModal("speaker-modal");
    this.render();
  },

  deleteSpeaker(id) {
    if (this.isViewOnly) return;
    const spk = this.speakers.find((s) => s.id === id);
    if (confirm(`Remove "${spk ? spk.fullName : "this speaker"}" from directory?`)) {
      this.speakers = this.speakers.filter((s) => s.id !== id);
      this.saveSpeakers();
      this.render();
      this.showToast("Speaker deleted");
    }
  },

  // --- Remove All Speakers Logic ---
  openRemoveAllModal() {
    const count = (this.speakers || []).length;
    if (count === 0) {
      this.showToast("Directory is already empty.");
      return;
    }
    if (this.removeAllCountDisplay) {
      this.removeAllCountDisplay.textContent = count === 1 ? "1 speaker" : count + " speakers";
    }
    this.openModal("remove-all-modal");
  },

  confirmRemoveAll() {
    if (this.isViewOnly) return;
    const count = (this.speakers || []).length;
    this.speakers = [];
    this.saveCurrentProjectState();
    this.render();
    this.closeModal("remove-all-modal");
    this.showToast("Removed all " + count + " speakers");
  },
});
