// SpeakerDirectoryApp: CSV/JSON export and import.

Object.assign(SpeakerDirectoryApp.prototype, {
  // --- Import / Export ---
  exportFileName(extension) {
    return `${this.projectTitle.toLowerCase().replace(/\s+/g, "_")}_${new Date().toISOString().slice(0, 10)}.${extension}`;
  },

  /** Triggers a browser download of `content` through a Blob URL (no data: URL, so '#' and size are no issue). */
  downloadFile(content, mimeType, fileName) {
    const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  },

  exportCsv() {
    const headers = ["Full Name", "Title", "Mic Assignment", "Mic Type", "Photo URL", "Notes"];
    const rows = this.speakers.map((s) =>
      [s.fullName || "", s.title || "", s.mic || "", s.micType || "none", s.photo || "", s.notes || ""].map(csvQuote),
    );
    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    this.downloadFile(csvContent, "text/csv;charset=utf-8", this.exportFileName("csv"));
  },

  exportJson() {
    // Project data only; secret-shaped fields can never end up in an export
    const exportData = stripSecretFields({
      projectTitle: this.projectTitle,
      speakers: this.speakers,
      micInventory: this.micInventory,
    });
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData, null, 2));
    const link = document.createElement("a");
    link.setAttribute("href", dataStr);
    link.setAttribute("download", this.exportFileName("json"));
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  },

  importFile(event) {
    const input = event && event.target;
    if (this.isViewOnly) {
      if (input) input.value = "";
      return;
    }
    const file = input && input.files && input.files[0];
    if (!file) return;
    // Reset so choosing the same file again fires another change event
    input.value = "";

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target.result;
      if (file.name.toLowerCase().endsWith(".json")) {
        this.importJsonText(content);
      } else {
        this.importCsvText(content);
      }
    };
    reader.readAsText(file);
  },

  /** Applies imported speakers (and optionally a title and mic inventory) to the active project. */
  applyImport({ speakers, title = null, micInventory = null }, toastMessage) {
    this.speakers = speakers;
    if (title) this.projectTitle = title;
    if (micInventory) this.micInventory = micInventory;
    this.saveCurrentProjectState();
    this.renderTitle();
    this.renderMicDropdown();
    this.render();
    this.closeModal("import-export-modal");
    this.showToast(toastMessage);
  },

  importJsonText(content) {
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      alert("Invalid JSON file format.");
      return;
    }

    let rawSpeakers;
    let title = null;
    let micInventory = null;
    if (Array.isArray(parsed)) {
      rawSpeakers = parsed;
    } else if (parsed && typeof parsed === "object" && Array.isArray(parsed.speakers)) {
      rawSpeakers = parsed.speakers;
      title = cleanText(parsed.projectTitle, FIELD_LIMITS.projectTitle) || null;
      micInventory = normalizeMicInventory(parsed.micInventory);
    } else {
      alert("Invalid JSON file format.");
      return;
    }

    const speakers = normalizeSpeakers(rawSpeakers);
    if (rawSpeakers.length > 0 && speakers.length === 0) {
      alert("No valid speakers found in this file.");
      return;
    }
    this.applyImport({ speakers, title, micInventory }, `Imported ${speakers.length} speakers!`);
  },

  importCsvText(content) {
    // Skip blank lines (rows whose fields are all empty)
    const rows = parseCsv(content)
      .filter((cols) => cols.some((c) => c.trim() !== ""))
      .map((cols) => cols.map(csvUnescapeFormula));
    if (rows.length <= 1) {
      alert("CSV file is empty or missing data rows.");
      return;
    }

    // Row 0 is the header: Full Name,Title,Mic Assignment,Mic Type,Photo URL,Notes
    const stamp = Date.now();
    const rawSpeakers = rows.slice(1).map((cols, i) => ({
      id: `spk-${stamp}-${i + 1}`,
      fullName: cols[0],
      title: (cols[1] || "").trim() || "Guest Speaker",
      mic: (cols[2] || "").trim() || "Unassigned",
      micType: (cols[3] || "").trim() || "lav",
      photo: cols[4],
      notes: cols[5],
    }));
    const speakers = normalizeSpeakers(rawSpeakers);

    if (speakers.length > 0) {
      this.applyImport({ speakers }, `Imported ${speakers.length} speakers from CSV!`);
    } else {
      alert("No valid speakers found in this file.");
    }
  },
});
