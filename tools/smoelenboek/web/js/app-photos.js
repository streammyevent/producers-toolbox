// SpeakerDirectoryApp: photo lookup (Wikipedia/Commons, Google search), clipboard, upload, camera.

Object.assign(SpeakerDirectoryApp.prototype, {
  // --- Photo Lookup, LinkedIn & Google Images Engine ---
  debounceSuggestPhotos() {
    clearTimeout(this._suggestTimer);
    this._suggestTimer = setTimeout(() => {
      const name = this.formFullName.value.trim();
      const title = this.formTitle.value.trim();
      this.updateInlineSuggestedPhotos(name, title);
    }, 200);
  },

  async updateInlineSuggestedPhotos(name, title) {
    if (!this.suggestedPhotosContainer || !this.suggestedPhotosStrip) return;

    const query = name || title;
    if (!query || query.length < 2) {
      this.suggestedPhotosContainer.style.display = "none";
      return;
    }

    this.suggestedPhotosContainer.style.display = "block";
    if (this.suggestedPhotosSource) {
      this.suggestedPhotosSource.textContent = name ? `Matching "${name}"` : "Smart Match";
    }

    const suggestions = [];
    const seen = new Set();
    const currentPhoto = this.formPhotoUrl.value;

    const addSug = (item) => {
      const url = item ? safeUrl(item.url) : "";
      if (url && !seen.has(url)) {
        seen.add(url);
        suggestions.push({ ...item, url });
      }
    };

    // 1. Check Wikipedia in background if query looks like a full name
    if (name && name.length >= 3) {
      try {
        const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(name)}&gsrlimit=3&prop=pageimages&pithumbsize=400&format=json&origin=*`;
        const res = await fetch(wikiUrl);
        const data = await res.json();
        if (data && data.query && data.query.pages) {
          Object.values(data.query.pages).forEach((page) => {
            if (page.thumbnail && page.thumbnail.source && !page.thumbnail.source.endsWith(".svg.png")) {
              addSug({
                label: page.title,
                url: page.thumbnail.source,
                source: "Wikipedia",
              });
            }
          });
        }
      } catch {
        // silent fail
      }
    }

    // 2. Monogram avatar
    if (name) {
      addSug({ label: `Avatar (${name})`, url: defaultAvatarUrl(name), source: "Avatar" });
    }

    if (suggestions.length === 0) {
      this.suggestedPhotosContainer.style.display = "none";
      return;
    }

    this.suggestedPhotosStrip.innerHTML = suggestions
      .slice(0, 6)
      .map(
        (item) => `
      <div class="suggested-thumb-item ${item.url === currentPhoto ? "active" : ""}" data-url="${escapeHtml(item.url)}" title="${escapeHtml(item.label)} (${escapeHtml(item.source)})">
        <img src="${escapeHtml(item.url)}" alt="${escapeHtml(item.label)}" loading="lazy" data-hide-on-error>
      </div>
    `,
      )
      .join("");

    this.suggestedPhotosStrip.querySelectorAll(".suggested-thumb-item").forEach((thumb) => {
      thumb.addEventListener("click", () => {
        this.suggestedPhotosStrip
          .querySelectorAll(".suggested-thumb-item")
          .forEach((t) => t.classList.remove("active"));
        thumb.classList.add("active");
        const url = thumb.dataset.url;
        this.formPhotoUrl.value = url;
        this.formPhotoPreview.src = url;
      });
    });
  },

  openPhotoLookupModal(speakerName = "") {
    this.onlineSearchInput.value = speakerName;
    if (this.btnClearPhotoSearch) {
      this.btnClearPhotoSearch.style.display = speakerName ? "block" : "none";
    }
    this.updateSearchExternalLinks(speakerName);
    this.openModal("photo-lookup-modal");
    if (speakerName) {
      this.executeOnlineSearch(speakerName);
    } else {
      this.onlineSearchResults.innerHTML = `
        <div style="grid-column: 1/-1; padding: 48px 20px; text-align: center; color: var(--text-secondary);">
          <div style="font-size: 2.2rem; margin-bottom: 10px;">&#128269;</div>
          <div style="font-size: 1rem; font-weight: 600; color: var(--text-primary); margin-bottom: 6px;">Search Google & Web Images</div>
          <div style="font-size: 0.825rem; color: var(--text-muted); max-width: 440px; margin: 0 auto 16px auto;">
            Enter the speaker's name above to search for genuine online photos, or click <strong>Google Images Search</strong> to browse and copy/paste directly.
          </div>
        </div>
      `;
    }
  },

  updateSearchExternalLinks(query) {
    const cleanQ = query.trim() || "conference speaker";
    const q = encodeURIComponent(cleanQ);

    // Direct Google Images search
    if (this.linkGoogleImages) {
      this.linkGoogleImages.href = `https://www.google.com/search?tbm=isch&q=${q}+speaker+portrait`;
    }
    // Direct Bing Images search
    if (this.linkBingImages) {
      this.linkBingImages.href = `https://www.bing.com/images/search?q=${q}+portrait`;
    }
    // Targeted LinkedIn Profile Search & Headshots
    if (this.linkLinkedinSearch) {
      this.linkLinkedinSearch.href = `https://www.google.com/search?tbm=isch&q=${q}+site:linkedin.com/in/+profile+photo`;
    }
  },

  async executeOnlineSearch(queryOverride = null) {
    const rawInput = queryOverride !== null ? queryOverride : this.onlineSearchInput.value;
    const query = rawInput && rawInput.trim() ? rawInput.trim() : "";
    this.updateSearchExternalLinks(query || "speaker");

    if (!query) {
      this.openPhotoLookupModal("");
      return;
    }

    this.onlineSearchResults.innerHTML = `
      <div style="grid-column: 1/-1; padding: 40px 20px; text-align: center; color: var(--text-secondary);">
        <div style="font-size: 1.1rem; margin-bottom: 6px;">&#128269; Searching Google & Web Images for "<strong>${escapeHtml(query)}</strong>"...</div>
        <div style="font-size: 0.8rem; color: var(--text-muted);">Fetching real photos without filler content</div>
      </div>
    `;

    const fetchedPhotos = [];
    const seenUrls = new Set();

    const addPhoto = (item) => {
      const url = item ? safeUrl(item.url) : "";
      if (url && !seenUrls.has(url)) {
        seenUrls.add(url);
        fetchedPhotos.push({ ...item, url });
      }
    };

    const networkPromises = [];

    // 1. Google Custom Search Engine (desktop app with a saved key: the key comes from the encrypted SecretStore, the
    //    non-secret engine id from localStorage). Without a key the Wikipedia/Commons sources below still run.
    const gKey = SecretStore.get(SECRET_NAMES.gsearchApiKey);
    const gCx = localStorage.getItem(GSEARCH_CX_KEY);
    if (gKey && gCx) {
      networkPromises.push(
        (async () => {
          try {
            const gSearchUrl = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(gKey)}&cx=${encodeURIComponent(gCx)}&q=${encodeURIComponent(query + " portrait speaker headshot")}&searchType=image&num=10&imgSize=medium`;
            const res = await fetch(gSearchUrl);
            const gData = await res.json();
            if (gData && gData.error) {
              console.warn("Google Custom Search API Error:", gData.error);
              if (this.gsearchApiStatus) {
                this.gsearchApiStatus.innerHTML = `<span style="color: var(--danger);">⚠️ Google Error: ${escapeHtml(gData.error.message || "Please enable Custom Search API in Google Cloud Console")}</span> <a href="https://console.cloud.google.com/apis/library/customsearch.googleapis.com" target="_blank" style="color: var(--link); text-decoration: underline; margin-left: 6px;">Click here to Enable API</a>`;
              }
            } else if (gData && gData.items) {
              const results = [];
              gData.items.forEach((item) => {
                if (item.link && (item.link.startsWith("http://") || item.link.startsWith("https://"))) {
                  results.push({
                    label: item.title || query,
                    url: item.link,
                    badge: "Google",
                    badgeClass: "badge-google",
                  });
                }
              });
              return results;
            }
          } catch (err) {
            console.warn("Google CSE search error:", err);
          }
          return [];
        })(),
      );
    }

    // 2. Wikipedia PageImages API (Real biographical encyclopedia photo of this exact person)
    networkPromises.push(
      (async () => {
        try {
          const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrlimit=8&prop=pageimages&pithumbsize=600&format=json&origin=*`;
          const res = await fetch(wikiUrl);
          const data = await res.json();
          if (data && data.query && data.query.pages) {
            const results = [];
            Object.values(data.query.pages).forEach((page) => {
              if (page.thumbnail && page.thumbnail.source) {
                const src = page.thumbnail.source;
                if (!src.endsWith(".svg") && !src.endsWith(".svg.png")) {
                  results.push({
                    label: page.title,
                    url: src,
                    badge: "Wikipedia",
                    badgeClass: "badge-wiki",
                  });
                }
              }
            });
            return results;
          }
        } catch (err) {
          console.warn("Wikipedia search error:", err);
        }
        return [];
      })(),
    );

    // 3. Wikimedia Commons Image Search (Real public photos & portraits of this person)
    networkPromises.push(
      (async () => {
        try {
          const commonsUrl = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrsearch=${encodeURIComponent(query + " portrait")}&gsrlimit=8&prop=imageinfo&iiprop=url&iiurlwidth=600&format=json&origin=*`;
          const res = await fetch(commonsUrl);
          const data = await res.json();
          if (data && data.query && data.query.pages) {
            const results = [];
            Object.values(data.query.pages).forEach((page) => {
              if (page.imageinfo && page.imageinfo[0]) {
                const info = page.imageinfo[0];
                const url = info.thumburl || info.url;
                if (url && !url.endsWith(".pdf.jpg") && !url.endsWith(".svg.png") && !url.endsWith(".ogg.jpg")) {
                  const cleanTitle = page.title
                    .replace(/^File:/i, "")
                    .replace(/\.[^/.]+$/, "")
                    .replace(/[_-]/g, " ");
                  results.push({
                    label: cleanTitle.slice(0, 30),
                    url: url,
                    badge: "Commons",
                    badgeClass: "badge-wiki",
                  });
                }
              }
            });
            return results;
          }
        } catch (err) {
          console.warn("Wikimedia Commons search error:", err);
        }
        return [];
      })(),
    );

    const settled = await Promise.allSettled(networkPromises);
    settled.forEach((outcome) => {
      if (outcome.status === "fulfilled" && Array.isArray(outcome.value)) {
        outcome.value.forEach((item) => addPhoto(item));
      }
    });

    if (fetchedPhotos.length === 0) {
      const gUrl = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query + " speaker portrait")}`;
      const lUrl = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query + " site:linkedin.com/in/+profile+photo")}`;

      this.onlineSearchResults.innerHTML = `
        <div style="grid-column: 1/-1; padding: 40px 20px; text-align: center; color: var(--text-secondary);">
          <div style="font-size: 2rem; margin-bottom: 10px;">&#128269;</div>
          <div style="font-weight: 600; font-size: 1rem; color: var(--text-primary); margin-bottom: 6px;">No exact photos found for "${escapeHtml(query)}"</div>
          <div style="font-size: 0.825rem; color: var(--text-muted); max-width: 440px; margin: 0 auto 16px auto;">
            Open Google Images in 1 click, right-click and copy any image address, then press <kbd style="background: var(--surface-2); border: 1px solid var(--border); padding: 1px 6px; border-radius: 4px;">Ctrl+V</kbd> to paste it here.
          </div>
          <div style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
            <a href="${escapeHtml(gUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-primary" style="font-size: 0.825rem; text-decoration: none;">
              &#128269; Open "${escapeHtml(query)}" on Google Images
            </a>
            <a href="${escapeHtml(lUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary" style="font-size: 0.825rem; text-decoration: none;">
              &#128188; Search on LinkedIn
            </a>
          </div>
        </div>
      `;
      return;
    }

    // Render results without any filler
    this.onlineSearchResults.innerHTML = fetchedPhotos
      .map(
        (item) => `
      <div class="photo-result-item" data-url="${escapeHtml(item.url)}" title="${escapeHtml(item.label)}">
        <span class="photo-source-badge ${escapeHtml(item.badgeClass || "")}">${escapeHtml(item.badge || "Photo")}</span>
        <img src="${escapeHtml(item.url)}" alt="${escapeHtml(item.label)}" loading="lazy" data-hide-on-error>
        <div class="photo-result-label">${escapeHtml(item.label)}</div>
      </div>
    `,
      )
      .join("");

    this.onlineSearchResults.querySelectorAll(".photo-result-item").forEach((item) => {
      item.addEventListener("click", () => {
        this.selectPhoto(item.dataset.url);
      });
    });
  },

  // --- Clipboard & Paste Helpers ---
  async readFromClipboard() {
    try {
      if (!navigator.clipboard) {
        alert("Please press Ctrl+V to paste the image.");
        return;
      }

      // Check for image items in clipboard
      const items = await navigator.clipboard.read();
      for (const item of items) {
        for (const type of item.types) {
          if (type.startsWith("image/")) {
            const blob = await item.getType(type);
            this.handleFileUpload(blob);
            return;
          }
        }
      }

      // If text URL in clipboard
      const text = await navigator.clipboard.readText();
      if (text && (text.startsWith("http://") || text.startsWith("https://") || text.startsWith("data:image/"))) {
        this.selectPhoto(text.trim());
      } else {
        alert(
          "No image or image link found in clipboard. Copy an image or image URL from LinkedIn or Google Images, then click Paste or press Ctrl+V.",
        );
      }
    } catch (err) {
      console.warn("Clipboard read error:", err);
      const url = prompt("Paste your copied LinkedIn / Google Image address (URL):");
      if (url) this.selectPhoto(url.trim());
    }
  },

  handleGlobalPaste(e) {
    // Only handle if photo lookup modal or speaker modal is active
    if (!this.photoLookupModal.classList.contains("active") && !this.speakerModal.classList.contains("active")) {
      return;
    }

    if (e.clipboardData && e.clipboardData.items) {
      for (let i = 0; i < e.clipboardData.items.length; i++) {
        const item = e.clipboardData.items[i];
        if (item.type.indexOf("image") !== -1) {
          e.preventDefault();
          const file = item.getAsFile();
          this.handleFileUpload(file);
          this.showToast("Pasted image from clipboard!");
          return;
        }
      }

      // Check text for URL
      const text = e.clipboardData.getData("text");
      if (text && (text.startsWith("http://") || text.startsWith("https://") || text.startsWith("data:image/"))) {
        e.preventDefault();
        this.selectPhoto(text.trim());
        this.showToast("Applied image from clipboard URL!");
      }
    }
  },

  selectPhoto(rawPhotoUrl) {
    if (this.isViewOnly) return;
    // Every photo entry point (search results, pasted/typed URLs, clipboard, file upload, camera) ends up here
    const photoUrl = safeUrl(rawPhotoUrl, { allowData: true });
    if (!photoUrl) {
      this.showToast("Photo not applied: use an http(s) image link or an image file.");
      return;
    }
    if (this.activeTargetSpeakerIdForPhoto === "form") {
      this.formPhotoUrl.value = photoUrl;
      this.formPhotoPreview.src = photoUrl;
    } else if (this.activeTargetSpeakerIdForPhoto) {
      const spk = this.speakers.find((s) => s.id === this.activeTargetSpeakerIdForPhoto);
      if (spk) {
        spk.photo = photoUrl;
        this.saveSpeakers();
        this.render();
      }
    }

    this.stopCamera();
    this.closeModal("photo-lookup-modal");
    this.showToast("Speaker photo updated!");
  },

  handleFileUpload(file) {
    if (this.isViewOnly) return;
    if (!file || !file.type.startsWith("image/")) {
      alert("Please upload a valid image file (JPG, PNG, WebP).");
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target.result;
      this.selectPhoto(dataUrl);
    };
    reader.readAsDataURL(file);
  },

  startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert("Camera access is not supported in this browser.");
      return;
    }

    navigator.mediaDevices
      .getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 640 }, facingMode: "user" } })
      .then((stream) => {
        this.cameraStream = stream;
        this.cameraVideo.srcObject = stream;
        this.btnStartCamera.style.display = "none";
        this.btnSnapCamera.style.display = "inline-flex";
      })
      .catch((err) => {
        console.error("Camera error:", err);
        alert("Could not access camera. Please allow camera permissions.");
      });
  },

  snapCameraPhoto() {
    if (!this.cameraStream) return;
    const canvas = this.cameraCanvas;
    const video = this.cameraVideo;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 640;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const photoDataUrl = canvas.toDataURL("image/jpeg", 0.85);
    this.stopCamera();
    this.selectPhoto(photoDataUrl);
  },

  stopCamera() {
    if (this.cameraStream) {
      this.cameraStream.getTracks().forEach((track) => track.stop());
      this.cameraStream = null;
      this.btnStartCamera.style.display = "inline-flex";
      this.btnSnapCamera.style.display = "none";
    }
  },

  // --- Google Search Setup Guide & Key Manager ---
  initGoogleSearchGuide() {
    // The API key is a secret: only in the encrypted SecretStore (desktop app). The engine id (CX) is not.
    const supported = SecretStore.available;
    const key = SecretStore.get(SECRET_NAMES.gsearchApiKey);
    const cx = localStorage.getItem(GSEARCH_CX_KEY) || "";
    if (this.gsearchApiKey) this.gsearchApiKey.value = key;
    if (this.gsearchCxId) this.gsearchCxId.value = cx;
    if (!supported) {
      [this.gsearchApiKey, this.gsearchCxId, this.btnSaveGsearchKeys].forEach((el) => {
        if (el) el.disabled = true;
      });
    }
    const note = document.getElementById("gsearch-desktop-only-note");
    if (note) note.hidden = supported;
    this.updateGoogleApiStatus(key, cx);

    if (this.toggleGoogleGuideBtn && this.googleGuideContent) {
      this.toggleGoogleGuideBtn.addEventListener("click", () => {
        const isOpen = this.googleGuideContent.style.display !== "none";
        this.googleGuideContent.style.display = isOpen ? "none" : "block";
        if (this.googleGuideArrow) {
          this.googleGuideArrow.innerHTML = isOpen ? "&#9660;" : "&#9650;";
        }
      });
    }

    if (this.btnSaveGsearchKeys) {
      this.btnSaveGsearchKeys.addEventListener("click", async () => {
        if (!SecretStore.available) {
          if (this.gsearchApiKey) this.gsearchApiKey.value = "";
          return;
        }
        const k = (this.gsearchApiKey ? this.gsearchApiKey.value : "").trim();
        const c = (this.gsearchCxId ? this.gsearchCxId.value : "").trim();
        const stored = await SecretStore.set(SECRET_NAMES.gsearchApiKey, k);
        if (c) localStorage.setItem(GSEARCH_CX_KEY, c);
        else localStorage.removeItem(GSEARCH_CX_KEY);
        if (!stored && k) {
          this.updateGoogleApiStatus("", c);
          this.showToast("Could not save the API key in encrypted storage.", "error");
          return;
        }
        this.updateGoogleApiStatus(SecretStore.get(SECRET_NAMES.gsearchApiKey), c);
        this.showToast("Google API credentials saved!");
        this.executeOnlineSearch();
      });
    }
  },

  updateGoogleApiStatus(key, cx) {
    if (!this.gsearchApiStatus) return;
    if (!SecretStore.available) {
      this.gsearchApiStatus.innerHTML =
        '<span style="color: var(--text-muted);">Google Search API keys need the desktop app (using 1-click Google Images + Wikipedia/Commons web search)</span>';
      return;
    }
    if (key && cx) {
      this.gsearchApiStatus.innerHTML =
        '<span style="color: var(--ok-text); font-weight: 600;">✓ Google Custom Search API Connected (In-App Search Active)</span>';
    } else {
      this.gsearchApiStatus.innerHTML =
        '<span style="color: var(--text-muted);">No API key configured (using 1-click Google Images + Wikipedia/Commons web search)</span>';
    }
  },
});
