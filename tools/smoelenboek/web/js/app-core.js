// SpeakerDirectoryApp core: the class, its constructor, element lookup, event wiring, toasts and modals.
// The other app-*.js files add the remaining methods to SpeakerDirectoryApp.prototype (prototype mixins).

// Google Custom Search engine id (CX). Not a secret, so it stays in localStorage; the API key is in SecretStore.
const GSEARCH_CX_KEY = "spd_gsearch_cx_id";

// Speaker Photo Directory & Mic Manager App

class SpeakerDirectoryApp {
  constructor() {
    this.registryKey = "speaker_projects_registry_v1";
    this.currentProjectIdKey = "speaker_current_project_id_v1";

    // Legacy fallback keys
    this.legacySpeakersKey = "speaker_photo_directory_v1";
    this.legacyMicKey = "speaker_mic_inventory_v1";
    this.legacyTitleKey = "speaker_project_title_v1";

    this.isViewOnly = this.checkViewOnlyMode();
    this.isReorderMode = false;
    this.activeFilter = "all";
    this.searchQuery = "";
    this.currentEditingId = null;
    this.activeTargetSpeakerIdForPhoto = null;
    this.cameraStream = null;
    this.selectedPrintCols = 4;
    this.selectedPrintOrientation = "portrait";
    this.draggedSpeakerId = null;

    this.uiMode = localStorage.getItem("spd_ui_mode") || "basic";
    this.initProjects();
    this.initElements();
    this.initUiMode();
    this.initGoogleSearchGuide();
    this.attachEventListeners();
    this.renderMicDropdown();
    this.renderTitle();
    this.render();
  }

