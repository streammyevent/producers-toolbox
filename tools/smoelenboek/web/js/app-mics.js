// SpeakerDirectoryApp: mic inventory, the mic dropdown and the quick mic switcher.

Object.assign(SpeakerDirectoryApp.prototype, {
  // --- Global Mic Inventory Management ---
  renderMicDropdown() {
    const categories = [
      { id: "lav", label: "Lavalier / Lapel" },
      { id: "handheld", label: "Handheld" },
      { id: "headset", label: "Headset / Earset" },
      { id: "podium", label: "Podium / Fixed" },
      { id: "none", label: "Unassigned" },
    ];

    let html = "";
    categories.forEach((cat) => {
      const mics = this.micInventory.filter((m) => m.type === cat.id);
      if (mics.length > 0) {
        html += `<optgroup label="${escapeHtml(cat.label)}">`;
        // The value keeps the historical "name|type" form, but the form reads the exact name and type back from
        // the data- attributes, so a name containing "|" still round-trips.
        mics.forEach((m) => {
          html += `<option value="${escapeHtml(`${m.name}|${m.type}`)}" data-mic-name="${escapeHtml(m.name)}" data-mic-type="${escapeHtml(m.type)}">${escapeHtml(m.name)}</option>`;
        });
        html += `</optgroup>`;
      }
    });

    html += `<option value="custom">-- Custom Mic Entry --</option>`;
    this.formMicPreset.innerHTML = html;
  },

  openMicManagerModal() {
    this.renderMicInventoryModal();
    this.openModal("mics-manager-modal");
  },

  renderMicInventoryModal() {
    const categories = [
      { id: "lav", label: "Lavalier / Lapel Mics" },
      { id: "handheld", label: "Handheld Mics" },
      { id: "headset", label: "Headset / Earset Mics" },
      { id: "podium", label: "Podium & Table Mics" },
      { id: "none", label: "Unassigned / Other" },
    ];

    let html = "";
    categories.forEach((cat) => {
      const mics = this.micInventory.filter((m) => m.type === cat.id);
      html += `
        <div class="mic-inventory-section">
          <div class="mic-inventory-category-title">
            <span style="display:inline-block; width:10px; height:10px; border-radius:50%; background: ${this.getMicColor(cat.id)};"></span>
            ${cat.label} (${mics.length})
          </div>
          <div class="mic-chips-list">
            ${mics.length === 0 ? '<span style="color:var(--text-muted); font-size:0.8rem;">No mics in this category</span>' : ""}
            ${mics
              .map(
                (m) => `
              <div class="mic-chip-item">
                <span>${escapeHtml(m.name)}</span>
                <button type="button" class="mic-chip-delete" title="Delete ${escapeHtml(m.name)}" data-mic-name="${escapeHtml(m.name)}">✕</button>
              </div>
            `,
              )
              .join("")}
          </div>
        </div>
      `;
    });

    this.micInventoryContainer.innerHTML = html;

    // Delete chip listeners
    this.micInventoryContainer.querySelectorAll(".mic-chip-delete").forEach((btn) => {
      btn.addEventListener("click", () => {
        const name = btn.dataset.micName;
        this.micInventory = this.micInventory.filter((m) => m.name !== name);
        this.saveMicInventory();
      });
    });
  },

  handleAddNewMic() {
    if (this.isViewOnly) return;
    const name = cleanText(this.newMicName.value, FIELD_LIMITS.mic);
    const type = safeMicType(this.newMicType.value);
    if (!name) {
      alert("Please enter a microphone name or channel number.");
      return;
    }

    if (this.micInventory.some((m) => m.name.toLowerCase() === name.toLowerCase())) {
      alert("A microphone with this name already exists in inventory.");
      return;
    }

    this.micInventory.push({ name, type });
    this.newMicName.value = "";
    this.saveMicInventory();
  },

  // --- Quick Mic Switcher Menu ---
  showQuickMicMenu(event, speakerId) {
    if (this.isViewOnly) return;
    const spk = this.speakers.find((s) => s.id === speakerId);
    if (!spk) return;

    const rect = event.currentTarget.getBoundingClientRect();
    this.quickMicMenu.style.top = `${rect.bottom + window.scrollY + 6}px`;
    this.quickMicMenu.style.left = `${Math.min(rect.left + window.scrollX, window.innerWidth - 240)}px`;

    this.quickMicMenu.innerHTML = `
      <div style="font-size: 0.75rem; font-weight: 700; color: var(--text-muted); padding: 4px 8px; text-transform: uppercase;">
        Switch Mic for ${escapeHtml(spk.fullName.split(" ")[0])}
      </div>
      ${this.micInventory
        .map(
          (m) => `
        <div class="mic-picker-item" data-mic="${escapeHtml(m.name)}" data-type="${escapeHtml(m.type)}">
          <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background: ${this.getMicColor(m.type)};"></span>
          <span>${escapeHtml(m.name)}</span>
        </div>
      `,
        )
        .join("")}
    `;

    this.quickMicMenu.style.display = "block";

    this.quickMicMenu.querySelectorAll(".mic-picker-item").forEach((item) => {
      item.addEventListener("click", () => {
        spk.mic = item.dataset.mic;
        spk.micType = safeMicType(item.dataset.type);
        this.saveSpeakers();
        this.quickMicMenu.style.display = "none";
        this.render();
        this.showToast(`Assigned ${spk.mic} to ${spk.fullName.split(" ")[0]}`);
      });
    });
  },

  getMicColor(type) {
    switch (type) {
      case "lav":
        return "var(--mic-lav)";
      case "handheld":
        return "var(--mic-handheld)";
      case "headset":
        return "var(--mic-headset)";
      case "podium":
        return "var(--mic-podium)";
      default:
        return "var(--mic-none)";
    }
  },
});
