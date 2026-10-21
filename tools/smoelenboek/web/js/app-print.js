// SpeakerDirectoryApp: A4 print customizer, live preview and printing.

Object.assign(SpeakerDirectoryApp.prototype, {
  // --- Standard A4 Print Customizer, Live Resize Preview & Execution ---
  renderPrintPreview() {
    if (!this.printPreviewGrid) return;

    const cols = this.selectedPrintCols;
    const isLandscape = this.selectedPrintOrientation === "landscape";
    const showMics = this.printToggleMics ? this.printToggleMics.checked : true;
    const showNotes = this.printToggleNotes ? this.printToggleNotes.checked : true;

    if (this.printSheetPaper) {
      this.printSheetPaper.className = `print-sheet-paper orientation-${this.selectedPrintOrientation}`;
    }

    if (this.previewPaperHeaderTitle) {
      this.previewPaperHeaderTitle.textContent = isLandscape
        ? "📑 Live Standard A4 Landscape Paper Preview"
        : "📄 Live Standard A4 Portrait Paper Preview";
    }

    if (this.previewSheetSub) {
      this.previewSheetSub.textContent = `Front of House (FOH) & Stage Audio Microphone Run Sheet • Standard A4 ${isLandscape ? "Landscape" : "Portrait"}`;
    }

    this.printPreviewGrid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    if (this.previewPageEstimate) {
      const count = this.speakers.length;
      let cardsPerPage = isLandscape ? cols * 3 : cols * 4;
      let estPages = Math.ceil(count / Math.max(1, cardsPerPage));
      this.previewPageEstimate.textContent = `A4 ${isLandscape ? "Landscape" : "Portrait"} • ${cols} Columns per row • Est. ${estPages} Page${estPages === 1 ? "" : "s"}`;
    }

    const previewSheetTitle = document.getElementById("preview-sheet-title");
    if (previewSheetTitle) previewSheetTitle.textContent = this.projectTitle;

    this.printPreviewGrid.innerHTML = this.speakers
      .map(
        (spk) => `
      <div class="print-preview-card">
        <img src="${escapeHtml(safeUrl(spk.photo, { allowData: true }) || defaultAvatarUrl(spk.fullName, 200))}" alt="${escapeHtml(spk.fullName)}" class="print-preview-card-img" data-fallback-name="${escapeHtml(spk.fullName)}" data-fallback-size="200">
        <div class="print-preview-card-name">${escapeHtml(spk.fullName)}</div>
        <div class="print-preview-card-title">${escapeHtml(spk.title)}</div>
        ${showMics ? `<div class="print-preview-card-mic">🎙️ ${escapeHtml(spk.mic || "Unassigned")}</div>` : ""}
        ${showNotes && spk.notes ? `<div class="print-preview-card-notes">📝 ${escapeHtml(spk.notes)}</div>` : ""}
      </div>
    `,
      )
      .join("");
  },

  executePrint() {
    const isLandscape = this.selectedPrintOrientation === "landscape";

    // Inject dynamic @page rule for clean borderless margin
    let styleEl = document.getElementById("dynamic-print-page-style");
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = "dynamic-print-page-style";
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = `@page { size: A4 ${isLandscape ? "landscape" : "portrait"}; margin: 8mm; }`;

    document.body.classList.remove("print-cols-2", "print-cols-3", "print-cols-4", "print-cols-5", "print-cols-6");
    document.body.classList.add(`print-cols-${this.selectedPrintCols}`);

    document.body.classList.toggle("print-orientation-landscape", isLandscape);
    document.body.classList.toggle("print-orientation-portrait", !isLandscape);

    if (this.printToggleTitle && !this.printToggleTitle.checked) {
      document.body.classList.add("print-hide-title");
    } else {
      document.body.classList.remove("print-hide-title");
    }

    if (this.printToggleNotes && !this.printToggleNotes.checked) {
      document.body.classList.add("print-hide-notes");
    } else {
      document.body.classList.remove("print-hide-notes");
    }

    if (this.printToggleMics && !this.printToggleMics.checked) {
      document.body.classList.add("print-hide-mics");
    } else {
      document.body.classList.remove("print-hide-mics");
    }

    // Set clean document title for print header
    const origTitle = document.title;
    document.title = this.projectTitle || "Speaker Photo Directory";

    this.closeModal("print-modal");
    setTimeout(() => {
      window.print();
      setTimeout(() => {
        document.title = origTitle;
      }, 1000);
    }, 250);
  },
});