  checkViewOnlyMode() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get("view") === "readonly" || urlParams.get("mode") === "view";
  }

  showToast(message) {
    const container = document.getElementById("toast-container");
    if (!container) return;
    const toast = document.createElement("div");
    toast.className = "toast-msg";
    // Built with textContent: messages often contain user text (names, project titles, Drive file names).
    const icon = document.createElement("span");
    icon.textContent = "✓";
    const text = document.createElement("span");
    text.textContent = String(message ?? "");
    toast.append(icon, " ", text);
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(10px)";
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  }

  initElements() {
    // Check view-only
    if (this.isViewOnly) {
      document.body.classList.add("view-only");
    }

    // Containers
    this.container = document.getElementById("speakers-container");
    this.searchInput = document.getElementById("search-input");
    this.clearSearchBtn = document.getElementById("clear-search-btn");
    this.speakerCountEl = document.getElementById("speaker-count");
    this.filterPills = document.querySelectorAll(".filter-pill");

    // Title Elements
    this.projectTitleDisplay = document.getElementById("project-title-display");
    this.projectTitleInput = document.getElementById("project-title-input");
    this.btnEditTitle = document.getElementById("btn-edit-title");

    // Modals
    this.speakerModal = document.getElementById("speaker-modal");
    this.photoLookupModal = document.getElementById("photo-lookup-modal");
    this.micsManagerModal = document.getElementById("mics-manager-modal");
    this.importExportModal = document.getElementById("import-export-modal");
    this.shareModal = document.getElementById("share-modal");
    this.printModal = document.getElementById("print-modal");
    this.projectsModal = document.getElementById("projects-modal");
    this.quickMicMenu = document.getElementById("quick-mic-menu");

    // Projects Manager Elements
    this.btnProjectsMenu = document.getElementById("btn-projects-menu");
    this.btnCreateNewProject = document.getElementById("btn-create-new-project");
    this.newProjectTitleInput = document.getElementById("new-project-title-input");
    this.projectsListContainer = document.getElementById("projects-list-container");

    // Reorder Mode Elements
    this.btnToggleReorder = document.getElementById("btn-toggle-reorder");
    this.btnDoneReorder = document.getElementById("btn-done-reorder");
    this.reorderBtnText = document.getElementById("reorder-btn-text");

    // Share Elements
    this.shareLinkUrl = document.getElementById("share-link-url");
    this.btnCopyShareLink = document.getElementById("btn-copy-share-link");
    this.shareLinkNote = document.getElementById("share-link-note");

    // Print Customizer Elements
    this.btnOpenPrintModal = document.getElementById("btn-open-print-modal");
    this.btnExecutePrint = document.getElementById("btn-execute-print");
    this.printOrientationBtns = document.querySelectorAll(".print-orientation-btn");
    this.printDensityBtns = document.querySelectorAll(".print-density-btn");
    this.btnDensity6 = document.getElementById("btn-density-6");
    this.printToggleTitle = document.getElementById("print-toggle-title");
    this.printToggleMics = document.getElementById("print-toggle-mics");
    this.printToggleNotes = document.getElementById("print-toggle-notes");
    this.printPreviewGrid = document.getElementById("print-preview-grid");
    this.printSheetPaper = document.getElementById("print-sheet-paper");
    this.previewPaperHeaderTitle = document.getElementById("preview-paper-header-title");
    this.previewSheetSub = document.getElementById("preview-sheet-sub");
    this.previewPageEstimate = document.getElementById("preview-page-estimate");

    // Forms & Inputs
    this.speakerForm = document.getElementById("speaker-form");
    this.editSpeakerId = document.getElementById("edit-speaker-id");
    this.formFullName = document.getElementById("form-fullname");
    this.formTitle = document.getElementById("form-title");
    this.formMicPreset = document.getElementById("form-mic-preset");
    this.formMicCustom = document.getElementById("form-mic-custom");
    this.customMicContainer = document.getElementById("custom-mic-container");
    this.formNotes = document.getElementById("form-notes");
    this.formPhotoUrl = document.getElementById("form-photo-url");
    this.formPhotoPreview = document.getElementById("form-photo-preview");
    this.modalTitle = document.getElementById("modal-title");

    // Photo Lookup Elements
    this.onlineSearchInput = document.getElementById("online-search-input");
    this.btnExecuteSearch = document.getElementById("btn-execute-search");
    this.onlineSearchResults = document.getElementById("online-search-results");
    this.pasteUrlInput = document.getElementById("paste-url-input");
    this.btnPreviewUrl = document.getElementById("btn-preview-url");
    this.quickUrlInput = document.getElementById("quick-url-input");
    this.btnQuickUrlApply = document.getElementById("btn-quick-url-apply");
    this.btnPasteClipboard = document.getElementById("btn-paste-clipboard");
    this.dropzoneBox = document.getElementById("dropzone-box");
    this.fileUploadInput = document.getElementById("file-upload-input");
    this.linkGoogleImages = document.getElementById("link-google-images");
    this.linkBingImages = document.getElementById("link-bing-images");
    this.linkLinkedinSearch = document.getElementById("link-linkedin-search");
    this.btnClearPhotoSearch = document.getElementById("btn-clear-photo-search");
    this.gsearchApiKey = document.getElementById("gsearch-api-key");
    this.gsearchCxId = document.getElementById("gsearch-cx-id");
    this.btnSaveGsearchKeys = document.getElementById("btn-save-gsearch-keys");
    this.photoFilterChips = document.querySelectorAll(".photo-filter-chip");
    this.activePhotoFilter = "all";
    this.suggestedPhotosContainer = document.getElementById("suggested-photos-container");
    this.suggestedPhotosStrip = document.getElementById("suggested-photos-strip");
    this.suggestedPhotosSource = document.getElementById("suggested-photos-source");
    this.btnOpenGoogleTab = document.getElementById("btn-open-google-tab");

    // Mode Switch & Remove All Elements
    this.toggleModeSwitch = document.getElementById("toggle-mode-switch");
    this.modeLabelBasic = document.getElementById("mode-label-basic");
    this.modeLabelAdv = document.getElementById("mode-label-adv");
    this.btnRemoveAllSpeakers = document.getElementById("btn-remove-all-speakers");
    this.removeAllModal = document.getElementById("remove-all-modal");
    this.removeAllCountDisplay = document.getElementById("remove-all-count-display");
    this.btnConfirmRemoveAll = document.getElementById("btn-confirm-remove-all");

    // Google Search Guide & API Setup Elements
    this.toggleGoogleGuideBtn = document.getElementById("toggle-google-guide-btn");
    this.googleGuideContent = document.getElementById("google-guide-content");
    this.googleGuideArrow = document.getElementById("google-guide-arrow");
    this.gsearchApiStatus = document.getElementById("gsearch-api-status");

    // Camera
    this.cameraVideo = document.getElementById("camera-video");
    this.cameraCanvas = document.getElementById("camera-canvas");
    this.btnStartCamera = document.getElementById("btn-start-camera");
    this.btnSnapCamera = document.getElementById("btn-snap-camera");

    // Header Actions
    this.btnSaveNow = document.getElementById("btn-save-now");
    this.btnAddSpeaker = document.getElementById("btn-add-speaker");
    this.btnManageMics = document.getElementById("btn-manage-mics");
    this.btnShareLink = document.getElementById("btn-share-link");
    this.btnImportExport = document.getElementById("btn-import-export");
    this.btnResetData = document.getElementById("btn-reset-data");

    // Mic Manager Modal Elements
    this.micInventoryContainer = document.getElementById("mic-inventory-container");
    this.newMicName = document.getElementById("new-mic-name");
    this.newMicType = document.getElementById("new-mic-type");
    this.btnAddNewMic = document.getElementById("btn-add-new-mic");
    this.btnResetMics = document.getElementById("btn-reset-mics");

    // Import/Export
    this.btnExportCsv = document.getElementById("btn-export-csv");
    this.btnExportJson = document.getElementById("btn-export-json");
    this.importFileInput = document.getElementById("import-file-input");
  }

  attachEventListeners() {
    // Basic / Advanced Mode Switch
    if (this.toggleModeSwitch) {
      this.toggleModeSwitch.addEventListener("change", (e) => {
        this.setUiMode(e.target.checked ? "advanced" : "basic");
      });
    }
    if (this.modeLabelBasic) {
      this.modeLabelBasic.addEventListener("click", () => {
        this.setUiMode("basic");
      });
    }
    if (this.modeLabelAdv) {
      this.modeLabelAdv.addEventListener("click", () => {
        this.setUiMode("advanced");
      });
    }

    // Remove All Speakers Button
    if (this.btnRemoveAllSpeakers) {
      this.btnRemoveAllSpeakers.addEventListener("click", () => {
        this.openRemoveAllModal();
      });
    }
    if (this.btnConfirmRemoveAll) {
      this.btnConfirmRemoveAll.addEventListener("click", () => {
        this.confirmRemoveAll();
      });
    }
    // Editable Project Title
    if (this.projectTitleDisplay) {
      this.projectTitleDisplay.addEventListener("click", () => this.enableTitleEditing());
    }
    if (this.btnEditTitle) {
      this.btnEditTitle.addEventListener("click", () => this.enableTitleEditing());
    }
    if (this.projectTitleInput) {
      this.projectTitleInput.addEventListener("blur", () => this.finishTitleEditing());
      this.projectTitleInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this.finishTitleEditing();
        } else if (e.key === "Escape") {
          this.projectTitleInput.style.display = "none";
          this.projectTitleDisplay.style.display = "block";
        }
      });
    }

    // Projects Manager Actions
    if (this.btnProjectsMenu) {
      this.btnProjectsMenu.addEventListener("click", () => {
        this.renderProjectsModalList();
        this.openModal("projects-modal");
      });
    }

    if (this.btnCreateNewProject) {
      this.btnCreateNewProject.addEventListener("click", () => {
        const title = this.newProjectTitleInput.value.trim();
        this.createNewProject(title);
        this.newProjectTitleInput.value = "";
      });
    }

    if (this.newProjectTitleInput) {
      this.newProjectTitleInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          const title = this.newProjectTitleInput.value.trim();
          this.createNewProject(title);
          this.newProjectTitleInput.value = "";
        }
      });
    }

    // Reorder Mode Toggle Buttons
    if (this.btnToggleReorder) {
      this.btnToggleReorder.addEventListener("click", () => this.toggleReorderMode());
    }
    if (this.btnDoneReorder) {
      this.btnDoneReorder.addEventListener("click", () => this.toggleReorderMode(false));
    }

    // Delegated actions inside the speakers grid that must also work in view-only mode
    this.container.addEventListener("click", (e) => {
      if (e.target.closest('[data-action="clear-filters"]')) this.clearSearchAndFilters();
    });

    // Search
    this.searchInput.addEventListener("input", (e) => {
      this.searchQuery = e.target.value.trim().toLowerCase();
      this.clearSearchBtn.style.display = this.searchQuery ? "block" : "none";
      this.render();
    });

    this.clearSearchBtn.addEventListener("click", () => {
      this.searchInput.value = "";
      this.searchQuery = "";
      this.clearSearchBtn.style.display = "none";
      this.searchInput.focus();
      this.render();
    });

    // Filters
    this.filterPills.forEach((pill) => {
      pill.addEventListener("click", () => {
        this.filterPills.forEach((p) => p.classList.remove("active"));
        pill.classList.add("active");
        this.activeFilter = pill.dataset.filter;
        this.render();
      });
    });

    // Manual Save / Backup button
    if (this.btnSaveNow) {
      this.btnSaveNow.addEventListener("click", () => {
        this.saveCurrentProjectState();
        this.showToast("Project saved successfully!");
      });
    }

    // Share Link Button: opens the Share modal with the view-only link of this page
    if (this.btnShareLink) {
      this.btnShareLink.addEventListener("click", () => this.openShareModal());
    }
    if (this.btnCopyShareLink) {
      this.btnCopyShareLink.addEventListener("click", () => this.copyShareLink());
    }

    // Print Modal & Customizer
    if (this.btnOpenPrintModal) {
      this.btnOpenPrintModal.addEventListener("click", () => {
        this.renderPrintPreview();
        this.openModal("print-modal");
      });
    }
    if (this.btnExecutePrint) {
      this.btnExecutePrint.addEventListener("click", () => this.executePrint());
    }

    this.printOrientationBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        this.printOrientationBtns.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        this.selectedPrintOrientation = btn.dataset.orientation || "portrait";

        if (this.selectedPrintOrientation === "landscape") {
          if (this.btnDensity6) this.btnDensity6.style.display = "flex";
          // Default to 5 columns in landscape if currently 4
          if (this.selectedPrintCols === 4) {
            this.selectedPrintCols = 5;
            this.printDensityBtns.forEach((b) => b.classList.toggle("active", b.dataset.cols === "5"));
          }
        } else {
          if (this.btnDensity6) this.btnDensity6.style.display = "none";
          // Reset to 4 columns if currently 6 in portrait
          if (this.selectedPrintCols === 6) {
            this.selectedPrintCols = 4;
            this.printDensityBtns.forEach((b) => b.classList.toggle("active", b.dataset.cols === "4"));
          }
        }
        this.renderPrintPreview();
      });
    });

    this.printDensityBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        this.printDensityBtns.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        this.selectedPrintCols = parseInt(btn.dataset.cols, 10) || 4;
        this.renderPrintPreview();
      });
    });

    if (this.printToggleMics) {
      this.printToggleMics.addEventListener("change", () => this.renderPrintPreview());
    }
    if (this.printToggleNotes) {
      this.printToggleNotes.addEventListener("change", () => this.renderPrintPreview());
    }

    // Add Speaker button
    if (this.btnAddSpeaker) {
      this.btnAddSpeaker.addEventListener("click", () => {
        this.openSpeakerModal();
      });
    }

    // Manage Mics button
    if (this.btnManageMics) {
      this.btnManageMics.addEventListener("click", () => {
        this.openMicManagerModal();
      });
    }

    // Reset Data
    if (this.btnResetData) {
      this.btnResetData.addEventListener("click", () => this.resetToSampleData());
    }

    // Import / Export
    if (this.btnImportExport) {
      this.btnImportExport.addEventListener("click", () => {
        this.openModal("import-export-modal");
      });
    }

    this.btnExportCsv.addEventListener("click", () => this.exportCsv());
    this.btnExportJson.addEventListener("click", () => this.exportJson());
    this.importFileInput.addEventListener("change", (e) => this.importFile(e));

    // Speaker Form Submit
    this.speakerForm.addEventListener("submit", (e) => {
      e.preventDefault();
      this.handleFormSubmit();
    });

    // Mic Preset selector change
    // Live inline headshot candidate suggestions when typing name or title
    this.formFullName.addEventListener("input", () => {
      this.debounceSuggestPhotos();
    });
    this.formTitle.addEventListener("input", () => {
      this.debounceSuggestPhotos();
    });
    this.formMicPreset.addEventListener("change", (e) => {
      if (e.target.value === "custom") {
        this.customMicContainer.style.display = "block";
        this.formMicCustom.required = true;
        this.formMicCustom.focus();
      } else {
        this.customMicContainer.style.display = "none";
        this.formMicCustom.required = false;
      }
    });

    // Photo Lookup Modal Trigger inside Speaker Form
    document.getElementById("btn-open-photo-lookup").addEventListener("click", () => {
      const name = this.formFullName.value.trim();
      this.activeTargetSpeakerIdForPhoto = "form";
      this.openPhotoLookupModal(name);
    });

    // Modal Close Buttons
    document.querySelectorAll("[data-close], [data-modal], .modal-close").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const modalId = btn.dataset.close || btn.dataset.modal || btn.closest(".modal-backdrop")?.id;
        if (modalId) {
          this.closeModal(modalId);
        }
      });
    });

    // Close modals on backdrop click
    document.querySelectorAll(".modal-backdrop").forEach((modal) => {
      modal.addEventListener("click", (e) => {
        if (e.target === modal) {
          this.closeModal(modal.id);
        }
      });
    });

    // Photo Tabs Switcher
    document.querySelectorAll(".photo-tab-btn").forEach((tabBtn) => {
      tabBtn.addEventListener("click", () => {
        document.querySelectorAll(".photo-tab-btn").forEach((b) => b.classList.remove("active"));
        document.querySelectorAll(".photo-tab-panel").forEach((p) => p.classList.remove("active"));
        tabBtn.classList.add("active");
        const panel = document.getElementById(tabBtn.dataset.tab);
        if (panel) panel.classList.add("active");
      });
    });

    // Online Photo Search Input and button
    this.btnExecuteSearch.addEventListener("click", () => this.executeOnlineSearch());
    this.onlineSearchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.executeOnlineSearch();
      }
    });
    this.onlineSearchInput.addEventListener("input", (e) => {
      const val = e.target.value;
      if (this.btnClearPhotoSearch) {
        this.btnClearPhotoSearch.style.display = val ? "block" : "none";
      }
      this.updateSearchExternalLinks(val.trim());
    });

    // Clear photo search
    if (this.btnClearPhotoSearch) {
      this.btnClearPhotoSearch.addEventListener("click", () => {
        this.onlineSearchInput.value = "";
        this.btnClearPhotoSearch.style.display = "none";
        this.executeOnlineSearch("");
      });
    }

    // Photo Category Filter Chips
    if (this.photoFilterChips) {
      this.photoFilterChips.forEach((chip) => {
        chip.addEventListener("click", () => {
          this.photoFilterChips.forEach((c) => c.classList.remove("active"));
          chip.classList.add("active");
          this.activePhotoFilter = chip.dataset.filter || "all";
          this.executeOnlineSearch();
        });
      });
    }

    // (The Google Search API key "Save" button is wired once, in initGoogleSearchGuide.)

    // Quick URL Apply in Search Tab
    this.btnQuickUrlApply.addEventListener("click", () => {
      const url = this.quickUrlInput.value.trim();
      if (url) {
        this.selectPhoto(url);
      }
    });

    // Paste Image URL in Tab 3
    this.btnPreviewUrl.addEventListener("click", () => {
      const url = this.pasteUrlInput.value.trim();
      if (url) {
        this.selectPhoto(url);
      }
    });

    // Clipboard Paste Button
    this.btnPasteClipboard.addEventListener("click", () => this.readFromClipboard());

    // Global Paste Listener (Ctrl+V anywhere in photo modal or page)
    document.addEventListener("paste", (e) => this.handleGlobalPaste(e));

    // File Upload & Drag and Drop
    this.fileUploadInput.addEventListener("change", (e) => {
      this.handleFileUpload(e.target.files[0]);
      e.target.value = ""; // allow choosing the same file again
    });

    this.dropzoneBox.addEventListener("dragover", (e) => {
      e.preventDefault();
      this.dropzoneBox.classList.add("dragover");
    });
    this.dropzoneBox.addEventListener("dragleave", () => {
      this.dropzoneBox.classList.remove("dragover");
    });
    this.dropzoneBox.addEventListener("drop", (e) => {
      e.preventDefault();
      this.dropzoneBox.classList.remove("dragover");
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        this.handleFileUpload(e.dataTransfer.files[0]);
      }
    });

    // Camera WebCam
    this.btnStartCamera.addEventListener("click", () => this.startCamera());
    this.btnSnapCamera.addEventListener("click", () => this.snapCameraPhoto());

    // Mic Inventory Manager Actions
    this.btnAddNewMic.addEventListener("click", () => this.handleAddNewMic());
    this.btnResetMics.addEventListener("click", () => {
      if (this.isViewOnly) return;
      if (confirm("Reset microphone inventory list to default?")) {
        this.micInventory = this.getDefaultMicInventory();
        this.saveMicInventory();
      }
    });

    // Document click to close quick mic menu
    document.addEventListener("click", (e) => {
      if (!e.target.closest("#quick-mic-menu") && !e.target.closest(".mic-badge")) {
        this.quickMicMenu.style.display = "none";
      }
    });
  }

  // --- Share View-Only Mode ---
  openShareModal() {
    // Only an http(s) page has an address others can open. From file:// (or the desktop app) the note explains
    // that the LAN share script has to serve the app first.
    const { protocol, origin, pathname } = window.location;
    const shareable = protocol === "http:" || protocol === "https:";
    this.shareLinkUrl.value = shareable ? `${origin}${pathname}?view=readonly` : "";
    if (this.shareLinkNote) this.shareLinkNote.hidden = shareable;
    if (this.btnCopyShareLink) this.btnCopyShareLink.disabled = !shareable;
    this.openModal("share-modal");
  }

  copyShareLink() {
    if (!this.shareLinkUrl.value) return;
    this.shareLinkUrl.select();
    navigator.clipboard
      .writeText(this.shareLinkUrl.value)
      .then(() => {
        this.showToast("View-only link copied to clipboard!");
      })
      .catch(() => {
        document.execCommand("copy");
        this.showToast("View-only link copied!");
      });
  }

  // --- Modal Helpers ---
  openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.add("active");
  }

  closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.remove("active");
      if (modalId === "photo-lookup-modal") {
        this.stopCamera();
      }
    }
  }
}
