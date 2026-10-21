/**
 * Content Card Studio - Application Logic
 */

// Rentman token hygiene: the API token lives in the app's encrypted store and only the app's main process uses it.
// It must never be embedded in image URLs, because those URLs are stored in cards and the gear database and synced
// to the Shared Drive.
function scrubRentmanTokens(jsonText) {
  if (typeof jsonText !== "string" || jsonText.indexOf("token=") === -1) return jsonText;
  return jsonText.replace(/\/api\/rentman-image\?([^"\\\s]*)/g, (match, query) => {
    const kept = query.split("&").filter((p) => p && !p.startsWith("token="));
    return "/api/rentman-image?" + kept.join("&");
  });
}

// The Producers Toolbox app (window.toolbox) does what this page cannot do itself: files on the Shared Drive,
// Rentman and reading other sites. See api.js.
function appCall(method, ...args) {
  if (!window.toolbox) return Promise.reject(new Error("This needs the Producers Toolbox app."));
  return window.toolbox.call(method, ...args);
}

// Rentman photos are stored as "/api/rentman-image?url=..." (no token in the URL). Such an image cannot load on its
// own: when it fails, fetch it through the app and show it as a blob, which also keeps PNG export working.
const rentmanImages = new Map(); // url -> Promise<blob URL>
document.addEventListener(
  "error",
  (event) => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement) || img.dataset.rentmanTried) return;
    const src = img.getAttribute("src") || "";
    if (!src.startsWith("/api/rentman-image?")) return;
    img.dataset.rentmanTried = "1";
    const url = new URLSearchParams(src.slice(src.indexOf("?") + 1)).get("url");
    if (!url) return;
    let blobUrl = rentmanImages.get(url);
    if (!blobUrl) {
      blobUrl = appCall("rentman.image", url).then((r) => URL.createObjectURL(new Blob([r.data], { type: r.type })));
      rentmanImages.set(url, blobUrl);
      blobUrl.catch(() => rentmanImages.delete(url));
    }
    blobUrl.then((u) => (img.src = u)).catch(() => {});
  },
  true,
);

// One-time cleanup of tokens stored in local data by versions <= 0.6
(function scrubStoredRentmanTokens() {
  ["flightcase_active_card", "flightcase_gear_db", "flightcase_library", "rentman_cached_catalog"].forEach((key) => {
    try {
      const raw = localStorage.getItem(key);
      const clean = scrubRentmanTokens(raw);
      if (raw && clean !== raw) localStorage.setItem(key, clean);
    } catch (e) {}
  });
})();

// Global Utility: Escape HTML
function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Card and gear images come from the gear database, Rentman, webshops, imports and the shared drive, so they are
// untrusted. Inline SVG markup is never inserted: older versions stored built-in stock icons that way, and those are
// not photos, so they count as "no image". Uploads are never SVG markup. Any other image becomes an <img> URL (an SVG
// there cannot run script).
function isFillerIcon(src) {
  return typeof src === "string" && /^\s*(<|&lt;)svg[\s>]/i.test(src);
}

const NO_IMAGE_HTML = '<div class="no-image-placeholder">No image</div>';

/** A URL that is safe in an <img src>, or "" when the value is not an image. */
function safeImageSrc(src) {
  if (typeof src !== "string") return "";
  const s = src.trim();
  if (/^(https?:|blob:)/i.test(s)) return s;
  if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml)[;,]/i.test(s)) return s;
  if (/^(\/api\/rentman-image\?|assets\/)/.test(s)) return s;
  return "";
}

/** HTML for an image as an escaped <img>, or "" when there is no usable image. */
function imageHtml(src, attrs = 'alt=""') {
  if (isFillerIcon(src)) return "";
  const url = safeImageSrc(src);
  return url ? `<img src="${escapeHtml(url)}" ${attrs}>` : "";
}

// --- DEFAULT GEAR DATABASE ---
const DEFAULT_GEAR_DATABASE = [
  // CABLES & POWER
  {
    id: "cable-sdi-bnc-3m",
    name: "12G/3G-SDI BNC 75-Ohm Coaxial Video Cable 3.0m",
    category: "cables",
    aliases: [
      "sdi",
      "sdi cable",
      "bnc",
      "bnc cable",
      "12g sdi",
      "3g sdi",
      "6g sdi",
      "hd-sdi",
      "coax",
      "coaxial",
      "video bnc",
      "sdi 3m",
      "sdi cable 3m",
      "sdi 5m",
      "sdi 1.5m",
      "bnc coax",
    ],
    image: "",
  },
  {
    id: "cable-sdi-bnc-10m",
    name: "12G-SDI BNC High-Flex Video Cable Drum 10m / 25m",
    category: "cables",
    aliases: [
      "sdi 10m",
      "sdi 25m",
      "sdi reel",
      "sdi drum",
      "10m sdi",
      "25m sdi",
      "long sdi",
      "bnc 10m",
      "sdi reel 25m",
      "video reel",
    ],
    image: "",
  },
  {
    id: "cable-sdi-micro-bnc",
    name: "Micro BNC (HD-BNC) to Standard BNC 12G-SDI Cable 1.0m",
    category: "cables",
    aliases: ["micro bnc", "micro sdi", "din 1.0", "sdi micro", "atem bnc", "din sdi", "hd-bnc"],
    image: "",
  },
  {
    id: "cable-c13-schuko",
    name: "Schuko Male to IEC C13 1.5m Power Cable",
    category: "cables",
    aliases: [
      "c13",
      "iec",
      "schuko",
      "power cable",
      "power cord",
      "kettle lead",
      "euro cord",
      "mains 1.5m",
      "c13 cable",
      "schuko male - iec female",
    ],
    image: "",
  },
  {
    id: "cable-powercon-true1-top",
    name: "PowerCON TRUE1 TOP Link Cable 1.5m",
    category: "cables",
    aliases: ["true1", "powercon", "top", "true 1", "nac3fx", "power link", "true1 cable"],
    image: "",
  },
  {
    id: "cable-powercon-blue-grey",
    name: "PowerCON 20A Blue to Grey Link Cable 2.0m",
    category: "cables",
    aliases: ["powercon blue", "grey", "nac3fca", "power link 20a"],
    image: "",
  },
  {
    id: "cable-dmx-5pin-3m",
    name: "DMX 5-Pin XLR Cable 3.0 Meter Black",
    category: "cables",
    aliases: ["dmx", "5-pin", "5pin", "dmx 5", "neutrik 5p", "lighting cable", "dmx 5p"],
    image: "",
  },
  {
    id: "cable-dmx-3pin-3m",
    name: "DMX 3-Pin XLR Cable 3.0 Meter Black",
    category: "cables",
    aliases: ["dmx 3", "3-pin", "3pin", "dmx 3p", "xlr cable"],
    image: "",
  },
  {
    id: "cable-hdmi-4k-2m",
    name: "High Speed 4K HDMI 2.0 / 2.1 Video Cable 2.0m",
    category: "cables",
    aliases: ["hdmi", "hdmi cable", "4k", "4k hdmi", "high speed", "video cable", "hdmi 2.0", "hdmi 2m", "hdmi 5m"],
    image: "",
  },
  {
    id: "cable-micro-hdmi-2m",
    name: "Micro HDMI Type D to Standard HDMI Cable 2.0m",
    category: "cables",
    aliases: ["micro hdmi", "type d", "atem micro", "hdmi d"],
    image: "",
  },
  {
    id: "cable-cat6-ethercon-5m",
    name: "Cat6 RJ45 EtherCON Rugged Network Cable 5.0m",
    category: "cables",
    aliases: ["cat6", "ethercon", "rj45", "lan", "network cable", "dante", "ethernet", "cat6 cable"],
    image: "",
  },

  // LIGHTING & OPTICS (ASTERA & GENERAL)
  {
    id: "light-astera-ax3",
    name: "Astera AX3 LightDrop Wireless Spotlight",
    category: "lighting",
    aliases: ["ax3", "astera ax3", "lightdrop", "spotlight", "battery par"],
    image: "",
  },
  {
    id: "optic-diffusor-32",
    name: "Astera Diffusor Lens 32° (Beam Shaper)",
    category: "lighting",
    aliases: ["32", "32 deg", "diffusor 32", "diffuser 32", "lens 32", "filter"],
    image: "",
  },
  {
    id: "optic-diffusor-120",
    name: "Astera Diffusor Lens 120° (Wide Flood)",
    category: "lighting",
    aliases: ["120", "120 deg", "diffusor 120", "diffuser 120", "wide lens", "flood"],
    image: "",
  },
  {
    id: "optic-diffusor-dome-220",
    name: "Astera Diffusor Dome Lens 220° (Wallwash)",
    category: "lighting",
    aliases: ["220", "220 deg", "diffusor dome", "dome 220", "dome lens", "globe"],
    image: "",
  },
  {
    id: "accessory-astera-plug",
    name: "Astera Rubber Power Socket Sealing Plug",
    category: "lighting",
    aliases: ["rubber plug", "socket plug", "power plug cap", "rubber cap", "ip65 cap", "sealing plug"],
    image: "",
  },
  {
    id: "remote-astera-arc1",
    name: "Astera ARC1 Infra-Red Remote Control",
    category: "lighting",
    aliases: ["arc1", "remote", "ir remote", "astera remote", "controller"],
    image: "",
  },
  {
    id: "light-aputure-storm80c",
    name: "Aputure STORM 80c Lamp Head (80W BLAIR-CG)",
    category: "lighting",
    aliases: ["storm 80c", "storm80c", "aputure storm", "blair", "80c lamp", "point source"],
    image: "",
  },
  {
    id: "light-aputure-cf4",
    name: "Aputure CF4 Compact Fresnel with Barn Doors",
    category: "lighting",
    aliases: ["cf4", "fresnel", "aputure fresnel", "compact fresnel", "barn doors", "focusing lens"],
    image: "",
  },
  {
    id: "optic-storm-lantern",
    name: "Aputure STORM 80c Mini Lantern Diffuser",
    category: "lighting",
    aliases: ["lantern", "mini lantern", "storm lantern", "softbox globe", "diffuser"],
    image: "",
  },
  {
    id: "optic-aputure-dome40",
    name: "Aputure Quick Dome 40 Octagonal Softbox",
    category: "lighting",
    aliases: ["quick dome", "dome 40", "softbox", "grid", "octadome", "diffuser 40"],
    image: "",
  },
  {
    id: "mount-storm-bowens",
    name: "Bowens Mount Speedring Adapter for STORM 80c",
    category: "lighting",
    aliases: ["bowens", "bowens adapter", "speedring", "mini pro lock to bowens"],
    image: "",
  },
  {
    id: "rig-super-clamp",
    name: 'Aputure Heavy Duty Super Clamp with 5/8" Stud',
    category: "rigging",
    aliases: ["super clamp", "clamp 5/8", "stud clamp", "convi clamp", "grip clamp"],
    image: "",
  },
  {
    id: "rig-magic-arm",
    name: "Universal Articulated Magic Arm Mount",
    category: "rigging",
    aliases: ["magic arm", "articulated arm", "arm mount", "friction arm"],
    image: "",
  },
  {
    id: "case-rolling-flightcase",
    name: "Heavy-Duty Hard-Shell Rolling Flightcase",
    category: "accessories",
    aliases: ["flightcase", "rolling case", "hard case", "peli", "transport case"],
    image: "",
  },

  // RIGGING & CLAMPS
  {
    id: "rig-hook-m4",
    name: "Astera Eyebolt Hook with M4 Thread",
    category: "rigging",
    aliases: ["m4 hook", "eyebolt", "hook m4", "eye bolt", "thread hook", "hanging ring"],
    image: "",
  },
  {
    id: "rig-omega-bracket",
    name: "Fast-Lock Quick Release Omega Bracket Clamp",
    category: "rigging",
    aliases: ["omega bracket", "omega", "quick lock", "truss clamp", "moving head clamp"],
    image: "",
  },
  {
    id: "rig-safety-wire-35kg",
    name: "Safety Wire Steel Cable 35kg Rating w/ Carabiner",
    category: "rigging",
    aliases: ["safety wire", "safety cable", "steel wire", "fall arrest", "carabiner"],
    image: "",
  },

  // AUDIO & MICS
  {
    id: "audio-sennheiser-skm",
    name: "Sennheiser SKM Handheld Transmitter w/ MMD 835",
    category: "audio",
    aliases: ["skm", "ew-dx", "sennheiser mic", "handheld", "wireless mic", "835"],
    image: "",
  },
  {
    id: "audio-sennheiser-sk-bodypack",
    name: "Sennheiser SK Bodypack Transmitter w/ ME2 Lavalier",
    category: "audio",
    aliases: ["bodypack", "beltpack", "lavalier", "me2", "tie clip mic"],
    image: "",
  },
  {
    id: "audio-shure-sm58",
    name: "Shure SM58 Dynamic Vocal Microphone",
    category: "audio",
    aliases: ["sm58", "shure 58", "dynamic mic", "vocal mic"],
    image: "",
  },
  {
    id: "audio-battery-ba70",
    name: "Sennheiser BA70 Li-Ion Rechargeable Battery Pack",
    category: "audio",
    aliases: ["ba70", "rechargeable battery", "sennheiser battery", "mic battery"],
    image: "",
  },

  // VIDEO & SWITCHING
  {
    id: "video-atem-extreme",
    name: "Blackmagic ATEM Mini Extreme ISO Switcher",
    category: "video",
    aliases: ["atem", "atem mini", "switcher", "extreme iso", "video switcher", "hdmi switcher"],
    image: "",
  },
  {
    id: "video-sony-fx6",
    name: "Sony FX6 Cinema Camera Body Full-Frame 4K",
    category: "video",
    aliases: ["fx6", "sony fx6", "cinema camera", "4k camera", "camera body"],
    image: "",
  },
  {
    id: "video-sony-bpu70",
    name: "Sony BP-U70 High Capacity Lithium Battery",
    category: "video",
    aliases: ["bp-u70", "bpu70", "bp-u", "sony battery", "camera battery"],
    image: "",
  },
  {
    id: "video-sandisk-ssd",
    name: "SanDisk Extreme Pro 1TB Portable SSD USB-C",
    category: "video",
    aliases: ["ssd", "sandisk ssd", "external drive", "usb-c drive", "recording drive"],
    image: "",
  },
];

// --- DEFAULT STANDARD CARD (STREAM MY EVENT DIN A5) ---
const DEFAULT_CARD = {
  title: "Astera AX3",
  subtitle: "Lightdrop Set",
  tag: "AX3-KIT-01",
  pattern: "diamonds",
  company: "STREAM MY EVENT",
  phone: "+31(0)20 369 0970",
  website: "www.streammyevent.com",
  logo: "sme-live",
  dimensions: "148x210",
  photoColWidth: 52,
  fontScale: 1.0,
  printerMargin: 5,
  showMarginGuide: true,
  items: [
    { id: "1", qty: "8", content: "Astera Ax3\nLightDrop", image: "" },
    { id: "2", qty: "1", content: "Schuko Male -\nIEC Female 1,5 meter", image: "" },
    { id: "3", qty: "8", content: "Astera Diffusor Lens\n32°", image: "" },
    { id: "4", qty: "8", content: "Astera Diffusor Lens\n120°", image: "" },
    { id: "5", qty: "8", content: "Astera Diffusor Dome Lens\n220°", image: "" },
    { id: "6", qty: "8", content: "Astera Hook with\nM4 thread", image: "" },
    { id: "7", qty: "8", content: "Astera Rubber\nPower socket plug", image: "" },
    { id: "8", qty: "1", content: "Astera ARC1 Infra-\nRed Remote Control", image: "" },
  ],
};

// --- STATE MANAGEMENT ---
let currentCard = JSON.parse(JSON.stringify(DEFAULT_CARD));
let customGearDb = [];
let activeFocusedRowIndex = null;
let zoomLevel = 100;
let pendingRowPhotoTargetIndex = null;
let currentEditingGearPhoto = null;
let extractedWebData = { title: "", subtitle: "", items: [] };

// --- CARD PHOTO STORE ---
// Uploaded/edited photos are too big for localStorage (~5 MB for everything), so saved
// cards keep a small "cardimg:<key>" reference and the photo itself lives in IndexedDB.
// All photos are loaded into memory at startup, so resolving references is synchronous.
const CARD_IMAGE_REF = "cardimg:";
const cardImageCache = new Map();
let cardImageDb = null;

function cardImageKey(str) {
  let h1 = 0x811c9dc5,
    h2 = 0x01000193;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 2246822507);
  }
  return `${str.length.toString(36)}-${(h1 >>> 0).toString(36)}-${(h2 >>> 0).toString(36)}`;
}

function initCardImageStore() {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    setTimeout(finish, 3000); // never block startup on a stuck IndexedDB
    try {
      const req = indexedDB.open("content-card-studio", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("images");
      req.onerror = finish;
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("images", "readonly");
        const cursorReq = tx.objectStore("images").openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor) {
            cardImageCache.set(cursor.key, cursor.value);
            cursor.continue();
          }
        };
        tx.oncomplete = () => {
          cardImageDb = db;
          pruneCardImages();
          finish();
        };
        tx.onerror = finish;
      };
    } catch (e) {
      console.warn("Photo store unavailable:", e);
      finish();
    }
  });
}

// Returns a reference for a large image, or "" when the store is unavailable
function storeCardImage(dataUrl) {
  if (!cardImageDb) return "";
  const key = cardImageKey(dataUrl);
  if (!cardImageCache.has(key)) {
    cardImageCache.set(key, dataUrl);
    try {
      cardImageDb.transaction("images", "readwrite").objectStore("images").put(dataUrl, key);
    } catch (e) {
      console.warn("Could not store photo:", e);
    }
  }
  return CARD_IMAGE_REF + key;
}

function resolveCardImages(card) {
  if (card && Array.isArray(card.items)) {
    card.items.forEach((item) => {
      if (item && typeof item.image === "string" && item.image.startsWith(CARD_IMAGE_REF)) {
        item.image = cardImageCache.get(item.image.slice(CARD_IMAGE_REF.length)) || "";
      }
    });
  }
  return card;
}

// Remove photos no saved card refers to any more
function pruneCardImages() {
  if (!cardImageDb) return;
  let used = "";
  try {
    used = ["flightcase_active_card", "flightcase_library", "flightcase_gear_db"]
      .map((k) => localStorage.getItem(k) || "")
      .join("");
  } catch (e) {
    return;
  }
  const stale = [...cardImageCache.keys()].filter((key) => !used.includes(CARD_IMAGE_REF + key));
  if (!stale.length) return;
  try {
    const store = cardImageDb.transaction("images", "readwrite").objectStore("images");
    stale.forEach((key) => {
      store.delete(key);
      cardImageCache.delete(key);
    });
  } catch (e) {}
}

// Library of saved cards, with photos resolved
function readLibrary() {
  let cases = [];
  try {
    cases = JSON.parse(localStorage.getItem("flightcase_library") || "[]");
  } catch (e) {
    cases = [];
  }
  if (!Array.isArray(cases)) cases = [];
  return cases.map(resolveCardImages);
}

// Throws on quota errors so callers can report them
function writeLibrary(cases) {
  localStorage.setItem("flightcase_library", JSON.stringify(cases.map(stripImagesFromCardSnapshot)));
}

function loadActiveCardState() {
  const saved = localStorage.getItem("flightcase_active_card");
  if (saved) {
    try {
      const parsed = resolveCardImages(JSON.parse(saved));
      if (parsed && parsed.title && Array.isArray(parsed.items)) {
        // Upgrade previous 100x150 or 105x148 default to SME standard DIN A5 (148x210)
        if (!parsed.dimensions || parsed.dimensions === "100x150" || parsed.dimensions === "105x148") {
          parsed.dimensions = "148x210";
        }
        if (!parsed.photoColWidth) {
          parsed.photoColWidth = 52;
        }
        if (parsed.fontScale === undefined) {
          parsed.fontScale = 1.0;
        }
        if (parsed.printerMargin === undefined) {
          parsed.printerMargin = 5;
        }
        if (parsed.showMarginGuide === undefined) {
          parsed.showMarginGuide = true;
        }
        currentCard = parsed;
        return;
      }
    } catch (e) {
      console.warn("Could not load active card from storage:", e);
    }
  }
  currentCard = JSON.parse(JSON.stringify(DEFAULT_CARD));
  currentCard.dimensions = "148x210";
  currentCard.photoColWidth = 52;
  currentCard.fontScale = 1.0;
  currentCard.printerMargin = 5;
  currentCard.showMarginGuide = true;
}

function saveActiveCardState() {
  try {
    // Strip large base64 images before writing — avoids localStorage quota errors.
    // The live currentCard in memory always has full images for display.
    const snapshot =
      typeof stripImagesFromCardSnapshot === "function" ? stripImagesFromCardSnapshot(currentCard) : currentCard;
    localStorage.setItem("flightcase_active_card", JSON.stringify(snapshot));
  } catch (e) {
    if (e.name === "QuotaExceededError" || e.code === 22) {
      console.warn("saveActiveCardState: localStorage quota exceeded — images may not persist.");
    } else {
      console.warn("Error saving active card to storage:", e);
    }
  }
}

// --- UNDO / REDO ---
// Snapshot history of currentCard. Changes are detected after user events (and after
// every renderCard), so individual edit handlers don't need to know about undo.
const HISTORY_LIMIT = 100;
const TYPING_COMMIT_DELAY = 600;
let undoStack = [];
let redoStack = [];
let lastSnapshot = null;
let historySuspended = false;
let typingCommitTimer = null;

// Deep copy that shares strings (base64 photos aren't duplicated per step)
function cloneCardDeep(value) {
  if (Array.isArray(value)) return value.map(cloneCardDeep);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value)) out[key] = cloneCardDeep(value[key]);
    return out;
  }
  return value;
}

function cardsEqual(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a).filter((k) => a[k] !== undefined);
  const keysB = Object.keys(b).filter((k) => b[k] !== undefined);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((k) => cardsEqual(a[k], b[k]));
}

function resetHistory() {
  undoStack = [];
  redoStack = [];
  lastSnapshot = cloneCardDeep(currentCard);
  updateUndoRedoButtons();
}

function commitHistory() {
  clearTimeout(typingCommitTimer);
  typingCommitTimer = null;
  if (historySuspended || !lastSnapshot) return;
  if (cardsEqual(currentCard, lastSnapshot)) return;
  undoStack.push(lastSnapshot);
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  redoStack = [];
  lastSnapshot = cloneCardDeep(currentCard);
  updateUndoRedoButtons();
  updateHeaderCardStatus();
}

function scheduleHistoryCommit(delay) {
  clearTimeout(typingCommitTimer);
  typingCommitTimer = setTimeout(commitHistory, delay);
}

function restoreHistorySnapshot(snapshot) {
  historySuspended = true;
  try {
    currentCard = cloneCardDeep(snapshot);
    renderCard();
    renderSidebar();
  } finally {
    historySuspended = false;
  }
  lastSnapshot = cloneCardDeep(currentCard);
  updateUndoRedoButtons();
}

function undoCardChange() {
  commitHistory();
  if (!undoStack.length) return false;
  redoStack.push(lastSnapshot);
  restoreHistorySnapshot(undoStack.pop());
  return true;
}

function redoCardChange() {
  commitHistory();
  if (!redoStack.length) return false;
  undoStack.push(lastSnapshot);
  restoreHistorySnapshot(redoStack.pop());
  return true;
}

function updateUndoRedoButtons() {
  const undoBtn = document.getElementById("undoBtn");
  const redoBtn = document.getElementById("redoBtn");
  if (undoBtn) undoBtn.disabled = undoStack.length === 0;
  if (redoBtn) redoBtn.disabled = redoStack.length === 0;
}

function initUndoRedo() {
  resetHistory();

  // Bubble phase: these run after the edit handlers have updated currentCard
  document.addEventListener("input", () => scheduleHistoryCommit(TYPING_COMMIT_DELAY));
  document.addEventListener("focusout", () => {
    if (typingCommitTimer) commitHistory();
  });
  ["change", "click", "pointerup", "drop"].forEach((type) =>
    document.addEventListener(type, () => setTimeout(commitHistory, 0)),
  );

  const undoBtn = document.getElementById("undoBtn");
  const redoBtn = document.getElementById("redoBtn");
  if (undoBtn) undoBtn.addEventListener("click", undoCardChange);
  if (redoBtn) redoBtn.addEventListener("click", redoCardChange);

  document.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const key = e.key.toLowerCase();
    // Ctrl+S saves the card to the library instead of the browser's "Save page as"
    if (key === "s" && !e.shiftKey) {
      e.preventDefault();
      if (!e.repeat) saveCurrentCaseToStorage();
      return;
    }
    const isUndo = key === "z" && !e.shiftKey;
    const isRedo = key === "y" || (key === "z" && e.shiftKey);
    if (!isUndo && !isRedo) return;
    // Inside dialogs (gear search, Rentman token, drive path, print settings) keep the browser's own field undo
    // (focus can linger on an element of a dialog that has been closed, so check it is open)
    const dialog = e.target.closest && e.target.closest(".modal-backdrop");
    if (dialog && !dialog.classList.contains("hidden")) return;
    e.preventDefault();
    if (isUndo) undoCardChange();
    else redoCardChange();
  });
}

// --- APP INITIALIZATION ---
document.addEventListener("DOMContentLoaded", async () => {
  await initCardImageStore();
  try {
    loadActiveCardState();
  } catch (e) {
    console.error("loadActiveCardState error:", e);
  }
  try {
    loadSavedCasesFromStorage();
  } catch (e) {
    console.error("loadSavedCasesFromStorage error:", e);
  }
  try {
    loadGearDatabase();
  } catch (e) {
    console.error("loadGearDatabase error:", e);
  }
  try {
    initEventListeners();
  } catch (e) {
    console.error("initEventListeners error:", e);
  }
  try {
    initWebImporter();
  } catch (e) {
    console.error("initWebImporter error:", e);
  }
  try {
    initGearDatabaseModule();
  } catch (e) {
    console.error("initGearDatabaseModule error:", e);
  }
  try {
    initPhotoEditorModule();
  } catch (e) {
    console.error("initPhotoEditorModule error:", e);
  }
  try {
    initStorageModule();
  } catch (e) {
    console.error("initStorageModule error:", e);
  }
  try {
    initRentmanModule();
  } catch (e) {
    console.error("initRentmanModule error:", e);
  }
  try {
    renderCard();
  } catch (e) {
    console.error("renderCard error:", e);
  }
  try {
    renderSidebar();
  } catch (e) {
    console.error("renderSidebar error:", e);
  }
  try {
    initUndoRedo();
  } catch (e) {
    console.error("initUndoRedo error:", e);
  }
  try {
    fitCardToStage(100);
  } catch (e) {
    console.error("fitCardToStage error:", e);
  }
});

// --- CORE RENDER FUNCTIONS ---

// Watermark intensity in % (slider 2–30), stored per card
function watermarkOpacityOf(card) {
  const v = parseInt(card && card.watermarkOpacity, 10);
  return isNaN(v) ? 12 : Math.max(2, Math.min(30, v));
}

function syncWatermarkControls() {
  const on = document.getElementById("showWatermark").checked;
  ["watermarkPatternGroup", "watermarkOpacityGroup"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle("control-disabled", !on);
  });
}

// Footer company name: first word large, the rest small underneath; empty stays empty
function formatCompanyNameHtml(name) {
  const text = String(name || "").trim();
  if (!text) return "";
  const space = text.indexOf(" ");
  if (space < 0) return escapeHtml(text);
  return escapeHtml(text.slice(0, space)) + "<br><small>" + escapeHtml(text.slice(space + 1)) + "</small>";
}

function renderCard() {
  const card = document.getElementById("flightcaseCard");
  const titleDisplay = document.getElementById("cardTitleDisplay");
  const subtitleDisplay = document.getElementById("cardSubtitleDisplay");
  const tableBody = document.getElementById("cardTableBody");
  const companyNameDisplay = document.getElementById("footerCompanyNameDisplay");
  const phoneDisplay = document.getElementById("footerPhoneDisplay");
  const websiteDisplay = document.getElementById("footerWebsiteDisplay");
  const dimsBadge = document.getElementById("cardDimsBadge");

  // Physical Dimensions & Column Width
  currentCard.photoColWidth = currentCard.photoColWidth || 52;
  card.style.setProperty("--photo-col-width", `${currentCard.photoColWidth}px`);

  // Font Scale & Printer Safety Margin
  applyFontScaleToCard(currentCard.fontScale !== undefined ? currentCard.fontScale : 1.0, false);
  applyPrinterMarginToCard(currentCard.printerMargin !== undefined ? currentCard.printerMargin : 5, false);
  togglePrinterMarginGuide(currentCard.showMarginGuide !== false);

  // Pattern
  card.setAttribute("data-pattern", currentCard.pattern || "diamonds");
  card.setAttribute("data-watermark", currentCard.showWatermark === false ? "off" : "on");
  card.style.setProperty("--card-bg-watermark-opacity", watermarkOpacityOf(currentCard) / 100);
  card.style.setProperty("--row-count", currentCard.items.length);

  // Physical Dimensions
  applyDimensionsToCard(currentCard.dimensions);

  // Header Title
  titleDisplay.innerText = currentCard.title || "";
  subtitleDisplay.innerText = currentCard.subtitle || "";

  // Dimensions Badge
  dimsBadge.innerText = `${getDimensionLabel(currentCard.dimensions)} (${currentCard.orientation || "Portrait"})`;

  // Render Table Rows
  tableBody.innerHTML = "";
  currentCard.items.forEach((item, index) => {
    const tr = document.createElement("tr");
    tr.className = "card-row";
    tr.dataset.index = index;

    // Col 1: Photo
    const tdPhoto = document.createElement("td");
    tdPhoto.className = "card-cell-photo";
    tdPhoto.title = "Click to select photo from Gear Database or drag divider line to resize";

    const imgWrap = document.createElement("div");
    imgWrap.className = "cell-img-wrap";
    if (item.image && !isFillerIcon(item.image)) {
      const img = document.createElement("img");
      img.src = safeImageSrc(item.image);
      img.alt = item.content || "photo";
      imgWrap.appendChild(img);
    } else if (item.noImage || isFillerIcon(item.image)) {
      // No photo, or an old stock icon: say so instead of guessing
      const missing = document.createElement("div");
      missing.className = "no-image-placeholder";
      missing.textContent = "No image";
      imgWrap.appendChild(missing);
    } else {
      // No photo: leave the cell blank
      tdPhoto.classList.add("no-photo");
    }
    tdPhoto.appendChild(imgWrap);

    // Draggable column resize handle on right divider line
    const resizeHandle = document.createElement("div");
    resizeHandle.className = "col-resize-handle no-print";
    resizeHandle.title = "Drag line left/right to resize photo column";
    resizeHandle.setAttribute("data-html2canvas-ignore", "true");
    initColResizeHandle(resizeHandle);
    tdPhoto.appendChild(resizeHandle);

    // Col 2: Quantity
    const tdQty = document.createElement("td");
    tdQty.className = "card-cell-qty";
    tdQty.innerHTML = `
      <span class="cell-label-tag">QTY:</span>
      <span class="cell-qty-value" contenteditable="true" spellcheck="false">${escapeHtml(item.qty || "")}</span>
    `;

    // Col 3: Content
    const tdContent = document.createElement("td");
    tdContent.className = "card-cell-content";
    tdContent.innerHTML = `
      <span class="cell-label-tag">Content:</span>
      <div class="cell-content-text" contenteditable="true" spellcheck="false">${escapeHtml(item.content || "")}</div>
    `;

    addTableRowListeners(tr, tdPhoto, tdQty, tdContent, index);

    tr.appendChild(tdPhoto);
    tr.appendChild(tdQty);
    tr.appendChild(tdContent);
    tableBody.appendChild(tr);
  });

  // Footer
  companyNameDisplay.innerHTML = formatCompanyNameHtml(currentCard.company);
  phoneDisplay.innerText = currentCard.phone || "";
  websiteDisplay.innerText = currentCard.website || "";

  renderFooterLogo();
  updateQrCodeDisplay();
  saveActiveCardState();
  // Catch-all for changes that finish asynchronously (photo uploads, imports, loading a case)
  if (!historySuspended) setTimeout(commitHistory, 0);
  if (!historySuspended) updateHeaderCardStatus();
}

function renderSidebar() {
  document.getElementById("inputTitle").value = currentCard.title || "";
  document.getElementById("inputSubtitle").value = currentCard.subtitle || "";
  document.getElementById("inputCaseTag").value = currentCard.tag || "";
  // "invert" was never styled (looked like "clean") and is no longer offered
  document.getElementById("watermarkPattern").value =
    currentCard.pattern === "invert" ? "clean" : currentCard.pattern || "diamonds";
  document.getElementById("watermarkOpacity").value = watermarkOpacityOf(currentCard);
  document.getElementById("showWatermark").checked = currentCard.showWatermark !== false;
  syncWatermarkControls();
  document.getElementById("companyName").value = currentCard.company || "";
  document.getElementById("companyPhone").value = currentCard.phone || "";
  document.getElementById("companyWebsite").value = currentCard.website || "";

  const dimPresetSelect = document.getElementById("dimensionPreset");
  dimPresetSelect.value = currentCard.dimensions || "148x210";

  const customDimsRow = document.getElementById("customDimsRow");
  if (currentCard.dimensions === "custom") {
    customDimsRow.classList.remove("hidden");
    if (currentCard.customWidth) document.getElementById("customWidth").value = currentCard.customWidth;
    if (currentCard.customHeight) document.getElementById("customHeight").value = currentCard.customHeight;
  } else {
    customDimsRow.classList.add("hidden");
  }

  document.getElementById("itemsCount").innerText = currentCard.items.length;

  // Sync Font Scale slider and presets
  const fontScale = currentCard.fontScale !== undefined ? currentCard.fontScale : 1.0;
  const fontPct = Math.round(fontScale * 100);
  const fontSlider = document.getElementById("fontSizeSlider");
  if (fontSlider) fontSlider.value = fontPct;
  const fontValDisplay = document.getElementById("fontSizeSliderValue");
  if (fontValDisplay) {
    const px = (11.5 * fontScale).toFixed(1);
    fontValDisplay.innerText = `${fontPct}% (${px}px)`;
  }
  document.querySelectorAll(".font-preset-btn").forEach((btn) => {
    btn.classList.toggle("active", parseInt(btn.dataset.scale, 10) === fontPct);
  });

  // Sync Printer Margin slider, numeric input, and guide
  const marginMm = currentCard.printerMargin !== undefined ? currentCard.printerMargin : 5;
  const marginSlider = document.getElementById("printerMarginSlider");
  if (marginSlider) marginSlider.value = marginMm;
  const marginInput = document.getElementById("printerMarginInput");
  if (marginInput) marginInput.value = marginMm;
  const marginValDisplay = document.getElementById("printerMarginValue");
  if (marginValDisplay) {
    marginValDisplay.innerText = `${marginMm} mm${marginMm === 5 ? " (Standard)" : ""}`;
  }
  const marginGuideCheckbox = document.getElementById("showPrinterMarginGuide");
  if (marginGuideCheckbox) marginGuideCheckbox.checked = currentCard.showMarginGuide !== false;

  // Sync Photo Column Width slider and live label
  currentCard.photoColWidth = currentCard.photoColWidth || 52;
  const photoSlider = document.getElementById("photoColWidthSlider");
  if (photoSlider) photoSlider.value = currentCard.photoColWidth;
  const photoValDisplay = document.getElementById("photoColWidthValue");
  if (photoValDisplay) {
    const mm = Math.round(currentCard.photoColWidth * 0.264583);
    photoValDisplay.innerText = `${currentCard.photoColWidth}px (~${mm}mm)`;
  }
  document.querySelectorAll(".photo-preset-btn").forEach((btn) => {
    btn.classList.toggle("active", parseInt(btn.dataset.width, 10) === currentCard.photoColWidth);
  });

  const container = document.getElementById("itemsListContainer");
  const prevScrollTop = container ? container.scrollTop : 0;
  container.innerHTML = "";

  currentCard.items.forEach((item, index) => {
    const itemCard = document.createElement("div");
    itemCard.className = `item-editor-card ${activeFocusedRowIndex === index ? "active-focus" : ""}`;
    itemCard.dataset.index = index;

    let thumbHtml = `<span class="upload-icon-placeholder" aria-hidden="true">+</span>`;
    if (item.image) thumbHtml = imageHtml(item.image, 'alt="thumb"') || thumbHtml;

    itemCard.innerHTML = `
      <div class="item-drag-handle" title="Drag to reorder"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01"></path></svg></div>
      <div class="item-thumb-uploader" title="Change photo" role="button" tabindex="0">
        ${thumbHtml}
      </div>
      <div class="item-qty-input-wrap">
        <input type="text" class="item-qty-field" placeholder="Qty" aria-label="Quantity" value="${escapeHtml(item.qty || "")}">
      </div>
      <div class="item-desc-input-wrap">
        <input type="text" class="item-desc-field" placeholder="Item description" aria-label="Item description" value="${escapeHtml(item.content ? item.content.replace(/\n/g, " ") : "")}">
      </div>
      <div class="item-actions-wrap">
        <button class="btn btn-icon btn-xs move-up-btn" title="Move up" aria-label="Move up" ${index === 0 ? "disabled" : ""}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"></path></svg></button>
        <button class="btn btn-icon btn-xs move-down-btn" title="Move down" aria-label="Move down" ${index === currentCard.items.length - 1 ? "disabled" : ""}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"></path></svg></button>
        <button class="btn btn-icon btn-xs crop-photo-btn" title="Crop and rotate photo" aria-label="Crop and rotate photo"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2v14a2 2 0 0 0 2 2h14M18 22V8a2 2 0 0 0-2-2H2"></path></svg></button>
        <button class="btn btn-icon btn-xs delete-row-btn" title="Delete row" aria-label="Delete row"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"></path></svg></button>
      </div>
    `;

    const moveUpBtn = itemCard.querySelector(".move-up-btn");
    if (moveUpBtn) {
      moveUpBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (index > 0) {
          const temp = currentCard.items[index];
          currentCard.items[index] = currentCard.items[index - 1];
          currentCard.items[index - 1] = temp;
          activeFocusedRowIndex = index - 1;
          renderCard();
          renderSidebar();
          showToastNotification("Moved item up ▲", "↕️");
        }
      });
    }

    const moveDownBtn = itemCard.querySelector(".move-down-btn");
    if (moveDownBtn) {
      moveDownBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (index < currentCard.items.length - 1) {
          const temp = currentCard.items[index];
          currentCard.items[index] = currentCard.items[index + 1];
          currentCard.items[index + 1] = temp;
          activeFocusedRowIndex = index + 1;
          renderCard();
          renderSidebar();
          showToastNotification("Moved item down ▼", "↕️");
        }
      });
    }

    const dragHandle = itemCard.querySelector(".item-drag-handle");
    if (dragHandle) {
      dragHandle.setAttribute("draggable", "true");
      dragHandle.addEventListener("dragstart", (e) => {
        window._draggedItemIndex = index;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", index);
        itemCard.classList.add("dragging");
      });
      dragHandle.addEventListener("dragend", () => {
        window._draggedItemIndex = null;
        itemCard.classList.remove("dragging");
        document.querySelectorAll(".item-editor-card").forEach((c) => {
          c.classList.remove("dragging");
          c.style.borderTop = "";
          c.style.borderBottom = "";
        });
      });
      itemCard.addEventListener("dragover", (e) => {
        if (
          window._draggedItemIndex === undefined ||
          window._draggedItemIndex === null ||
          window._draggedItemIndex === index
        )
          return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const rect = itemCard.getBoundingClientRect();
        if (e.clientY < rect.top + rect.height / 2) {
          itemCard.style.borderTop = "2px solid var(--accent)";
          itemCard.style.borderBottom = "";
        } else {
          itemCard.style.borderBottom = "2px solid var(--accent)";
          itemCard.style.borderTop = "";
        }
      });
      itemCard.addEventListener("dragleave", () => {
        itemCard.style.borderTop = "";
        itemCard.style.borderBottom = "";
      });
      itemCard.addEventListener("drop", (e) => {
        e.preventDefault();
        itemCard.style.borderTop = "";
        itemCard.style.borderBottom = "";
        const fromIdx = window._draggedItemIndex;
        if (fromIdx === undefined || fromIdx === null || fromIdx === index) return;
        const rect = itemCard.getBoundingClientRect();
        let targetIdx = e.clientY < rect.top + rect.height / 2 ? index : index + 1;
        const moved = currentCard.items.splice(fromIdx, 1)[0];
        if (fromIdx < targetIdx) targetIdx--;
        currentCard.items.splice(targetIdx, 0, moved);
        activeFocusedRowIndex = targetIdx;
        renderCard();
        renderSidebar();
        showToastNotification("Reordered item", "↕️");
      });
    }

    const thumbUploader = itemCard.querySelector(".item-thumb-uploader");
    thumbUploader.addEventListener("click", () => {
      openGearPhotoPickerModal(index);
    });
    thumbUploader.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openGearPhotoPickerModal(index);
      }
    });

    const cropBtn = itemCard.querySelector(".crop-photo-btn");
    if (cropBtn) {
      cropBtn.addEventListener("click", () => {
        const item = currentCard.items[index];
        if (!item.image) {
          openGearPhotoPickerModal(index);
          return;
        }
        openPhotoEditor(item.image, `Crop Photo: ${item.content || "Item " + (index + 1)}`, (newPhotoData) => {
          currentCard.items[index].image = newPhotoData;
          if (item.content && item.content.trim()) {
            registerOrUpdateGlobalGear(item.content, newPhotoData);
          }
          renderCard();
          renderSidebar();
        });
      });
    }

    const qtyField = itemCard.querySelector(".item-qty-field");
    qtyField.addEventListener("input", (e) => {
      currentCard.items[index].qty = e.target.value;
      updateRowQtyInCard(index, e.target.value);
    });

    const descField = itemCard.querySelector(".item-desc-field");
    descField.addEventListener("input", (e) => {
      const val = e.target.value;
      currentCard.items[index].content = val;
      updateRowContentInCard(index, val);

      // Auto-match photo from global database if row has no photo
      if (!currentCard.items[index].image) {
        const match = findGearInDatabase(val);
        if (match) {
          currentCard.items[index].image = match.image;
          renderCard();
          renderSidebar();
          showToastNotification(`Matched photo: "${match.name}"`, "✨");
        }
      } else if (
        val.trim().length >= 3 &&
        currentCard.items[index].image &&
        typeof currentCard.items[index].image === "string" &&
        currentCard.items[index].image.startsWith("data:image")
      ) {
        // Link custom photo to the typed description globally
        registerOrUpdateGlobalGear(val, currentCard.items[index].image, null, false);
      }
    });

    const iconSelectBtn = itemCard.querySelector(".icon-select-btn");
    if (iconSelectBtn)
      iconSelectBtn.addEventListener("click", () => {
        openGearPhotoPickerModal(index);
      });

    const deleteBtn = itemCard.querySelector(".delete-row-btn");
    deleteBtn.addEventListener("click", () => {
      currentCard.items.splice(index, 1);
      renderCard();
      renderSidebar();
    });

    itemCard.addEventListener("click", () => {
      activeFocusedRowIndex = index;
      document.querySelectorAll(".item-editor-card").forEach((c) => c.classList.remove("active-focus"));
      itemCard.classList.add("active-focus");
    });

    container.appendChild(itemCard);
  });

  if (container) {
    container.scrollTop = prevScrollTop;
  }
}

function addTableRowListeners(tr, tdPhoto, tdQty, tdContent, index) {
  // Photo cell click -> opens the searchable Gear Photo Database Picker!
  tdPhoto.addEventListener("click", (e) => {
    if (e.target.closest(".col-resize-handle")) return;
    activeFocusedRowIndex = index;
    openGearPhotoPickerModal(index);
  });

  // Drag & drop image directly onto photo cell
  tdPhoto.addEventListener("dragover", (e) => {
    e.preventDefault();
    tdPhoto.style.background = "rgba(88, 166, 255, 0.3)";
  });
  tdPhoto.addEventListener("dragleave", () => {
    tdPhoto.style.background = "";
  });
  tdPhoto.addEventListener("drop", (e) => {
    e.preventDefault();
    tdPhoto.style.background = "";
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleImageUpload(e.dataTransfer.files[0], index);
    }
  });

  // Inline edit listeners on table
  const qtyVal = tdQty.querySelector(".cell-qty-value");
  qtyVal.addEventListener("input", () => {
    currentCard.items[index].qty = qtyVal.innerText.trim();
    syncSidebarRow(index);
  });
  qtyVal.addEventListener("focus", () => {
    activeFocusedRowIndex = index;
  });

  const contentText = tdContent.querySelector(".cell-content-text");
  contentText.addEventListener("input", () => {
    const text = contentText.innerText;
    currentCard.items[index].content = text;
    syncSidebarRow(index);

    // Auto-match gear photo from database
    if (!currentCard.items[index].image) {
      const match = findGearInDatabase(text);
      if (match) {
        currentCard.items[index].image = match.image;
        renderCard();
        renderSidebar();
        showToastNotification(`Matched photo: "${match.name}"`, "✨");
      }
    } else if (
      text.trim().length >= 3 &&
      currentCard.items[index].image &&
      typeof currentCard.items[index].image === "string" &&
      currentCard.items[index].image.startsWith("data:image")
    ) {
      // Link custom photo to the typed description globally
      registerOrUpdateGlobalGear(text, currentCard.items[index].image, null, false);
    }
  });
  contentText.addEventListener("focus", () => {
    activeFocusedRowIndex = index;
  });
}

function updateRowQtyInCard(index, val) {
  const row = document.querySelector(`.card-row[data-index="${index}"]`);
  if (row) {
    const qtySpan = row.querySelector(".cell-qty-value");
    if (qtySpan) qtySpan.innerText = val;
  }
}

function updateRowContentInCard(index, val) {
  const row = document.querySelector(`.card-row[data-index="${index}"]`);
  if (row) {
    const contentDiv = row.querySelector(".cell-content-text");
    if (contentDiv) contentDiv.innerText = val;
  }
}

function syncSidebarRow(index) {
  const itemCard = document.querySelector(`.item-editor-card[data-index="${index}"]`);
  if (itemCard) {
    const qtyInput = itemCard.querySelector(".item-qty-field");
    const descInput = itemCard.querySelector(".item-desc-field");
    if (qtyInput) qtyInput.value = currentCard.items[index].qty || "";
    if (descInput)
      descInput.value = currentCard.items[index].content ? currentCard.items[index].content.replace(/\n/g, " ") : "";
  }
}

// --- IMAGE HANDLING & UPLOADS ---

// Large photos and screenshots are scaled down so they stay light to store and sync
const MAX_PHOTO_PX = 1000;

function downscaleImageDataUrl(dataUrl, mimeType) {
  return new Promise((resolve) => {
    if (mimeType === "image/svg+xml" || mimeType === "image/gif") {
      resolve(dataUrl);
      return;
    }
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth,
        h = img.naturalHeight;
      const scale = Math.min(1, MAX_PHOTO_PX / Math.max(w, h));
      if (scale === 1) {
        resolve(dataUrl);
        return;
      }
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      // PNG keeps transparency (cut-out product shots); everything else becomes JPEG
      resolve(mimeType === "image/png" ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", 0.9));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

function handleImageUpload(file, index) {
  if (!file || !file.type.startsWith("image/")) return;
  if (!currentCard.items[index]) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    const imgData = await downscaleImageDataUrl(e.target.result, file.type);
    if (!currentCard.items[index]) return;
    currentCard.items[index].image = imgData;

    // Auto-register in Global Gear DB if item has a description or placeholder
    const itemName = (currentCard.items[index].content || "").replace(/\n/g, " ").trim();
    if (itemName) {
      registerOrUpdateGlobalGear(itemName, imgData);
    }

    renderCard();
    renderSidebar();
    showToastNotification(`Photo applied & saved to Global Gear DB!`, "📸");
  };
  reader.readAsDataURL(file);
}

// Global Clipboard Paste (Ctrl+V)
// With the photo picker open, the photo goes to the row it was opened for
window.addEventListener("paste", (e) => {
  const items = e.clipboardData.items;
  // Text copied from Word/Excel can carry an image too: in a text field, paste the text
  const t = e.target;
  const inTextField = t && t.matches && (t.matches("input:not([type=file]), textarea") || t.isContentEditable);
  if (inTextField && e.clipboardData.types.includes("text/plain")) return;
  for (let i = 0; i < items.length; i++) {
    if (items[i].type.indexOf("image") !== -1) {
      const blob = items[i].getAsFile();
      // The gear edit dialog can sit on top of the picker, so it goes first
      if (isAddGearModalOpen()) {
        e.preventDefault();
        setGearPhotoFromFile(blob);
        break;
      }
      if (isGearPickerOpen()) {
        e.preventDefault();
        applyPickerPhotoFile(blob);
        break;
      }
      const targetIndex =
        activeFocusedRowIndex !== null ? activeFocusedRowIndex : currentCard.items.length > 0 ? 0 : null;
      if (targetIndex !== null) {
        handleImageUpload(blob, targetIndex);
      }
      break;
    }
  }
});

// --- PHYSICAL DIMENSIONS ---

function applyDimensionsToCard(preset) {
  const card = document.getElementById("flightcaseCard");
  let width = "148mm";
  let height = "210mm";

  const customW = document.getElementById("customWidth")
    ? document.getElementById("customWidth").value
    : currentCard.customWidth || 148;
  const customH = document.getElementById("customHeight")
    ? document.getElementById("customHeight").value
    : currentCard.customHeight || 210;

  switch (preset) {
    case "148x210":
      width = "148mm";
      height = "210mm";
      break;
    case "105x148":
      width = "105mm";
      height = "148mm";
      break;
    case "100x150":
      width = "100mm";
      height = "150mm";
      break;
    case "a4-strip-292":
      width = "97.5mm";
      height = "287mm";
      break; // 2 side by side fill A4 with 5 mm margin + gap
    case "a4-292":
      width = "205mm";
      height = "292mm";
      break;
    case "90x140":
      width = "90mm";
      height = "140mm";
      break;
    case "99x210":
      width = "99mm";
      height = "210mm";
      break;
    case "85x54":
      width = "85mm";
      height = "54mm";
      break;
    case "custom":
      width = `${customW}mm`;
      height = `${customH}mm`;
      currentCard.customWidth = customW;
      currentCard.customHeight = customH;
      break;
    default:
      width = "148mm";
      height = "210mm";
  }

  if (currentCard.orientation === "landscape") {
    const tmp = width;
    width = height;
    height = tmp;
  }

  card.style.setProperty("--card-width", width);
  card.style.setProperty("--card-height", height);
  card.style.width = width;
  card.style.height = height;
  document.documentElement.style.setProperty("--card-width", width);
  document.documentElement.style.setProperty("--card-height", height);

  const badge = document.getElementById("cardDimsBadge");
  if (badge) {
    badge.innerText = `${getDimensionLabel(preset)} (${currentCard.orientation || "Portrait"})`;
  }
}

function getDimensionLabel(preset) {
  switch (preset) {
    case "148x210":
      return "DIN A5 (148 × 210 mm — SME Standard)";
    case "105x148":
      return "DIN A6 (105 × 148 mm — Pouch)";
    case "100x150":
      return "100 × 150 mm (Pouch)";
    case "a4-strip-292":
      return "Long card, 2 per A4 (97.5 × 287 mm)";
    case "a4-292":
      return "DIN A4 Full (205 × 292 mm)";
    case "90x140":
      return "90 × 140 mm (Peli 1510)";
    case "99x210":
      return "DIN DL (99 × 210 mm)";
    case "85x54":
      return "Card (85 × 54 mm)";
    case "custom": {
      const w = document.getElementById("customWidth")
        ? document.getElementById("customWidth").value
        : currentCard.customWidth || 148;
      const h = document.getElementById("customHeight")
        ? document.getElementById("customHeight").value
        : currentCard.customHeight || 210;
      return `Custom ${w} × ${h} mm`;
    }
    default:
      return "DIN A5 (148 × 210 mm — SME Standard)";
  }
}

// --- FONT SIZE SCALING & PRINTER SAFETY MARGIN CONTROLLERS ---

function applyFontScaleToCard(scale, updateControls = true) {
  const numScale = Math.max(0.6, Math.min(2.0, parseFloat(scale) || 1.0));
  currentCard.fontScale = numScale;

  const card = document.getElementById("flightcaseCard");
  if (card) {
    card.style.setProperty("--card-font-scale", numScale);
  }
  document.documentElement.style.setProperty("--card-font-scale", numScale);

  const pct = Math.round(numScale * 100);
  const px = (11.5 * numScale).toFixed(1);
  const valDisplay = document.getElementById("fontSizeSliderValue");
  if (valDisplay) {
    valDisplay.innerText = `${pct}% (${px}px)`;
  }

  if (updateControls) {
    const slider = document.getElementById("fontSizeSlider");
    if (slider && parseInt(slider.value, 10) !== pct) {
      slider.value = pct;
    }
  }

  document.querySelectorAll(".font-preset-btn").forEach((btn) => {
    btn.classList.toggle("active", parseInt(btn.dataset.scale, 10) === pct);
  });

  saveActiveCardState();
}

function applyPrinterMarginToCard(marginMm, updateControls = true) {
  const numMargin = Math.max(
    0,
    Math.min(25, parseFloat(marginMm) !== undefined && !isNaN(parseFloat(marginMm)) ? parseFloat(marginMm) : 5),
  );
  currentCard.printerMargin = numMargin;

  const card = document.getElementById("flightcaseCard");
  if (card) {
    card.style.setProperty("--printer-margin", `${numMargin}mm`);
  }
  document.documentElement.style.setProperty("--printer-margin", `${numMargin}mm`);

  if (updateControls) {
    const slider = document.getElementById("printerMarginSlider");
    if (slider && parseFloat(slider.value) !== numMargin) {
      slider.value = numMargin;
    }
    const numInput = document.getElementById("printerMarginInput");
    if (numInput && parseFloat(numInput.value) !== numMargin) {
      numInput.value = numMargin;
    }
  }

  const valDisplay = document.getElementById("printerMarginValue");
  if (valDisplay) {
    valDisplay.innerText = `${numMargin} mm${numMargin === 5 ? " (Standard)" : ""}`;
  }

  const guide = document.getElementById("printerMarginGuide");
  if (guide) {
    guide.setAttribute("data-label", `${numMargin}mm Safety Margin`);
    guide.setAttribute("title", `Safety margin: ${numMargin}mm`);
  }

  saveActiveCardState();
}

function togglePrinterMarginGuide(show) {
  currentCard.showMarginGuide = !!show;
  const guide = document.getElementById("printerMarginGuide");
  if (guide) {
    guide.classList.toggle("hidden", !currentCard.showMarginGuide);
  }
  const checkbox = document.getElementById("showPrinterMarginGuide");
  if (checkbox && checkbox.checked !== currentCard.showMarginGuide) {
    checkbox.checked = currentCard.showMarginGuide;
  }
  saveActiveCardState();
}

// --- LOGO & QR CODE ---

function renderFooterLogo() {
  const logoDisplay = document.getElementById("footerLogoDisplay");
  const logoType = currentCard.logo || "sme-live";

  if (logoType === "sme-live") {
    // Official Stream My Event logo combination
    logoDisplay.innerHTML = `<img src="assets/sme-logo.svg" alt="Stream My Event" class="footer-logo-img">`;
  } else if (logoType === "av-red") {
    logoDisplay.innerHTML = `<svg viewBox="0 0 40 24" class="logo-icon-svg">
      <polygon points="4,22 14,2 20,2 10,22" fill="#d90429"></polygon>
      <polygon points="16,22 26,2 32,2 22,22" fill="#d90429"></polygon>
    </svg>`;
  } else if (logoType === "generic-blue") {
    logoDisplay.innerHTML = `<svg viewBox="0 0 24 24" class="logo-icon-svg" fill="#0284c7">
      <path d="M12 2L3 7v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5z"/>
    </svg>`;
  } else if (logoType === "broadcast-amber") {
    logoDisplay.innerHTML = `<svg viewBox="0 0 24 24" class="logo-icon-svg" fill="#f59e0b">
      <path d="M12 3a9 9 0 0 0-9 9 9 9 0 0 0 9 9 9 9 0 0 0 9-9 9 9 0 0 0-9-9zm0 16a7 7 0 1 1 0-14 7 7 0 0 1 0 14z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>`;
  } else if (
    typeof logoType === "string" &&
    (logoType.startsWith("data:image") || logoType.startsWith("http") || logoType.startsWith("blob:"))
  ) {
    logoDisplay.innerHTML = imageHtml(logoType, 'alt="" class="footer-logo-img"');
  }
}

function updateQrCodeDisplay() {
  const qrWrap = document.getElementById("footerQrWrap");
  const qrContainer = document.getElementById("footerQrCode");
  const enableQr = document.getElementById("enableQrCode").checked;
  const qrUrl = document.getElementById("qrUrlInput").value || "https://astera-led.com";

  if (enableQr) {
    qrWrap.style.display = "block";
    qrContainer.innerHTML = "";
    if (window.QRCode) {
      new QRCode(qrContainer, {
        text: qrUrl,
        width: 32,
        height: 32,
        colorDark: "#000000",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.M,
      });
    }
  } else {
    qrWrap.style.display = "none";
  }
}

// --- TOAST NOTIFICATIONS & GLOBAL DB HELPERS ---

function showToastNotification(message, icon = "✅", type = "success") {
  let container = document.querySelector(".app-toast-container");
  if (!container) {
    container = document.createElement("div");
    container.className = "app-toast-container";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.className = `app-toast ${type === "info" ? "toast-info" : type === "warning" ? "toast-warning" : type === "error" ? "toast-error" : ""}`;
  toast.innerHTML = `<span>${icon}</span> <span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("hide");
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}

function detectCategoryFromName(name) {
  const n = (name || "").toLowerCase();
  if (
    n.includes("cable") ||
    n.includes("sdi") ||
    n.includes("hdmi") ||
    n.includes("dmx") ||
    n.includes("powercon") ||
    n.includes("c13") ||
    n.includes("schuko") ||
    n.includes("xlr") ||
    n.includes("cat6") ||
    n.includes("bnc") ||
    n.includes("true1")
  ) {
    return "cables";
  }
  if (
    n.includes("light") ||
    n.includes("lamp") ||
    n.includes("astera") ||
    n.includes("aputure") ||
    n.includes("fresnel") ||
    n.includes("diffus") ||
    n.includes("lens") ||
    n.includes("softbox") ||
    n.includes("dome") ||
    n.includes("lantern") ||
    n.includes("spot")
  ) {
    return "lighting";
  }
  if (
    n.includes("clamp") ||
    n.includes("arm") ||
    n.includes("hook") ||
    n.includes("rig") ||
    n.includes("stand") ||
    n.includes("tripod") ||
    n.includes("spigot") ||
    n.includes("bracket") ||
    n.includes("mount")
  ) {
    return "rigging";
  }
  if (
    n.includes("mic") ||
    n.includes("audio") ||
    n.includes("wireless") ||
    n.includes("speaker") ||
    n.includes("receiver") ||
    n.includes("transmitter") ||
    n.includes("skm") ||
    n.includes("sm58")
  ) {
    return "audio";
  }
  if (
    n.includes("camera") ||
    n.includes("switcher") ||
    n.includes("atem") ||
    n.includes("monitor") ||
    n.includes("screen") ||
    n.includes("video") ||
    n.includes("fx6") ||
    n.includes("ssd")
  ) {
    return "video";
  }
  if (
    n.includes("battery") ||
    n.includes("power") ||
    n.includes("v-mount") ||
    n.includes("charger") ||
    n.includes("supply") ||
    n.includes("bpu") ||
    n.includes("ba70")
  ) {
    return "power";
  }
  return "accessories";
}

function registerOrUpdateGlobalGear(name, imageData, category = null, notify = true) {
  // No image (or an old stock icon) means nothing to save: never create a photo-less entry or blank out a photo
  if (!name || typeof imageData !== "string" || !imageData.trim() || isFillerIcon(imageData)) return;
  const cleanName = name.replace(/\n/g, " ").trim();
  if (!cleanName || cleanName.length < 2) return;

  const t = cleanName.toLowerCase();

  // Look for existing item in customGearDb
  const existingIdx = Array.isArray(customGearDb)
    ? customGearDb.findIndex(
        (g) =>
          (g && g.name && typeof g.name === "string" && g.name.toLowerCase() === t) ||
          (g && Array.isArray(g.aliases) && g.aliases.some((a) => typeof a === "string" && a.toLowerCase() === t)),
      )
    : -1;

  const aliases = [t];
  cleanName.split(/[\s,/-]+/).forEach((word) => {
    const w = word.trim().toLowerCase();
    if (w.length >= 3 && !aliases.includes(w)) aliases.push(w);
  });

  const cat = category || detectCategoryFromName(cleanName);

  if (existingIdx >= 0) {
    // A built-in placeholder icon never replaces a real photo the user already has
    const current = customGearDb[existingIdx].image;
    const hasRealPhoto = typeof current === "string" && current.trim() !== "" && !isFillerIcon(current);
    if (!(hasRealPhoto && isFillerIcon(imageData))) customGearDb[existingIdx].image = imageData;
    if (!customGearDb[existingIdx].aliases) customGearDb[existingIdx].aliases = [];
    aliases.forEach((a) => {
      if (!customGearDb[existingIdx].aliases.includes(a)) {
        customGearDb[existingIdx].aliases.push(a);
      }
    });
    customGearDb[existingIdx].isCustom = true;
  } else {
    // Check if matches default catalog item
    const defaultMatch = DEFAULT_GEAR_DATABASE.find(
      (d) => d.name.toLowerCase() === t || (d.aliases && d.aliases.includes(t)),
    );

    if (defaultMatch) {
      customGearDb.push({
        ...defaultMatch,
        name: cleanName,
        category: cat,
        image: imageData,
        isCustom: true,
      });
    } else {
      customGearDb.push({
        id: "custom-" + Date.now() + "-" + Math.random().toString(36).substr(2, 4),
        name: cleanName,
        category: cat,
        aliases: aliases,
        image: imageData,
        isCustom: true,
      });
    }
  }

  saveCustomGearToStorage();
  try {
    renderGearDbTabList();
  } catch (e) {
    console.error("renderGearDbTabList error:", e);
  }
  if (notify) {
    showToastNotification(`Saved "${cleanName}" to Global Equipment DB!`, "💾");
  }
}

// --- GEAR PHOTO DATABASE MODULE ---

let editingGearItemId = null;

// Gear photos live in the photo store (IndexedDB); the gear list in localStorage keeps
// "cardimg:" references, like saved cards, so it stays far below the ~5 MB limit
function gearDbSnapshot(list) {
  return list.map((g) => {
    if (!g || typeof g.image !== "string") return g;
    const big = g.image.startsWith("data:") || (g.image.startsWith("<svg") && g.image.length > 8192);
    if (!big) return g;
    const ref = storeCardImage(g.image);
    return ref ? { ...g, image: ref } : g;
  });
}

function writeGearDbLocal() {
  localStorage.setItem("flightcase_gear_db", JSON.stringify(gearDbSnapshot(customGearDb)));
}

function loadGearDatabase() {
  const saved = localStorage.getItem("flightcase_gear_db");
  if (saved) {
    try {
      customGearDb = JSON.parse(saved);
      if (!Array.isArray(customGearDb)) customGearDb = [];
      customGearDb.forEach((g) => {
        if (g && typeof g.image === "string" && g.image.startsWith(CARD_IMAGE_REF)) {
          g.image = cardImageCache.get(g.image.slice(CARD_IMAGE_REF.length)) || "";
        }
      });
      // Older versions kept the photos inline: move them to the photo store once
      if (saved.includes('"data:')) {
        try {
          writeGearDbLocal();
        } catch (e) {
          console.warn("Could not move gear photos to the photo store:", e);
        }
      }
    } catch (e) {
      customGearDb = [];
    }
  }
  updateGearDbCounters();
}

function saveCustomGearToStorage() {
  try {
    writeGearDbLocal();
    updateGearDbCounters();
    triggerAutoSyncGearDb();
  } catch (e) {
    if (e.name === "QuotaExceededError" || e.code === 22) {
      showToastNotification("Gear database could not be saved: browser storage is full.", "⚠️", "error");
      console.error("saveCustomGearToStorage: localStorage quota exceeded", e);
    } else {
      showToastNotification("Failed to save gear DB: " + (e.message || e), "❌", "error");
      console.error("saveCustomGearToStorage error:", e);
    }
  }
}

function getAllGearItems() {
  // Merge default and custom items; custom items with matching IDs override defaults
  const customMap = new Map();
  customGearDb.forEach((c) => customMap.set(c.id, c));

  const merged = [];
  DEFAULT_GEAR_DATABASE.forEach((def) => {
    if (customMap.has(def.id)) {
      const customItem = customMap.get(def.id);
      if (!customItem._deleted) {
        merged.push(customItem);
      }
      customMap.delete(def.id);
    } else {
      merged.push(def);
    }
  });

  // Append remaining custom items
  customMap.forEach((item) => {
    if (!item._deleted) {
      merged.push(item);
    }
  });

  return merged;
}

function updateGearDbCounters() {
  const total = getAllGearItems().length;
  const countSpan = document.getElementById("dbGearCount");
  if (countSpan) countSpan.innerText = total;
}

function initGearDatabaseModule() {
  // The "Gear" button in the left menu (#assetDbBtn) is itself a side panel tab

  // Sync Active Card Photos to Global DB button
  const syncBtn = document.getElementById("syncCardPhotosToDbBtn");
  if (syncBtn) {
    syncBtn.addEventListener("click", () => {
      let syncedCount = 0;
      currentCard.items.forEach((item) => {
        if (item.image && item.content && item.content.trim()) {
          registerOrUpdateGlobalGear(item.content, item.image, null, false);
          syncedCount++;
        }
      });
      if (syncedCount > 0) {
        showToastNotification(`Synced ${syncedCount} items & photos to Global Gear DB!`, "📥");
      } else {
        showToastNotification("No custom row photos found on this card to sync.", "ℹ️", "info");
      }
    });
  }

  // Gear DB Tab Search & Filter
  const searchInput = document.getElementById("gearDbSearchInput");
  const catFilter = document.getElementById("gearDbCategoryFilter");
  if (searchInput) searchInput.addEventListener("input", renderGearDbTabList);
  if (catFilter) catFilter.addEventListener("change", renderGearDbTabList);

  // Add New Gear Button
  document.getElementById("addNewGearItemBtn").addEventListener("click", () => openAddGearModal());
  document.getElementById("modalAddNewGearBtn").addEventListener("click", () => {
    openAddGearModal();
  });

  // Reset Gear Database Button
  const resetBtn = document.getElementById("resetGearDbBtn");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      if (confirm("Reset the Equipment Photo Database back to the factory catalog? Custom edits will be restored.")) {
        customGearDb = [];
        localStorage.removeItem("flightcase_gear_db");
        updateGearDbCounters();
        renderGearDbTabList();
        showToastNotification("Equipment Photo Database reset to factory default!", "↺");
      }
    });
  }

  // Modal Add/Edit Gear Handlers
  document.getElementById("closeAddGearModalBtn").addEventListener("click", () => {
    document.getElementById("addGearModal").classList.add("hidden");
  });
  document.getElementById("cancelAddGearBtn").addEventListener("click", () => {
    document.getElementById("addGearModal").classList.add("hidden");
  });

  // Edit / Crop Photo button inside Add/Edit Gear Modal
  const editPhotoBtn = document.getElementById("editCurrentGearPhotoBtn");
  if (editPhotoBtn) {
    editPhotoBtn.addEventListener("click", () => {
      if (!currentEditingGearPhoto) {
        alert("Please upload a photo first or select an item with a photo.");
        return;
      }
      openPhotoEditor(currentEditingGearPhoto, "Adjust & Crop Equipment Photo", (newPhotoData) => {
        currentEditingGearPhoto = newPhotoData;
        document.getElementById("newGearPhotoPreview").innerHTML = imageHtml(
          newPhotoData,
          'alt="" style="width:100%; height:100%; object-fit:contain;"',
        );
      });
    });
  }

  // Photo for the gear item: browse, drag & drop, or Ctrl+V (see the global paste handler)
  const gearFileInput = document.getElementById("newGearFileInput");
  gearFileInput.addEventListener("change", (e) => {
    if (e.target.files && e.target.files[0]) setGearPhotoFromFile(e.target.files[0]);
    gearFileInput.value = "";
  });

  const gearZone = document.getElementById("gearPhotoDropZone");
  if (gearZone) {
    gearZone.addEventListener("click", () => gearFileInput.click());
    gearZone.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        gearFileInput.click();
      }
    });
    gearZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      gearZone.classList.add("drag-over");
    });
    gearZone.addEventListener("dragleave", () => gearZone.classList.remove("drag-over"));
  }
  // A photo dropped anywhere on the dialog (zone, preview, fields) counts
  const addGearModalEl = document.getElementById("addGearModal");
  addGearModalEl.addEventListener("dragover", (e) => e.preventDefault());
  addGearModalEl.addEventListener("drop", (e) => {
    e.preventDefault();
    if (gearZone) gearZone.classList.remove("drag-over");
    if (e.dataTransfer.files && e.dataTransfer.files[0]) setGearPhotoFromFile(e.dataTransfer.files[0]);
  });

  // Save Add/Edit
  document.getElementById("saveNewGearBtn").addEventListener("click", () => {
    const name = document.getElementById("newGearName").value.trim();
    const category = document.getElementById("newGearCategory").value;
    const aliasesRaw = document.getElementById("newGearAliases").value;

    if (!name) {
      alert("Please enter a gear item name.");
      return;
    }

    const aliases = aliasesRaw
      .split(",")
      .map((a) => a.trim().toLowerCase())
      .filter((a) => a.length > 0);
    aliases.push(name.toLowerCase());

    const finalPhoto = currentEditingGearPhoto || "";

    if (editingGearItemId) {
      // Edit existing item
      const previousItem = getAllGearItems().find((g) => g.id === editingGearItemId);
      const existingIdx = customGearDb.findIndex((g) => g.id === editingGearItemId);
      const updatedItem = {
        id: editingGearItemId,
        name: name,
        category: category,
        aliases: aliases,
        image: currentEditingGearPhoto || (previousItem ? previousItem.image : ""),
        isCustom: true,
      };

      if (existingIdx >= 0) {
        customGearDb[existingIdx] = updatedItem;
      } else {
        customGearDb.push(updatedItem);
      }
      saveCustomGearToStorage();
      renderGearDbTabList();
      document.getElementById("addGearModal").classList.add("hidden");
      showToastNotification(`"${name}" updated in Global Gear DB!`, "💾");
    } else {
      // New item
      const newGear = {
        id: "custom-" + Date.now(),
        name: name,
        category: category,
        aliases: aliases,
        image: finalPhoto,
        isCustom: true,
      };

      customGearDb.push(newGear);
      saveCustomGearToStorage();
      renderGearDbTabList();
      document.getElementById("addGearModal").classList.add("hidden");
      showToastNotification(`"${name}" saved to Global Equipment DB!`, "💾");
    }

    // If opened from a row photo picker, apply immediately to that row
    if (pendingRowPhotoTargetIndex !== null && currentCard.items[pendingRowPhotoTargetIndex]) {
      currentCard.items[pendingRowPhotoTargetIndex].image = finalPhoto;
      if (!currentCard.items[pendingRowPhotoTargetIndex].content) {
        currentCard.items[pendingRowPhotoTargetIndex].content = formatDescriptionForCard(name);
      }
      renderCard();
      renderSidebar();
      document.getElementById("gearPickerModal").classList.add("hidden");
    }
  });

  // Delete Gear Button
  const deleteBtn = document.getElementById("deleteGearBtn");
  if (deleteBtn) {
    deleteBtn.addEventListener("click", () => {
      if (editingGearItemId && confirm("Are you sure you want to delete this gear item from your database?")) {
        const existingIdx = customGearDb.findIndex((g) => g.id === editingGearItemId);
        if (existingIdx >= 0) {
          customGearDb.splice(existingIdx, 1);
        } else {
          // Mark default item as deleted
          customGearDb.push({ id: editingGearItemId, _deleted: true });
        }
        saveCustomGearToStorage();
        renderGearDbTabList();
        document.getElementById("addGearModal").classList.add("hidden");
        showToastNotification("Gear item removed from database.", "🗑️", "info");
      }
    });
  }

  // Modal Gear Quick Picker Handlers
  document.getElementById("closeGearPickerModalBtn").addEventListener("click", () => {
    document.getElementById("gearPickerModal").classList.add("hidden");
  });

  const modalSearch = document.getElementById("modalGearSearchInput");
  const modalCat = document.getElementById("modalGearCategoryFilter");
  if (modalSearch) modalSearch.addEventListener("input", renderModalGearPickerGrid);
  if (modalCat) modalCat.addEventListener("change", renderModalGearPickerGrid);
  initPhotoDropZone();

  renderGearDbTabList();
}

// ==========================================================================
// PHOTO CROP, SCALE & ROTATE ENGINE
// ==========================================================================
let photoEditorLoadedImage = null;
let photoEditorScale = 100;
let photoEditorRotation = 0;
let photoEditorOffsetX = 0;
let photoEditorOffsetY = 0;
let photoEditorFlipH = false;
let photoEditorFlipV = false;
let photoEditorOnApplyCallback = null;
let isDraggingPhoto = false;
let dragStartX = 0;
let dragStartY = 0;
let dragStartOffsetX = 0;
let dragStartOffsetY = 0;

function openPhotoEditor(imageSource, modalTitle, onApplyCallback) {
  if (!imageSource) {
    alert("Please select or upload a photo first to edit.");
    return;
  }

  photoEditorOnApplyCallback = onApplyCallback;
  const titleEl = document.getElementById("photoEditorModalTitle");
  if (titleEl) titleEl.innerText = modalTitle || "Adjust, Crop & Rotate Photo";

  const srcUrl = safeImageSrc(imageSource);

  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    photoEditorLoadedImage = img;
    photoEditorScale = 100;
    photoEditorRotation = 0;
    photoEditorOffsetX = 0;
    photoEditorOffsetY = 0;
    photoEditorFlipH = false;
    photoEditorFlipV = false;

    const scaleSlider = document.getElementById("photoScaleSlider");
    const scaleDisp = document.getElementById("photoScaleValueDisplay");
    const rotSlider = document.getElementById("photoRotateSlider");
    const rotDisp = document.getElementById("photoRotateValueDisplay");

    if (scaleSlider) scaleSlider.value = 100;
    if (scaleDisp) scaleDisp.innerText = "100%";
    if (rotSlider) rotSlider.value = 0;
    if (rotDisp) rotDisp.innerText = "0°";

    drawPhotoEditorCanvas();
    document.getElementById("photoEditorModal").classList.remove("hidden");
  };
  img.onerror = () => {
    alert("Unable to load image for cropping.");
  };
  img.src = srcUrl;
}

function drawPhotoEditorCanvas() {
  const canvas = document.getElementById("photoEditorCanvas");
  if (!canvas || !photoEditorLoadedImage) return;
  const ctx = canvas.getContext("2d");
  const cw = canvas.width;
  const ch = canvas.height;

  // Transparent: the checkerboard behind the canvas shows the empty area
  ctx.clearRect(0, 0, cw, ch);

  ctx.save();
  ctx.translate(cw / 2 + photoEditorOffsetX, ch / 2 + photoEditorOffsetY);
  ctx.rotate((photoEditorRotation * Math.PI) / 180);
  ctx.scale(photoEditorFlipH ? -1 : 1, photoEditorFlipV ? -1 : 1);

  const imgW = photoEditorLoadedImage.naturalWidth || photoEditorLoadedImage.width || 200;
  const imgH = photoEditorLoadedImage.naturalHeight || photoEditorLoadedImage.height || 200;
  const maxDim = Math.max(imgW, imgH);
  const baseScale = maxDim > 0 ? 240 / maxDim : 1;
  const currentScale = baseScale * (photoEditorScale / 100);

  const drawW = imgW * currentScale;
  const drawH = imgH * currentScale;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(photoEditorLoadedImage, -drawW / 2, -drawH / 2, drawW, drawH);
  ctx.restore();
}

function initPhotoEditorModule() {
  const canvas = document.getElementById("photoEditorCanvas");
  if (!canvas) return;

  const startDrag = (clientX, clientY) => {
    isDraggingPhoto = true;
    dragStartX = clientX;
    dragStartY = clientY;
    dragStartOffsetX = photoEditorOffsetX;
    dragStartOffsetY = photoEditorOffsetY;
  };

  const moveDrag = (clientX, clientY) => {
    if (!isDraggingPhoto) return;
    photoEditorOffsetX = dragStartOffsetX + (clientX - dragStartX);
    photoEditorOffsetY = dragStartOffsetY + (clientY - dragStartY);
    drawPhotoEditorCanvas();
  };

  const stopDrag = () => {
    isDraggingPhoto = false;
  };

  canvas.addEventListener("mousedown", (e) => startDrag(e.clientX, e.clientY));
  window.addEventListener("mousemove", (e) => moveDrag(e.clientX, e.clientY));
  window.addEventListener("mouseup", stopDrag);

  canvas.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches && e.touches[0]) startDrag(e.touches[0].clientX, e.touches[0].clientY);
    },
    { passive: false },
  );
  window.addEventListener(
    "touchmove",
    (e) => {
      if (e.touches && e.touches[0]) moveDrag(e.touches[0].clientX, e.touches[0].clientY);
    },
    { passive: false },
  );
  window.addEventListener("touchend", stopDrag);

  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 6 : -6;
      let newScale = Math.min(400, Math.max(20, photoEditorScale + delta));
      photoEditorScale = newScale;
      const scaleSlider = document.getElementById("photoScaleSlider");
      const scaleDisp = document.getElementById("photoScaleValueDisplay");
      if (scaleSlider) scaleSlider.value = newScale;
      if (scaleDisp) scaleDisp.innerText = `${newScale}%`;
      drawPhotoEditorCanvas();
    },
    { passive: false },
  );

  const scaleSlider = document.getElementById("photoScaleSlider");
  const scaleDisp = document.getElementById("photoScaleValueDisplay");
  if (scaleSlider) {
    scaleSlider.addEventListener("input", (e) => {
      photoEditorScale = parseInt(e.target.value, 10);
      if (scaleDisp) scaleDisp.innerText = `${photoEditorScale}%`;
      drawPhotoEditorCanvas();
    });
  }

  const zoomInBtn = document.getElementById("photoZoomInBtn");
  if (zoomInBtn) {
    zoomInBtn.addEventListener("click", () => {
      photoEditorScale = Math.min(400, photoEditorScale + 15);
      if (scaleSlider) scaleSlider.value = photoEditorScale;
      if (scaleDisp) scaleDisp.innerText = `${photoEditorScale}%`;
      drawPhotoEditorCanvas();
    });
  }

  const zoomOutBtn = document.getElementById("photoZoomOutBtn");
  if (zoomOutBtn) {
    zoomOutBtn.addEventListener("click", () => {
      photoEditorScale = Math.max(20, photoEditorScale - 15);
      if (scaleSlider) scaleSlider.value = photoEditorScale;
      if (scaleDisp) scaleDisp.innerText = `${photoEditorScale}%`;
      drawPhotoEditorCanvas();
    });
  }

  const rotSlider = document.getElementById("photoRotateSlider");
  const rotDisp = document.getElementById("photoRotateValueDisplay");
  if (rotSlider) {
    rotSlider.addEventListener("input", (e) => {
      photoEditorRotation = parseInt(e.target.value, 10);
      if (rotDisp) rotDisp.innerText = `${photoEditorRotation}°`;
      drawPhotoEditorCanvas();
    });
  }

  const rotLBtn = document.getElementById("rotateLeft90Btn");
  if (rotLBtn) {
    rotLBtn.addEventListener("click", () => {
      let r = photoEditorRotation - 90;
      if (r < -180) r += 360;
      photoEditorRotation = r;
      if (rotSlider) rotSlider.value = r;
      if (rotDisp) rotDisp.innerText = `${r}°`;
      drawPhotoEditorCanvas();
    });
  }

  const rotRBtn = document.getElementById("rotateRight90Btn");
  if (rotRBtn) {
    rotRBtn.addEventListener("click", () => {
      let r = photoEditorRotation + 90;
      if (r > 180) r -= 360;
      photoEditorRotation = r;
      if (rotSlider) rotSlider.value = r;
      if (rotDisp) rotDisp.innerText = `${r}°`;
      drawPhotoEditorCanvas();
    });
  }

  const flipHBtn = document.getElementById("flipHBtn");
  if (flipHBtn) {
    flipHBtn.addEventListener("click", () => {
      photoEditorFlipH = !photoEditorFlipH;
      drawPhotoEditorCanvas();
    });
  }

  const flipVBtn = document.getElementById("flipVBtn");
  if (flipVBtn) {
    flipVBtn.addEventListener("click", () => {
      photoEditorFlipV = !photoEditorFlipV;
      drawPhotoEditorCanvas();
    });
  }

  const fitBtn = document.getElementById("fitPhotoBtn");
  if (fitBtn) {
    fitBtn.addEventListener("click", () => {
      photoEditorScale = 100;
      photoEditorOffsetX = 0;
      photoEditorOffsetY = 0;
      if (scaleSlider) scaleSlider.value = 100;
      if (scaleDisp) scaleDisp.innerText = "100%";
      drawPhotoEditorCanvas();
    });
  }

  const resetBtn = document.getElementById("resetPhotoAdjustBtn");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      photoEditorScale = 100;
      photoEditorRotation = 0;
      photoEditorOffsetX = 0;
      photoEditorOffsetY = 0;
      photoEditorFlipH = false;
      photoEditorFlipV = false;
      if (scaleSlider) scaleSlider.value = 100;
      if (rotSlider) rotSlider.value = 0;
      if (scaleDisp) scaleDisp.innerText = "100%";
      if (rotDisp) rotDisp.innerText = "0°";
      drawPhotoEditorCanvas();
    });
  }

  const closeBtn = document.getElementById("closePhotoEditorModalBtn");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      document.getElementById("photoEditorModal").classList.add("hidden");
    });
  }

  const cancelBtn = document.getElementById("cancelPhotoEditorBtn");
  if (cancelBtn) {
    cancelBtn.addEventListener("click", () => {
      document.getElementById("photoEditorModal").classList.add("hidden");
    });
  }

  const applyBtn = document.getElementById("applyPhotoEditorBtn");
  if (applyBtn) {
    applyBtn.addEventListener("click", () => {
      if (!photoEditorLoadedImage) return;

      const exportCanvas = document.createElement("canvas");
      exportCanvas.width = 600;
      exportCanvas.height = 600;
      const eCtx = exportCanvas.getContext("2d");

      const scaleFactor = 600 / 280;

      eCtx.save();
      eCtx.translate(300 + photoEditorOffsetX * scaleFactor, 300 + photoEditorOffsetY * scaleFactor);
      eCtx.rotate((photoEditorRotation * Math.PI) / 180);
      eCtx.scale(photoEditorFlipH ? -1 : 1, photoEditorFlipV ? -1 : 1);

      const imgW = photoEditorLoadedImage.naturalWidth || photoEditorLoadedImage.width || 200;
      const imgH = photoEditorLoadedImage.naturalHeight || photoEditorLoadedImage.height || 200;
      const maxDim = Math.max(imgW, imgH);
      const baseScale = maxDim > 0 ? 240 / maxDim : 1;
      const currentScale = baseScale * (photoEditorScale / 100) * scaleFactor;

      const drawW = imgW * currentScale;
      const drawH = imgH * currentScale;

      eCtx.imageSmoothingEnabled = true;
      eCtx.imageSmoothingQuality = "high";
      eCtx.drawImage(photoEditorLoadedImage, -drawW / 2, -drawH / 2, drawW, drawH);
      eCtx.restore();

      const croppedDataUrl = exportCanvas.toDataURL("image/png", 0.95);

      if (photoEditorOnApplyCallback) {
        photoEditorOnApplyCallback(croppedDataUrl);
      }

      document.getElementById("photoEditorModal").classList.add("hidden");
      showToastNotification("Photo cropped, scaled & saved!", "✂️");
    });
  }
}

function openAddGearModal() {
  editingGearItemId = null;
  document.getElementById("addGearModalTitle").innerText = "Add gear to the database";

  // If opened while focused on a row, pre-fill the name
  let defaultName = "";
  if (pendingRowPhotoTargetIndex !== null && currentCard.items[pendingRowPhotoTargetIndex]) {
    defaultName = (currentCard.items[pendingRowPhotoTargetIndex].content || "").replace(/\n/g, " ").trim();
  }

  document.getElementById("newGearName").value = defaultName;
  document.getElementById("newGearCategory").value = detectCategoryFromName(defaultName);
  document.getElementById("newGearAliases").value = defaultName ? defaultName.toLowerCase() : "";
  currentEditingGearPhoto = null;
  document.getElementById("newGearPhotoPreview").innerHTML =
    `<span style="font-size:0.7rem; color:var(--text-muted);">No photo selected</span>`;
  document.getElementById("deleteGearBtn").classList.add("hidden");
  document.getElementById("addGearModal").classList.remove("hidden");
}

function openEditGearModal(item) {
  editingGearItemId = item.id;
  document.getElementById("addGearModalTitle").innerText = `Edit: ${item.name}`;
  document.getElementById("newGearName").value = item.name || "";
  document.getElementById("newGearCategory").value = item.category || "cables";
  document.getElementById("newGearAliases").value = item.aliases ? item.aliases.join(", ") : "";
  currentEditingGearPhoto = item.image;

  const imgHtml =
    imageHtml(item.image, 'alt="" style="width:100%; height:100%; object-fit:contain;"') ||
    `<span style="font-size:0.7rem; color:var(--text-muted);">No photo</span>`;
  document.getElementById("newGearPhotoPreview").innerHTML = imgHtml;
  document.getElementById("deleteGearBtn").classList.remove("hidden");
  document.getElementById("addGearModal").classList.remove("hidden");
}

function renderGearDbTabList() {
  const container = document.getElementById("gearDbItemsList");
  if (!container) return;

  const query = (document.getElementById("gearDbSearchInput").value || "").toLowerCase().trim();
  const category = document.getElementById("gearDbCategoryFilter").value;

  const allItems = getAllGearItems();
  const filtered = allItems.filter((item) => {
    if (!item) return false;
    if (category === "custom" && !item.isCustom) return false;
    if (category !== "all" && category !== "custom" && item.category !== category) return false;
    if (!query) return true;
    const name = (item.name || "").toLowerCase();
    const code = (item.code || "").toLowerCase();
    if (name.includes(query)) return true;
    if (code.includes(query)) return true;
    if (
      Array.isArray(item.aliases) &&
      item.aliases.some((a) =>
        String(a || "")
          .toLowerCase()
          .includes(query),
      )
    )
      return true;
    return false;
  });

  container.innerHTML = "";

  if (filtered.length === 0) {
    container.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1">No gear found for "${escapeHtml(query)}". Use "New gear" to add it.</div>`;
    return;
  }

  filtered.forEach((item) => {
    const card = document.createElement("div");
    card.className = "gear-tile";

    const imgHtml = imageHtml(item.image) || NO_IMAGE_HTML;

    card.innerHTML = `
      <div class="gear-tile-photo card-add-trigger" title="Add to card">${imgHtml}</div>
      <div class="gear-tile-name card-add-trigger" title="Add to card">${escapeHtml(item.name || "Equipment item")}</div>
      <div class="gear-tile-meta">
        <span>${item.code ? `<span class="rentman-code-tag">${escapeHtml(item.code)}</span>` : escapeHtml(item.category || "")}</span>
        ${item.source === "rentman" ? "<span>Rentman</span>" : ""}
      </div>
      <div class="gear-tile-actions">
        <button class="btn btn-secondary card-add-btn">Add to card</button>
        <button class="btn btn-secondary edit-gear-item-btn" title="Edit gear item" aria-label="Edit gear item" style="flex:0 0 34px">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"></path></svg>
        </button>
      </div>
    `;

    // Edit button click
    card.querySelector(".edit-gear-item-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      openEditGearModal(item);
    });

    // Add to card action
    const triggerAdd = () => {
      currentCard.items.push({
        id: String(Date.now()),
        qty: "1",
        content: formatDescriptionForCard(item.name),
        image: item.image,
      });
      renderCard();
      renderSidebar();
      showToastNotification(`Added "${item.name}" to card!`, "➕");
      card.classList.add("flash");
      setTimeout(() => card.classList.remove("flash"), 300);
    };

    card.querySelectorAll(".card-add-trigger").forEach((el) => el.addEventListener("click", triggerAdd));
    card.querySelector(".card-add-btn").addEventListener("click", triggerAdd);

    container.appendChild(card);
  });
}

function openGearPhotoPickerModal(rowIndex) {
  pendingRowPhotoTargetIndex = rowIndex;
  document.getElementById("gearPickerModal").classList.remove("hidden");
  document.getElementById("modalGearSearchInput").value = "";
  renderModalGearPickerGrid();
  // Focus the drop zone so Ctrl+V works right away
  const dropZone = document.getElementById("photoDropZone");
  if (dropZone) dropZone.focus();
}

function isAddGearModalOpen() {
  const modal = document.getElementById("addGearModal");
  return !!modal && !modal.classList.contains("hidden");
}

function setGearPhotoFromFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    showToastNotification("That isn't an image file.", "⚠️", "error");
    return;
  }
  const reader = new FileReader();
  reader.onload = async (ev) => {
    currentEditingGearPhoto = await downscaleImageDataUrl(ev.target.result, file.type);
    document.getElementById("newGearPhotoPreview").innerHTML = imageHtml(
      currentEditingGearPhoto,
      'alt="" style="width:100%; height:100%; object-fit:contain;"',
    );
  };
  reader.readAsDataURL(file);
}

function isGearPickerOpen() {
  const modal = document.getElementById("gearPickerModal");
  return !!modal && !modal.classList.contains("hidden") && pendingRowPhotoTargetIndex !== null;
}

// Own photo (dropped, pasted or browsed) for the row the picker was opened for
function applyPickerPhotoFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    showToastNotification("That isn't an image file.", "⚠️", "error");
    return;
  }
  const index = pendingRowPhotoTargetIndex;
  if (index === null || !currentCard.items[index]) return;
  document.getElementById("gearPickerModal").classList.add("hidden");
  handleImageUpload(file, index);
}

function initPhotoDropZone() {
  const zone = document.getElementById("photoDropZone");
  const fileInput = document.getElementById("photoDropFileInput");
  if (!zone || !fileInput) return;

  zone.addEventListener("click", () => fileInput.click());
  zone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInput.click();
    }
  });
  fileInput.addEventListener("change", () => {
    if (fileInput.files && fileInput.files[0]) applyPickerPhotoFile(fileInput.files[0]);
    fileInput.value = "";
  });

  zone.addEventListener("dragover", (e) => {
    e.preventDefault();
    zone.classList.add("drag-over");
  });
  zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("drag-over");
    if (e.dataTransfer.files && e.dataTransfer.files[0]) applyPickerPhotoFile(e.dataTransfer.files[0]);
  });

  // A photo dropped anywhere on the open picker counts too
  const modal = document.getElementById("gearPickerModal");
  modal.addEventListener("dragover", (e) => e.preventDefault());
  modal.addEventListener("drop", (e) => {
    if (e.target.closest("#photoDropZone")) return;
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) applyPickerPhotoFile(e.dataTransfer.files[0]);
  });
}

function renderModalGearPickerGrid() {
  const container = document.getElementById("modalGearGrid");
  if (!container) return;

  const query = (document.getElementById("modalGearSearchInput").value || "").toLowerCase().trim();
  const category = document.getElementById("modalGearCategoryFilter").value;

  const allItems = getAllGearItems();
  const filtered = allItems.filter((item) => {
    if (category !== "all" && item.category !== category) return false;
    if (!query) return true;
    if (item.name.toLowerCase().includes(query)) return true;
    if (item.code && item.code.toLowerCase().includes(query)) return true;
    if (item.aliases && item.aliases.some((a) => a.includes(query))) return true;
    return false;
  });

  container.innerHTML = "";

  if (filtered.length === 0) {
    container.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1">No gear found for "${escapeHtml(query)}".</div>`;
    return;
  }

  filtered.forEach((item) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "gear-tile";

    const imgHtml = imageHtml(item.image) || NO_IMAGE_HTML;

    card.innerHTML = `
      <span class="gear-tile-photo">${imgHtml}</span>
      <span class="gear-tile-name">${escapeHtml(item.name)}</span>
      <span class="gear-tile-meta">${item.code ? `<span class="rentman-code-tag">${escapeHtml(item.code)}</span>` : escapeHtml(item.category || "")}</span>
    `;

    card.addEventListener("click", () => {
      if (pendingRowPhotoTargetIndex !== null && currentCard.items[pendingRowPhotoTargetIndex]) {
        currentCard.items[pendingRowPhotoTargetIndex].image = item.image;
        if (!currentCard.items[pendingRowPhotoTargetIndex].content) {
          currentCard.items[pendingRowPhotoTargetIndex].content = formatDescriptionForCard(item.name);
        }
        renderCard();
        renderSidebar();
        showToastNotification(`Assigned photo: "${item.name}"`, "📸");
      }
      document.getElementById("gearPickerModal").classList.add("hidden");
    });

    container.appendChild(card);
  });
}

/** The gear item whose name or alias matches `name` at 90% or more (web/js/name-match.js), else null. */
function findGearByNameStrict(name) {
  return NameMatch.findGearByNameStrict(name, getAllGearItems());
}

/** A Rentman item's own photo, else the photo of a strict (90%+) database match, else "". Never a guess. */
function resolveRentmanImage(name, rentmanImg) {
  if (typeof rentmanImg === "string" && rentmanImg.trim() && !isFillerIcon(rentmanImg)) return rentmanImg;
  const match = findGearByNameStrict(name);
  return match && typeof match.image === "string" && match.image.trim() && !isFillerIcon(match.image)
    ? match.image
    : "";
}

function findGearInDatabase(term) {
  if (!term) return null;
  const raw = term.toLowerCase().trim();
  if (raw.length < 2) return null;

  const allItems = getAllGearItems();

  // 0. Exact code / item number match (Rentman code, e.g. "LIG-AX3", "CASE-AST-01")
  for (const item of allItems) {
    if (item && item.code && typeof item.code === "string") {
      const c = item.code.toLowerCase();
      if (c === raw || raw.includes(c)) return item;
    }
  }

  // 1. Exact alias match (e.g. "sdi", "c13", "true1", "ax3", "fresnel", "storm 80c")
  for (const item of allItems) {
    if (item && Array.isArray(item.aliases)) {
      if (item.aliases.some((a) => typeof a === "string" && a.toLowerCase() === raw)) {
        return item;
      }
    }
  }

  // 2. Exact name match
  for (const item of allItems) {
    if (item && item.name && typeof item.name === "string" && item.name.toLowerCase() === raw) {
      return item;
    }
  }

  // 3. Substring / Phrase match in aliases (e.g. "12G SDI cable 10m" contains "sdi")
  const words = raw.split(/[\s,./_-]+/).filter((w) => w.length >= 2);
  for (const item of allItems) {
    if (item && Array.isArray(item.aliases)) {
      for (const alias of item.aliases) {
        if (typeof alias === "string") {
          const a = alias.toLowerCase();
          if (raw.includes(a) && (a.length >= 3 || words.includes(a))) {
            return item;
          }
        }
      }
    }
  }

  // 4. Word match in item name
  for (const item of allItems) {
    if (item && item.name && typeof item.name === "string") {
      const itemWords = item.name
        .toLowerCase()
        .split(/[\s,./_-]+/)
        .filter((w) => w.length >= 3);
      const matchCount = words.filter((w) => itemWords.includes(w)).length;
      if (matchCount >= 2 || (words.length === 1 && itemWords.includes(words[0]))) {
        return item;
      }
    }
  }

  return null;
}

// --- WEBSHOP IMPORT ENGINE ---

function initWebImporter() {
  const modal = document.getElementById("webImportModal");
  const openBtn = document.getElementById("importWebBtn");
  const closeBtn = document.getElementById("closeWebImportModalBtn");
  const cancelBtn = document.getElementById("cancelWebImportBtn");
  const applyBtn = document.getElementById("applyWebImportBtn");

  const tabUrl = document.getElementById("importTabUrl");
  const tabRaw = document.getElementById("importTabRaw");
  const tabSample = document.getElementById("importTabSample");

  const paneUrl = document.getElementById("importPaneUrl");
  const paneRaw = document.getElementById("importPaneRaw");
  const paneSample = document.getElementById("importPaneSample");
  const tabRentman = document.getElementById("importTabRentman");
  const paneRentman = document.getElementById("importPaneRentman");

  openBtn.addEventListener("click", () => {
    modal.classList.remove("hidden");
  });

  closeBtn.addEventListener("click", () => modal.classList.add("hidden"));
  cancelBtn.addEventListener("click", () => modal.classList.add("hidden"));

  const resetImportTabs = () => {
    [tabUrl, tabRaw, tabSample, tabRentman].forEach((t) => t && t.classList.remove("active"));
    [paneUrl, paneRaw, paneSample, paneRentman].forEach((p) => p && p.classList.add("hidden"));
  };

  tabUrl.addEventListener("click", () => {
    resetImportTabs();
    tabUrl.classList.add("active");
    paneUrl.classList.remove("hidden");
  });

  tabRaw.addEventListener("click", () => {
    resetImportTabs();
    tabRaw.classList.add("active");
    paneRaw.classList.remove("hidden");
  });

  tabSample.addEventListener("click", () => {
    resetImportTabs();
    tabSample.classList.add("active");
    paneSample.classList.remove("hidden");
  });

  if (tabRentman && paneRentman) {
    tabRentman.addEventListener("click", () => {
      resetImportTabs();
      tabRentman.classList.add("active");
      paneRentman.classList.remove("hidden");
      renderRentmanQuickKits();
    });
  }

  document.getElementById("fetchWebshopUrlBtn").addEventListener("click", () => {
    const url = document.getElementById("webshopUrlInput").value.trim();
    if (!url) {
      alert("Please enter a product webpage URL.");
      return;
    }
    fetchProductFromUrl(url);
  });

  document.getElementById("parseRawTextBtn").addEventListener("click", () => {
    const rawText = document.getElementById("rawProductText").value;
    const title = document.getElementById("rawTextProductTitle").value;
    if (!rawText.trim()) {
      alert("Please paste the 'What's in the box' text.");
      return;
    }
    parseAndDisplayExtractedContent(title || "Product Package", rawText);
  });

  document.querySelectorAll(".sample-product-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const type = btn.dataset.sample;
      loadWebSampleData(type);
    });
  });

  applyBtn.addEventListener("click", () => {
    applyExtractedToCurrentCard();
    modal.classList.add("hidden");
  });

  document.getElementById("selectAllExtracted").addEventListener("change", (e) => {
    document.querySelectorAll(".extracted-item-check").forEach((cb) => (cb.checked = e.target.checked));
  });
}

async function fetchProductFromUrl(url) {
  const spinner = document.getElementById("fetchSpinner");
  spinner.classList.remove("hidden");

  try {
    let htmlText = "";
    let fetched = false;

    // 1. The page itself, fetched by the app (public addresses only)
    try {
      htmlText = await appCall("webshop.fetch", url);
      fetched = htmlText.length > 200;
    } catch (e) {
      console.warn("Page fetch error:", e);
    }

    // 2. Shopify stores have a JSON version of each product page
    if (!fetched && url.includes("/products/")) {
      try {
        const cleanProductUrl = url.split("?")[0].replace(/\/en-[A-Za-z]{2}/, "") + ".js";
        const shopifyData = JSON.parse(await appCall("webshop.fetch", cleanProductUrl));
        if (shopifyData && shopifyData.title) {
          parseAndDisplayExtractedContent(shopifyData.title, shopifyData.description || shopifyData.body_html || "");
          return;
        }
      } catch (e) {
        console.warn("Shopify JSON fetch error:", e);
      }
    }

    if (fetched && htmlText) {
      parseWebpageHtml(htmlText, url);
    } else {
      handleDomainSpecificExtraction(url);
    }
  } catch (err) {
    console.warn("Proxy extraction failed, using heuristic...", err);
    handleDomainSpecificExtraction(url);
  } finally {
    spinner.classList.add("hidden");
  }
}

function parseWebpageHtml(html, url) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  let productTitle = "";
  const ogTitle = doc.querySelector('meta[property="og:title"]');
  if (ogTitle && ogTitle.content) {
    productTitle = ogTitle.content;
  } else if (doc.querySelector("h1")) {
    productTitle = doc.querySelector("h1").innerText.trim();
  } else if (doc.title) {
    productTitle = doc.title;
  }

  productTitle = productTitle
    .replace(/\s*(\||\-|\–)\s*(Aputure|Vocas|Thomann|B&H|Bax Music|Sweetwater|Amazon).*/i, "")
    .trim();

  // If Aputure Storm page detected
  if (url.toLowerCase().includes("storm-80c") || productTitle.toLowerCase().includes("storm 80c")) {
    loadWebSampleData("aputure-storm");
    return;
  }

  let boxText = "";
  const keywords = [
    "in the box",
    "included",
    "package contents",
    "lieferumfang",
    "scope of delivery",
    "in de doos",
    "wat zit er in",
    "accessories included",
    "what's in the box",
    "kit includes",
    "packing list",
  ];

  const headings = doc.querySelectorAll("h2, h3, h4, strong, dt, th, .feature-title, .box-content, .in-the-box");
  for (const h of headings) {
    const txt = h.innerText.toLowerCase();
    if (keywords.some((k) => txt.includes(k))) {
      let sibling = h.nextElementSibling || h.parentElement;
      if (sibling) {
        boxText = sibling.innerText;
        break;
      }
    }
  }

  if (!boxText) {
    const listItems = doc.querySelectorAll("li, p");
    const matchedLines = [];
    listItems.forEach((li) => {
      const line = li.innerText.trim();
      if (/^(\d+)\s*(?:x|×|pcs|stuks|stk|pieces)\b/i.test(line) || /\b\d+\s*x\s+/i.test(line)) {
        matchedLines.push(line);
      }
    });
    if (matchedLines.length > 0) {
      boxText = matchedLines.join("\n");
    }
  }

  if (!boxText) {
    boxText = doc.body.innerText;
  }

  parseAndDisplayExtractedContent(productTitle, boxText);
}

function handleDomainSpecificExtraction(url) {
  const urlLower = url.toLowerCase();
  if (urlLower.includes("aputure") || urlLower.includes("storm") || urlLower.includes("vocas")) {
    loadWebSampleData("aputure-storm");
  } else if (urlLower.includes("astera")) {
    loadWebSampleData("astera");
  } else if (urlLower.includes("thomann") || urlLower.includes("sennheiser")) {
    loadWebSampleData("thomann-mics");
  } else if (urlLower.includes("bhphoto") || urlLower.includes("blackmagic")) {
    loadWebSampleData("bh-atem");
  } else {
    document.getElementById("importTabRaw").click();
    document.getElementById("rawTextProductTitle").value = "Imported Web Product";
    alert(
      "Website protected by strict Cloudflare headers. Please paste the 'In The Box' text directly into the RAW TEXT tab!",
    );
  }
}

function parseAndDisplayExtractedContent(title, rawText) {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const detectedItems = [];

  let mainTitle = title;
  let subtitle = "Case Content Kit";
  if (title.includes(" - ")) {
    const parts = title.split(" - ");
    mainTitle = parts[0].trim();
    subtitle = parts.slice(1).join(" ").trim();
  } else if (title.includes("Set") || title.includes("Kit") || title.includes("Pack")) {
    const parts = title.split(/\b(Set|Kit|Pack)\b/i);
    mainTitle = parts[0].trim();
    subtitle = (parts[1] || "") + (parts[2] || "");
  }

  lines.forEach((line) => {
    if (line.length < 3 || line.length > 140) return;
    if (/^(what's in the box|included in delivery|lieferumfang|features|specifications|dimensions)/i.test(line)) return;

    let qty = "1";
    let desc = line;

    const p1 = line.match(/^(\d+)\s*(?:x|×|pcs|pieces|stuks|stk|st)\.?\s*(.+)/i);
    const p2 = line.match(/^(.+?)\s*\(\s*(\d+)\s*(?:x|pcs|pieces|stuks)?\s*\)$/i);
    const p3 = line.match(/^(\d+)\s+([A-Za-z].+)/);
    const p4 = line.match(/(?:qty|quantity|aantal):\s*(\d+)\s*[-:]?\s*(.+)/i);

    if (p1) {
      qty = p1[1];
      desc = p1[2].replace(/^[-–:\s]+/, "");
    } else if (p2) {
      qty = p2[2];
      desc = p2[1].replace(/^[-–:\s]+/, "");
    } else if (p4) {
      qty = p4[1];
      desc = p4[2].replace(/^[-–:\s]+/, "");
    } else if (p3 && parseInt(p3[1]) <= 100) {
      qty = p3[1];
      desc = p3[2].replace(/^[-–:\s]+/, "");
    } else {
      desc = line.replace(/^[-*•\s]+/, "");
    }

    const matchedImage = resolveRentmanImage(desc, "");

    if (desc && desc.length >= 2) {
      detectedItems.push({
        id: String(Date.now() + Math.random()),
        qty: qty,
        content: formatDescriptionForCard(desc),
        image: matchedImage,
        selected: true,
      });
    }
  });

  if (detectedItems.length === 0) {
    detectedItems.push({
      id: "1",
      qty: "1",
      content: mainTitle,
      image: "",
      selected: true,
    });
  }

  extractedWebData = {
    title: mainTitle,
    subtitle: subtitle,
    items: detectedItems,
  };

  document.getElementById("importResultsSection").classList.remove("hidden");
  document.getElementById("extractedTitle").value = mainTitle;
  document.getElementById("extractedSubtitle").value = subtitle;
  document.getElementById("detectedItemsCountBadge").innerText =
    `${detectedItems.length} item${detectedItems.length === 1 ? "" : "s"} found`;
  document.getElementById("applyWebImportBtn").removeAttribute("disabled");

  const tableBody = document.getElementById("extractedItemsTableBody");
  tableBody.innerHTML = "";

  detectedItems.forEach((item, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input type="checkbox" class="extracted-item-check" data-idx="${idx}" checked aria-label="Include this item"></td>
      <td><div style="width:40px; height:40px; border-radius:8px; background:#fff; border:1px solid var(--border); display:flex; align-items:center; justify-content:center; overflow:hidden; color:#1d1d1f">${imageHtml(item.image)}</div></td>
      <td><input type="text" value="${escapeHtml(item.qty)}" class="ext-qty-input" aria-label="Quantity" style="text-align:center; font-family:var(--font-mono)"></td>
      <td><input type="text" value="${escapeHtml(item.content.replace(/\n/g, " "))}" class="ext-desc-input" aria-label="Description"></td>
    `;

    tr.querySelector(".ext-qty-input").addEventListener("input", (e) => {
      extractedWebData.items[idx].qty = e.target.value;
    });
    tr.querySelector(".ext-desc-input").addEventListener("input", (e) => {
      extractedWebData.items[idx].content = e.target.value;
    });

    tableBody.appendChild(tr);
  });
}

function formatDescriptionForCard(text) {
  if (text.length <= 18) return text;
  const words = text.split(" ");
  if (words.length <= 2) return text;

  const half = Math.ceil(words.length / 2);
  return words.slice(0, half).join(" ") + "\n" + words.slice(half).join(" ");
}

function applyExtractedToCurrentCard() {
  const title = document.getElementById("extractedTitle").value;
  const subtitle = document.getElementById("extractedSubtitle").value;

  const checks = document.querySelectorAll(".extracted-item-check");
  const selectedItems = [];

  checks.forEach((cb, idx) => {
    if (cb.checked && extractedWebData.items[idx]) {
      selectedItems.push(extractedWebData.items[idx]);
    }
  });

  if (selectedItems.length > 0 && selectedItems.length < 9) {
    selectedItems.push({
      id: String(Date.now()),
      qty: "",
      content: "",
      image: "",
    });
  }

  currentCard.title = title || "Equipment Case";
  currentCard.subtitle = subtitle || "Content Kit";
  currentCard.items = selectedItems;

  renderCard();
  renderSidebar();
}

function loadWebSampleData(type) {
  let title = "";
  let text = "";

  if (type === "aputure-storm") {
    title = "Aputure STORM 80c - 3-Light Kit";
    text = `3x Aputure STORM 80c Lamp Head (BLAIR-CG)
3x STORM 80c Hyper Reflector (Mini Pro Lock)
3x Aputure CF4 Fresnel with Barn Doors
3x STORM 80c Mini Lantern Diffuser
1x Aputure Quick Dome 40 Diffuser
3x Bowens Mount Adapter for STORM 80c
1x STORM 80c Handheld Bracket
3x Locking AC Power Cable 4.0m
3x D-Tap to Locking DC Power Cable 1.5m
3x Aputure Super Clamp with 5/8" Stud
3x Universal Magic Arm Mount
1x Hard-Shell Rolling Flightcase`;
  } else if (type === "astera") {
    title = "Astera AX3 - LightDrop 8-Way Set";
    text = `8x Astera Ax3 LightDrop
1x Schuko Male - IEC Female 1,5 meter
8x Astera Diffusor Lens 32°
8x Astera Diffusor Lens 120°
8x Astera Diffusor Lens 220°
8x Astera Hook with M4 thread
8x Astera Rubber Power socket plug
1x Astera ARC1 Infra-Red Remote Control`;
  } else if (type === "thomann-mics") {
    title = "Sennheiser EW-DX 835-S - Wireless Dual Mic Set";
    text = `1x Sennheiser EW-DX EM2 Dual Channel Stationary Receiver
2x Sennheiser EW-DX SKM-S Handheld Transmitter with MMD 835 Capsule
2x BNC 1/2 Wave Rod Antennas
2x Microphone Stand Clamps MZQ 1
1x NT 12-5 CW+ Universal Power Supply with EU/UK Adapters
2x GA 3 Rack Mount Kits`;
  } else if (type === "bh-atem") {
    title = "Blackmagic ATEM Mini Extreme ISO - Live Streaming Kit";
    text = `1x ATEM Mini Extreme ISO 8-Input HDMI Switcher
1x 12V 36W Power Supply with International Wall Adapters
2x High Speed 4K Micro-HDMI to Full HDMI Cables 2m
1x USB-C 3.2 Gen 2 Link Cable 1m
1x SanDisk Extreme Pro 1TB Portable SSD`;
  } else if (type === "bax-movinghead") {
    title = "Showtec Phantom 65 Spot - Flightcase Twin Set";
    text = `2x Showtec Phantom 65 LED Moving Head Spot Fixtures
2x Fast-Lock Quick-Release Omega Brackets
2x Safety Eyebolt Steel Wires 35kg Rating
2x PowerCON TRUE1 TOP Mains Input Cables 1.5m
2x DMX 3-Pin XLR Data Link Cables 3m`;
  }

  document.getElementById("importTabRaw").click();
  document.getElementById("rawTextProductTitle").value = title;
  document.getElementById("rawProductText").value = text;
  parseAndDisplayExtractedContent(title, text);
}

// --- STORAGE & LIBRARY ---

function loadSavedCasesFromStorage() {
  const list = document.getElementById("savedCasesList");
  if (!list) return;
  list.innerHTML = "";

  const cases = readLibrary();

  if (cases.length === 0) {
    list.innerHTML = `<p class="empty-state">No saved cards yet. Use "Save to library" (Ctrl+S) to keep the card you are working on.</p>`;
    return;
  }

  cases.forEach((c, idx) => {
    const item = document.createElement("div");
    item.className = "saved-case-item";
    item.innerHTML = `
      <div class="saved-case-thumb" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
      <div class="saved-case-info">
        <h4>${escapeHtml([c.title || "Untitled", c.subtitle].filter(Boolean).join(" · "))}</h4>
        <p>${c.items ? c.items.length : 0} items${c.company ? " · " + escapeHtml(c.company) : ""}</p>
      </div>
      <div class="btn-group-sm">
        <button class="btn btn-xs btn-secondary load-case-btn" title="Open this card">Load</button>
        <button class="btn btn-icon btn-xs export-single-btn" title="Export as JSON" aria-label="Export as JSON" style="width:32px;height:32px"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"></path></svg></button>
        <button class="btn btn-icon btn-xs del-case-btn" title="Delete" aria-label="Delete" style="width:32px;height:32px;color:var(--danger)"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"></path></svg></button>
      </div>
    `;

    item.querySelector(".load-case-btn").addEventListener("click", () => {
      currentCard = JSON.parse(JSON.stringify(c));
      renderCard();
      renderSidebar();
    });

    item.querySelector(".export-single-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      exportSingleCase(c);
    });

    item.querySelector(".del-case-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      cases.splice(idx, 1);
      writeLibrary(cases);
      loadSavedCasesFromStorage();
    });

    list.appendChild(item);
  });
}

function exportFlightcaseLibrary() {
  let cases = readLibrary();
  if (cases.length === 0) {
    cases = [currentCard];
  }

  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(cases, null, 2));
  const dlAnchor = document.createElement("a");
  const fileName = `Flightcases_Library_${new Date().toISOString().slice(0, 10)}.json`;
  dlAnchor.setAttribute("href", dataStr);
  dlAnchor.setAttribute("download", fileName);
  document.body.appendChild(dlAnchor);
  dlAnchor.click();
  dlAnchor.remove();
}

function exportSingleCase(caseObj) {
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(caseObj, null, 2));
  const dlAnchor = document.createElement("a");
  const safeTitle = (caseObj.title || "FlightCase").replace(/[^\w\-_]/g, "_");
  const fileName = `${safeTitle}_Case.json`;
  dlAnchor.setAttribute("href", dataStr);
  dlAnchor.setAttribute("download", fileName);
  document.body.appendChild(dlAnchor);
  dlAnchor.click();
  dlAnchor.remove();
}

function importFlightcaseJson(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const parsed = JSON.parse(e.target.result);
      let importedCases = [];
      if (Array.isArray(parsed)) {
        importedCases = parsed;
      } else if (parsed && typeof parsed === "object" && (parsed.title || parsed.items)) {
        importedCases = [parsed];
      } else {
        alert("Invalid JSON format. Expected flightcase card object or array.");
        return;
      }

      const cases = readLibrary();

      // Merge imported cases into library
      importedCases.forEach((newCase) => {
        const existingIdx = cases.findIndex((c) => c.title === newCase.title && c.subtitle === newCase.subtitle);
        if (existingIdx >= 0) {
          cases[existingIdx] = newCase;
        } else {
          cases.push(newCase);
        }
        triggerAutoSyncCase(newCase);
      });

      writeLibrary(cases);
      loadSavedCasesFromStorage();

      // Load first imported case onto preview
      if (importedCases.length > 0) {
        currentCard = JSON.parse(JSON.stringify(importedCases[0]));
        renderCard();
        renderSidebar();
      }

      alert(`Successfully imported ${importedCases.length} flightcase(s) into your library!`);
    } catch (err) {
      alert("Could not parse JSON file: " + err.message);
    }
  };
  reader.readAsText(file);
}

// Helper: strip large embedded images from a card snapshot to stay within localStorage quota.
// Images are re-matched from the Gear DB when the card is reloaded.
function stripImagesFromCardSnapshot(cardObj) {
  const snap = JSON.parse(JSON.stringify(cardObj));
  if (Array.isArray(snap.items)) {
    snap.items = snap.items.map((item) => {
      const img = item.image || "";
      // Move base64 photos and very large SVGs to the photo store; keep the built-in
      // vector icons (1–2 KB each) inline
      const isBig = img.startsWith("data:") || (img.startsWith("<svg") && img.length > 8192);
      if (isBig) {
        return { ...item, image: storeCardImage(img) };
      }
      return item;
    });
  }
  return snap;
}

function saveCurrentCaseToStorage() {
  const saved = localStorage.getItem("flightcase_library");
  let cases = [];
  if (saved) {
    try {
      cases = JSON.parse(saved);
    } catch (e) {
      cases = [];
    }
  }

  const cardSnapshot = stripImagesFromCardSnapshot(currentCard);

  const existingIndex = cases.findIndex((c) => c.title === currentCard.title && c.subtitle === currentCard.subtitle);
  if (existingIndex >= 0) {
    cases[existingIndex] = cardSnapshot;
  } else {
    cases.push(cardSnapshot);
  }

  try {
    localStorage.setItem("flightcase_library", JSON.stringify(cases));
    loadSavedCasesFromStorage();
    updateHeaderCardStatus();
    triggerAutoSyncCase(currentCard);
    showToastNotification(`💾 Saved "${currentCard.title} ${currentCard.subtitle}" to library!`, "💾");
  } catch (e) {
    if (e.name === "QuotaExceededError" || e.code === 22) {
      showToastNotification(
        "Storage full! Try removing old saved cases or clearing your browser cache.",
        "⚠️",
        "error",
      );
      console.error("saveCurrentCaseToStorage: localStorage quota exceeded", e);
    } else {
      showToastNotification("Save failed: " + (e.message || e), "❌", "error");
      console.error("saveCurrentCaseToStorage error:", e);
    }
  }
}

// --- PRINTING: ONE LAYOUT ENGINE FOR SINGLE AND MULTI-CARD PRINTS ---
//
// Every print builds exact-size pages in #printSheetContainer and sets
// @page { size: <paper>; margin: 0 }. The page margin and the cutting gap
// exist only in the slot math below, so nothing is applied twice and the
// browser never has to shrink or split a page.

const PAPER_SIZES_MM = {
  a4: { w: 210, h: 297, label: "A4" },
  a5: { w: 148, h: 210, label: "A5" },
  a6: { w: 105, h: 148, label: "A6" },
  letter: { w: 215.9, h: 279.4, label: "Letter" },
};

const PRINT_SETTINGS_KEY = "flightcase_print_settings";
const DEFAULT_PRINT_SETTINGS = {
  paper: "a4",
  orientation: "auto",
  perSheet: 2,
  marginMm: 5,
  gapMm: 5,
  cutLines: true,
  backgrounds: true,
};

// Physical card size in mm for a card object (mirrors applyDimensionsToCard)
function cardSizeMm(card) {
  const presets = {
    "148x210": [148, 210],
    "105x148": [105, 148],
    "100x150": [100, 150],
    "a4-strip-292": [97.5, 287],
    "a4-292": [205, 292],
    "90x140": [90, 140],
    "99x210": [99, 210],
    "85x54": [85, 54],
  };
  let size = presets[card.dimensions];
  if (!size && card.dimensions === "custom") {
    size = [parseFloat(card.customWidth) || 148, parseFloat(card.customHeight) || 210];
  }
  let [w, h] = size || [148, 210];
  if (card.orientation === "landscape") [w, h] = [h, w];
  return { w, h };
}

// Grids (cols x rows) that hold exactly n cards
function gridOptionsFor(n) {
  const out = [];
  for (let cols = 1; cols <= n; cols++) {
    if (n % cols === 0) out.push({ cols, rows: n / cols });
  }
  return out;
}

// Best placement of `perSheet` cells of cellW x cellH on the paper: tries both
// orientations and every grid, keeps the largest scale (portrait wins ties).
// paper "auto" means a page exactly the size of the cell, without margin.
// orientation: "auto" (best fit), "portrait" or "landscape" paper.
// Cards may be turned 90° on the sheet when that prints them larger
// (e.g. 2× A5 on portrait A4: stacked sideways at 95% instead of upright at 67%).
function computeSheetLayout({ paper, perSheet, cellW, cellH, marginMm, gapMm, orientation = "auto" }) {
  if (paper === "auto") {
    return {
      pageW: cellW,
      pageH: cellH,
      orientation: cellW > cellH ? "landscape" : "portrait",
      cols: 1,
      rows: 1,
      scale: 1,
      rotated: false,
      marginMm: 0,
      gapMm: 0,
      slots: [{ x: 0, y: 0, w: cellW, h: cellH }],
    };
  }
  const base = PAPER_SIZES_MM[paper] || PAPER_SIZES_MM.a4;
  const orientations =
    orientation === "portrait" || orientation === "landscape" ? [orientation] : ["portrait", "landscape"];
  let best = null;
  // Upright cards first, so on a tie they win over turned cards
  for (const rotated of [false, true]) {
    const footW = rotated ? cellH : cellW;
    const footH = rotated ? cellW : cellH;
    for (const o of orientations) {
      const pageW = o === "portrait" ? base.w : base.h;
      const pageH = o === "portrait" ? base.h : base.w;
      for (const { cols, rows } of gridOptionsFor(perSheet)) {
        const availW = pageW - 2 * marginMm - (cols - 1) * gapMm;
        const availH = pageH - 2 * marginMm - (rows - 1) * gapMm;
        if (availW <= 0 || availH <= 0) continue;
        const scale = Math.min(1, availW / (cols * footW), availH / (rows * footH));
        if (!best || scale > best.scale + 1e-9)
          best = { orientation: o, pageW, pageH, cols, rows, scale, rotated, footW, footH };
      }
    }
  }
  if (!best) return null;

  // Centre the whole block of cards on the page
  const w = best.footW * best.scale,
    h = best.footH * best.scale;
  const blockW = best.cols * w + (best.cols - 1) * gapMm;
  const blockH = best.rows * h + (best.rows - 1) * gapMm;
  const x0 = (best.pageW - blockW) / 2,
    y0 = (best.pageH - blockH) / 2;
  const slots = [];
  for (let r = 0; r < best.rows; r++) {
    for (let c = 0; c < best.cols; c++) {
      slots.push({ x: x0 + c * (w + gapMm), y: y0 + r * (h + gapMm), w, h });
    }
  }
  return { ...best, marginMm, gapMm, slots };
}

function loadPrintSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(PRINT_SETTINGS_KEY) || "{}");
    return { ...DEFAULT_PRINT_SETTINGS, ...saved };
  } catch (e) {
    return { ...DEFAULT_PRINT_SETTINGS };
  }
}

function savePrintSettings(settings) {
  try {
    localStorage.setItem(PRINT_SETTINGS_KEY, JSON.stringify(settings));
  } catch (e) {}
}

function getSavedLibraryCards() {
  return readLibrary();
}

// Cards saved before photos moved to the photo store (or without IndexedDB) lack their photos; restore them
// from the gear database, but only on an exact name or code match
function hydrateCardPhotos(card) {
  const gear = getAllGearItems();
  card.items.forEach((item) => {
    if (item.image) return;
    const lines = String(item.content || "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    const codeMatch = lines.length && /^\[(.+)\]$/.exec(lines[0]);
    const code = codeMatch ? codeMatch[1].toLowerCase() : "";
    const name = (codeMatch ? lines.slice(1) : lines).join(" ").toLowerCase();
    const hit = gear.find(
      (g) =>
        g &&
        g.image &&
        ((code && typeof g.code === "string" && g.code.toLowerCase() === code) ||
          (name && typeof g.name === "string" && g.name.toLowerCase() === name)),
    );
    if (hit) item.image = hit.image;
  });
  return card;
}

// Renders each card with the live renderer and returns detached clones
function renderCardClones(cards) {
  const original = currentCard;
  const source = document.getElementById("flightcaseCard");
  const clones = [];
  const wasSuspended = historySuspended;
  historySuspended = true; // rendering other cards for print must not create undo steps
  try {
    cards.forEach((card) => {
      currentCard = card;
      renderCard();
      const clone = source.cloneNode(true);
      clone.removeAttribute("id");
      clone.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
      clone.querySelectorAll("[contenteditable]").forEach((el) => el.removeAttribute("contenteditable"));
      clones.push(clone);
    });
  } finally {
    currentCard = original;
    renderCard();
    historySuspended = wasSuspended;
  }
  return clones;
}

// entries: [{ card, copies }]. Returns { pages, layout } without printing.
// Width/height a card takes up on the sheet (before scaling)
function cardFootprintMm(size, layout) {
  return layout.rotated ? { w: size.h, h: size.w } : { w: size.w, h: size.h };
}

function buildPrintPages(entries, options) {
  const list = [];
  entries.forEach(({ card, copies }) => {
    for (let i = 0; i < Math.max(1, copies | 0); i++) list.push(card);
  });
  if (!list.length) return null;

  const sizes = list.map(cardSizeMm);
  const cellW = Math.max(...sizes.map((s) => s.w));
  const cellH = Math.max(...sizes.map((s) => s.h));
  const perSheet = options.paper === "auto" ? 1 : Math.max(1, options.perSheet | 0);
  const layout = computeSheetLayout({
    paper: options.paper,
    perSheet,
    cellW,
    cellH,
    marginMm: options.marginMm,
    gapMm: options.gapMm,
    orientation: options.orientation,
  });
  if (!layout) return null;

  // Render each distinct card once, then reuse its clone for every copy
  const unique = [...new Set(list)];
  const clones = renderCardClones(unique);
  const rendered = new Map(unique.map((card, i) => [card, clones[i]]));

  const pages = [];
  for (let start = 0; start < list.length; start += perSheet) {
    const page = document.createElement("div");
    page.className = "print-page";
    page.style.width = `${layout.pageW}mm`;
    page.style.height = `${layout.pageH}mm`;

    list.slice(start, start + perSheet).forEach((card, i) => {
      const slot = layout.slots[i];
      const size = cardSizeMm(card);
      const s = layout.scale;
      const el = rendered.get(card).cloneNode(true);
      el.classList.add("print-slot");
      // Multi-print "Print background patterns" off overrides each card's own setting
      if (options.backgrounds === false) el.setAttribute("data-watermark", "off");
      const foot = cardFootprintMm(size, layout);
      // Centre a smaller card inside its cell
      el.style.left = `${slot.x + (slot.w - foot.w * s) / 2}mm`;
      el.style.top = `${slot.y + (slot.h - foot.h * s) / 2}mm`;
      el.style.width = `${size.w}mm`;
      el.style.height = `${size.h}mm`;
      // Turned cards: rotate 90° clockwise around the top-left, then shift back into the slot
      el.style.transform = layout.rotated
        ? `translate(${size.h * s}mm, 0) rotate(90deg) scale(${s})`
        : s < 1
          ? `scale(${s})`
          : "none";
      page.appendChild(el);
    });

    if (options.cutLines && layout.gapMm > 0) {
      const cardW = layout.slots[0].w,
        cardH = layout.slots[0].h;
      const blockTop = layout.slots[0].y,
        blockLeft = layout.slots[0].x;
      const blockW = layout.cols * cardW + (layout.cols - 1) * layout.gapMm;
      const blockH = layout.rows * cardH + (layout.rows - 1) * layout.gapMm;
      for (let c = 1; c < layout.cols; c++) {
        const line = document.createElement("div");
        line.className = "print-cut-line vertical";
        line.style.left = `${blockLeft + c * cardW + (c - 0.5) * layout.gapMm}mm`;
        line.style.top = `${blockTop}mm`;
        line.style.height = `${blockH}mm`;
        page.appendChild(line);
      }
      for (let r = 1; r < layout.rows; r++) {
        const line = document.createElement("div");
        line.className = "print-cut-line horizontal";
        line.style.top = `${blockTop + r * cardH + (r - 0.5) * layout.gapMm}mm`;
        line.style.left = `${blockLeft}mm`;
        line.style.width = `${blockW}mm`;
        page.appendChild(line);
      }
    }
    pages.push(page);
  }
  return { pages, layout, cardCount: list.length };
}

function setPrintPageRule(layout) {
  let styleEl = document.getElementById("dynamicPrintPageStyle");
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = "dynamicPrintPageStyle";
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = `@media print { @page { size: ${layout.pageW}mm ${layout.pageH}mm; margin: 0; } }`;
}

async function waitForImages(root, timeoutMs = 5000) {
  const imgs = [...root.querySelectorAll("img")];
  await Promise.race([
    Promise.all(imgs.map((img) => (img.complete ? Promise.resolve() : img.decode().catch(() => {})))),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

let printJobActive = false;

function clearPrintJob() {
  document.body.classList.remove("multi-sheet-mode");
  const container = document.getElementById("printSheetContainer");
  if (container) container.innerHTML = "";
  printJobActive = false;
}

// Puts the pages in place for printing. Returns the build result (or null).
function preparePrintJob(entries, options) {
  const result = buildPrintPages(entries, options);
  if (!result) return null;
  const container = document.getElementById("printSheetContainer");
  container.innerHTML = "";
  result.pages.forEach((p) => container.appendChild(p));
  setPrintPageRule(result.layout);
  document.body.classList.add("multi-sheet-mode");
  printJobActive = true;
  return result;
}

async function runPrintJob(entries, options) {
  const result = preparePrintJob(entries, options);
  if (!result) {
    showToastNotification("Nothing to print — select at least one card.", "⚠️", "error");
    return null;
  }
  await waitForImages(document.getElementById("printSheetContainer"));
  window.print();
  // afterprint clears the job; fallback for browsers that don't fire it
  setTimeout(() => {
    if (printJobActive) clearPrintJob();
  }, 1500);
  return result;
}

// Single card: "auto" prints on paper of the card's exact size, otherwise centred on that paper
function singleCardPrintOptions(paperSize) {
  if (paperSize === "auto") return { paper: "auto", perSheet: 1, marginMm: 0, gapMm: 0, cutLines: false };
  const size = cardSizeMm(currentCard);
  const withMargin = {
    paper: paperSize,
    perSheet: 1,
    marginMm: loadPrintSettings().marginMm,
    gapMm: 0,
    cutLines: false,
  };
  const fit = computeSheetLayout({ ...withMargin, cellW: size.w, cellH: size.h });
  // A card the size of the paper prints edge to edge at 100%; its own inner safety margin protects the content
  if (fit && fit.scale < 1) {
    const edge = computeSheetLayout({ ...withMargin, marginMm: 0, cellW: size.w, cellH: size.h });
    if (edge && edge.scale > fit.scale) return { ...withMargin, marginMm: 0 };
  }
  return withMargin;
}

function printCardWithPaper(paperSize = "auto") {
  return runPrintJob([{ card: currentCard, copies: 1 }], singleCardPrintOptions(paperSize));
}

// Browser print (Ctrl+P) without a prepared job still prints the current card correctly
window.addEventListener("beforeprint", () => {
  if (!printJobActive) {
    preparePrintJob([{ card: currentCard, copies: 1 }], {
      paper: "auto",
      perSheet: 1,
      marginMm: 0,
      gapMm: 0,
      cutLines: false,
    });
  }
});
window.addEventListener("afterprint", () => {
  if (printJobActive) clearPrintJob();
});

// --- MULTI-CARD PRINT MODAL ---

function getBatchSettingsFromForm() {
  const num = (id, fallback) => {
    const v = parseFloat(document.getElementById(id).value);
    return isNaN(v) ? fallback : Math.max(0, Math.min(30, v));
  };
  return {
    paper: document.getElementById("sheetFormat").value,
    orientation: document.getElementById("sheetOrientation").value,
    perSheet: parseInt(document.getElementById("sheetGridCount").value, 10) || 1,
    marginMm: num("sheetMarginMm", DEFAULT_PRINT_SETTINGS.marginMm),
    gapMm: num("sheetGapMm", DEFAULT_PRINT_SETTINGS.gapMm),
    cutLines: document.getElementById("sheetCutLines").checked,
    backgrounds: document.getElementById("sheetBackgrounds").checked,
  };
}

// Selected cards with copies; index -1 is the open card
function getBatchEntries() {
  const library = getSavedLibraryCards();
  const entries = [];
  document.querySelectorAll("#batchCardList .batch-card-row").forEach((row) => {
    if (!row.querySelector(".batch-card-check").checked) return;
    const idx = parseInt(row.dataset.index, 10);
    const copies = Math.max(1, Math.min(50, parseInt(row.querySelector(".batch-card-copies").value, 10) || 1));
    const card =
      idx === -1
        ? JSON.parse(JSON.stringify(currentCard))
        : hydrateCardPhotos(JSON.parse(JSON.stringify(library[idx])));
    if (card && Array.isArray(card.items)) entries.push({ card, copies });
  });
  return entries;
}

function renderBatchCardList() {
  const list = document.getElementById("batchCardList");
  const library = getSavedLibraryCards();
  const rows = [{ index: -1, card: currentCard, label: "Open card" }].concat(
    library.map((card, index) => ({ index, card, label: "Saved" })),
  );
  list.innerHTML = "";
  rows.forEach(({ index, card, label }) => {
    const size = cardSizeMm(card);
    const row = document.createElement("label");
    row.className = "batch-card-row";
    row.dataset.index = index;
    row.innerHTML = `
      <input type="checkbox" class="batch-card-check" ${index === -1 ? "checked" : ""}>
      <span class="batch-card-info">
        <span class="batch-card-title">${escapeHtml(card.title || "Untitled")}${card.subtitle ? " — " + escapeHtml(card.subtitle) : ""}</span>
        <span class="batch-card-meta">${label} · ${escapeHtml(size.w)} × ${escapeHtml(size.h)} mm · ${(card.items || []).length} items</span>
      </span>
      <input type="number" class="batch-card-copies" min="1" max="50" value="1" title="Copies">
    `;
    list.appendChild(row);
  });
}

function updateBatchSheetPreview() {
  const settings = getBatchSettingsFromForm();
  savePrintSettings(settings);

  const entries = getBatchEntries();
  const preview = document.getElementById("sheetPaperPreview");
  const summary = document.getElementById("batchSummary");
  const printBtn = document.getElementById("printBatchSheetBtn");
  preview.innerHTML = "";

  const total = entries.reduce((n, e) => n + e.copies, 0);
  if (!total) {
    summary.textContent = "Select at least one card to print.";
    summary.className = "batch-summary warn";
    printBtn.disabled = true;
    document.getElementById("batchPrintLabel").textContent = "Print";
    return;
  }

  const sizes = entries.map((e) => cardSizeMm(e.card));
  const cellW = Math.max(...sizes.map((s) => s.w)),
    cellH = Math.max(...sizes.map((s) => s.h));
  const layout = computeSheetLayout({ ...settings, cellW, cellH });
  if (!layout) {
    summary.textContent = "The margin and gap leave no room for a card on this paper.";
    summary.className = "batch-summary warn";
    printBtn.disabled = true;
    return;
  }

  const sheets = Math.ceil(total / settings.perSheet);
  const pct = Math.round(layout.scale * 1000) / 10;
  summary.textContent =
    `${total} card${total === 1 ? "" : "s"} → ${sheets} sheet${sheets === 1 ? "" : "s"} · ${PAPER_SIZES_MM[settings.paper].label} ${layout.orientation}${layout.rotated ? " · cards turned 90°" : ""} · ` +
    (layout.scale < 1 ? `printed at ${pct}% to fit the margins and gap` : "printed at 100% (real size)");
  summary.className = "batch-summary" + (layout.scale < 1 ? " scaled" : "");
  printBtn.disabled = false;
  document.getElementById("batchPrintLabel").textContent = `Print ${sheets} sheet${sheets === 1 ? "" : "s"}`;

  // Draw every sheet to scale from the same layout the printer gets
  const flat = [];
  entries.forEach((e) => {
    for (let i = 0; i < e.copies; i++) flat.push(e.card);
  });
  const pxPerMm = 150 / Math.max(layout.pageW, layout.pageH);
  for (let start = 0; start < flat.length; start += settings.perSheet) {
    const sheet = document.createElement("div");
    sheet.className = "sheet-paper";
    sheet.style.width = `${layout.pageW * pxPerMm}px`;
    sheet.style.height = `${layout.pageH * pxPerMm}px`;
    flat.slice(start, start + settings.perSheet).forEach((card, i) => {
      const slot = layout.slots[i];
      const foot = cardFootprintMm(cardSizeMm(card), layout);
      const mini = document.createElement("div");
      mini.className = "sheet-card-mini" + (layout.rotated ? " rotated" : "");
      mini.style.left = `${(slot.x + (slot.w - foot.w * layout.scale) / 2) * pxPerMm}px`;
      mini.style.top = `${(slot.y + (slot.h - foot.h * layout.scale) / 2) * pxPerMm}px`;
      mini.style.width = `${foot.w * layout.scale * pxPerMm}px`;
      mini.style.height = `${foot.h * layout.scale * pxPerMm}px`;
      mini.textContent = card.title || "Card";
      sheet.appendChild(mini);
    });
    preview.appendChild(sheet);
  }
}

function openBatchModal() {
  const s = loadPrintSettings();
  document.getElementById("sheetFormat").value = s.paper;
  document.getElementById("sheetOrientation").value = s.orientation || "auto";
  document.getElementById("sheetGridCount").value = String(s.perSheet);
  document.getElementById("sheetMarginMm").value = s.marginMm;
  document.getElementById("sheetGapMm").value = s.gapMm;
  document.getElementById("sheetCutLines").checked = !!s.cutLines;
  document.getElementById("sheetBackgrounds").checked = s.backgrounds !== false;
  renderBatchCardList();
  document.getElementById("batchModal").classList.remove("hidden");
  updateBatchSheetPreview();
}

function triggerBatchPrint() {
  const entries = getBatchEntries();
  const settings = getBatchSettingsFromForm();
  document.getElementById("batchModal").classList.add("hidden");
  return runPrintJob(entries, settings);
}

async function exportCardAsImage() {
  const card = document.getElementById("flightcaseCard");
  const exportBtn = document.getElementById("exportImageBtn");

  if (!card) {
    showToastNotification("Card element not found.", "❌", "error");
    return;
  }

  if (!window.html2canvas) {
    showToastNotification("Export engine still loading — please wait a moment.", "⏳", "info");
    return;
  }

  const origBtnText = exportBtn ? exportBtn.innerHTML : "";
  if (exportBtn) {
    exportBtn.innerHTML = `⏳ Generating PNG...`;
    exportBtn.setAttribute("disabled", "true");
  }

  const titlePart = (currentCard.title || "FlightCase").trim();
  const subtitlePart = (currentCard.subtitle || "").trim();
  const fullTitle = subtitlePart ? `${titlePart}_${subtitlePart}` : titlePart;
  const safeFilename =
    (fullTitle
      .replace(/[\\/:*?"<>|]/g, "")
      .replace(/\s+/g, "_")
      .replace(/_{2,}/g, "_") || "Flightcase_Card") + ".png";

  // Temporarily remove any parent CSS transform (zoom/scale) so html2canvas renders at true 1:1
  const scaler = document.getElementById("cardScaler");
  const origTransform = scaler ? scaler.style.transform : null;
  if (scaler) scaler.style.transform = "scale(1)";

  // Also temporarily hide the margin guide and no-print elements
  const marginGuide = document.getElementById("printerMarginGuide");
  const wasHidden = marginGuide && marginGuide.style.display === "none";
  if (marginGuide) marginGuide.style.display = "none";

  try {
    const canvas = await html2canvas(card, {
      scale: 3,
      backgroundColor: "#ffffff",
      useCORS: true,
      allowTaint: true,
      logging: false,
      removeContainer: true,
      imageTimeout: 8000,
    });

    // Restore transform and margin guide
    if (scaler && origTransform !== null) scaler.style.transform = origTransform;
    if (marginGuide && !wasHidden) marginGuide.style.display = "";

    const dataUrl = canvas.toDataURL("image/png");

    // The download (the app asks where to save it), plus a copy in Documents and on the Shared Drive
    canvas.toBlob((b) => {
      if (!b) return;
      const u = URL.createObjectURL(b);
      const a = document.createElement("a");
      a.style.display = "none";
      a.href = u;
      a.download = safeFilename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        if (a.parentNode) a.parentNode.removeChild(a);
        URL.revokeObjectURL(u);
      }, 1500);
    }, "image/png");
    appCall("storage.saveExport", safeFilename, dataUrl).catch((e) => console.warn("Export copy:", e));

    if (exportBtn) {
      exportBtn.innerHTML = `✓ Exported!`;
      setTimeout(() => {
        exportBtn.innerHTML = origBtnText;
        exportBtn.removeAttribute("disabled");
      }, 2000);
    }

    showToastNotification(`🖼️ Exported "${safeFilename}"`, "🖼️");
  } catch (err) {
    // Restore transform and margin guide on error too
    if (scaler && origTransform !== null) scaler.style.transform = origTransform;
    if (marginGuide && !wasHidden) marginGuide.style.display = "";

    console.error("Export error:", err);
    showToastNotification("Export failed: " + (err.message || err), "❌", "error");
    if (exportBtn) {
      exportBtn.innerHTML = origBtnText;
      exportBtn.removeAttribute("disabled");
    }
  }
}

// Fit the whole card between the size label at the top and the zoom bar at the bottom
function fitCardToStage(maxPercent = 100) {
  const stage = document.getElementById("stageViewport");
  const card = document.getElementById("flightcaseCard");
  if (!stage || !card || !card.offsetWidth) return;
  const scale =
    Math.min((stage.clientWidth - 120) / card.offsetWidth, (stage.clientHeight - 200) / card.offsetHeight) * 100;
  setZoom(Math.min(maxPercent, scale));
}

function setZoom(level) {
  zoomLevel = Math.max(40, Math.min(250, level));
  const scaler = document.getElementById("cardScaler");
  const text = document.getElementById("zoomLevelText");
  scaler.style.transform = `scale(${zoomLevel / 100})`;
  text.innerText = `${Math.round(zoomLevel)}%`;
}

// --- PHOTO COLUMN WIDTH CONTROLLER & DIRECT DRAG DIVIDER RESIZER ---

function setPhotoColumnWidth(width, updateSlider = true) {
  const w = Math.round(Math.max(25, Math.min(160, Number(width) || 52)));
  currentCard.photoColWidth = w;

  const card = document.getElementById("flightcaseCard");
  if (card) {
    card.style.setProperty("--photo-col-width", `${w}px`);
  }

  const valueDisplay = document.getElementById("photoColWidthValue");
  if (valueDisplay) {
    const mm = Math.round(w * 0.264583);
    valueDisplay.innerText = `${w}px (~${mm}mm)`;
  }

  if (updateSlider) {
    const slider = document.getElementById("photoColWidthSlider");
    if (slider) slider.value = w;
  }

  document.querySelectorAll(".photo-preset-btn").forEach((btn) => {
    btn.classList.toggle("active", parseInt(btn.dataset.width, 10) === w);
  });

  saveActiveCardState();
}

function initColResizeHandle(handle) {
  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();

    const card = document.getElementById("flightcaseCard");
    const startX = e.clientX;
    const startWidth = currentCard.photoColWidth || 52;
    const currentZoom = (zoomLevel || 100) / 100;

    handle.classList.add("active");
    if (card) card.classList.add("is-resizing-col");
    document.body.classList.add("col-resizing");

    // Live floating tooltip showing px and physical mm
    const tooltip = document.createElement("div");
    tooltip.className = "col-resize-tooltip no-print";
    tooltip.setAttribute("data-html2canvas-ignore", "true");
    const initialMm = Math.round(startWidth * 0.264583);
    tooltip.innerText = `${startWidth}px (~${initialMm}mm)`;
    handle.appendChild(tooltip);

    function onPointerMove(ev) {
      ev.preventDefault();
      const deltaX = (ev.clientX - startX) / currentZoom;
      const newWidth = Math.round(Math.max(25, Math.min(160, startWidth + deltaX)));
      setPhotoColumnWidth(newWidth, true);
      const mm = Math.round(newWidth * 0.264583);
      tooltip.innerText = `${newWidth}px (~${mm}mm)`;
    }

    function onPointerUp(ev) {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);

      handle.classList.remove("active");
      if (card) card.classList.remove("is-resizing-col");
      document.body.classList.remove("col-resizing");
      if (tooltip.parentNode) {
        tooltip.parentNode.removeChild(tooltip);
      }
      saveActiveCardState();
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  });
}

function createNewBlankCard() {
  currentCard = {
    title: "New Case",
    subtitle: "Equipment Kit",
    tag: "",
    pattern: "diamonds",
    company: "STREAM MY EVENT",
    phone: "+31(0)20 369 0970",
    website: "www.streammyevent.com",
    logo: "sme-live",
    dimensions: "148x210",
    photoColWidth: 52,
    fontScale: 1.0,
    printerMargin: 5,
    showMarginGuide: true,
    items: [
      { id: String(Date.now()), qty: "1", content: "Main Equipment Unit", image: "" },
      { id: String(Date.now() + 1), qty: "1", content: "Mains Power Cable 1.5m", image: "" },
      { id: String(Date.now() + 2), qty: "", content: "", image: "" },
    ],
  };
  saveActiveCardState();
  renderCard();
  renderSidebar();
  showToastNotification("✨ Started blank new card (DIN A5 SME Standard)", "📄");
}

// --- SIDE PANEL TABS ---
const EDITOR_TABS = ["tab-content", "tab-layout", "tab-branding"];
let lastEditorTab = "tab-content";

function showSidebarTab(tabId) {
  const isEditor = EDITOR_TABS.includes(tabId);
  if (isEditor) lastEditorTab = tabId;
  // The Editor menu button always points at the editor tab you last used
  const railEditor = document.getElementById("railEditorBtn");
  if (railEditor) railEditor.dataset.tab = lastEditorTab;

  document.querySelectorAll(".tab-btn[data-tab]").forEach((b) => {
    const on = b.dataset.tab === tabId;
    b.classList.toggle("active", on);
    if (b.getAttribute("role") === "tab") b.setAttribute("aria-selected", on ? "true" : "false");
  });
  document.querySelectorAll(".tab-pane").forEach((p) => p.classList.toggle("active", p.id === tabId));
  const panel = document.getElementById("sidebarPanel");
  if (panel) panel.dataset.section = isEditor ? "editor" : tabId === "tab-library" ? "library" : "gear";
}

// --- LIGHT / DARK THEME ---
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const btn = document.getElementById("themeToggleBtn");
  if (btn) {
    const label = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
    btn.title = label;
    btn.setAttribute("aria-label", label);
  }
}

function initThemeToggle() {
  applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light");
  const btn = document.getElementById("themeToggleBtn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    applyTheme(next);
    try {
      localStorage.setItem("ccs_theme", next);
    } catch (e) {}
  });
}

// --- TOP BAR: CARD NAME AND LIBRARY STATUS ---
function updateHeaderCardName() {
  const nameEl = document.getElementById("headerCardName");
  if (nameEl) {
    const name = [currentCard.title, currentCard.subtitle]
      .map((s) => String(s || "").trim())
      .filter(Boolean)
      .join(" · ");
    nameEl.textContent = name || "Untitled card";
  }
}

function updateHeaderCardStatus() {
  updateHeaderCardName();
  const state = document.getElementById("saveState");
  const text = document.getElementById("saveStateText");
  if (!state || !text) return;
  let saved = false;
  try {
    const lib = JSON.parse(localStorage.getItem("flightcase_library") || "[]");
    const entry = lib.find((c) => c.title === currentCard.title && c.subtitle === currentCard.subtitle);
    saved = !!entry && JSON.stringify(entry) === JSON.stringify(stripImagesFromCardSnapshot(currentCard));
  } catch (e) {}
  state.classList.toggle("unsaved", !saved);
  text.textContent = saved ? "Saved" : "Not saved to library";
}

function initEventListeners() {
  initThemeToggle();
  const railSettings = document.getElementById("railSettingsBtn");
  if (railSettings)
    railSettings.addEventListener("click", () => document.getElementById("openStorageSettingsBtn").click());

  document.getElementById("printBtn").addEventListener("click", () => printCardWithPaper("auto"));

  const printDropdownBtn = document.getElementById("printDropdownBtn");
  const printDropdownMenu = document.getElementById("printDropdownMenu");
  if (printDropdownBtn && printDropdownMenu) {
    printDropdownBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      printDropdownMenu.classList.toggle("hidden");
    });
    document.querySelectorAll(".print-paper-item").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        printDropdownMenu.classList.add("hidden");
        const paper = btn.dataset.paper || "auto";
        printCardWithPaper(paper);
      });
    });
    const batchOptBtn = document.getElementById("printDropdownBatchBtn");
    if (batchOptBtn) {
      batchOptBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        printDropdownMenu.classList.add("hidden");
        openBatchModal();
      });
    }
    document.addEventListener("click", () => {
      printDropdownMenu.classList.add("hidden");
    });
  }

  // Quick Print Buttons in Layout Tab
  const qpA5 = document.getElementById("quickPrintA5Btn");
  if (qpA5) qpA5.addEventListener("click", () => printCardWithPaper("a5"));
  const qpA6 = document.getElementById("quickPrintA6Btn");
  if (qpA6) qpA6.addEventListener("click", () => printCardWithPaper("a6"));
  const qpA4 = document.getElementById("quickPrintA4Btn");
  if (qpA4) qpA4.addEventListener("click", () => printCardWithPaper("a4"));

  const exportImageBtn = document.getElementById("exportImageBtn");
  if (exportImageBtn) exportImageBtn.addEventListener("click", exportCardAsImage);
  const saveBtn = document.getElementById("saveLibraryBtn");
  if (saveBtn) saveBtn.addEventListener("click", saveCurrentCaseToStorage);
  const batchBtn = document.getElementById("batchPrintBtn");
  if (batchBtn) batchBtn.addEventListener("click", openBatchModal);

  // In-App New Card Modal Handlers
  const newCardModal = document.getElementById("newCardModal");
  const newCardBtn = document.getElementById("newCardBtn");
  const confirmNewCardModalBtn = document.getElementById("confirmNewCardModalBtn");
  const closeNewCardModalBtn = document.getElementById("closeNewCardModalBtn");
  const cancelNewCardModalBtn = document.getElementById("cancelNewCardModalBtn");

  if (newCardBtn) {
    newCardBtn.addEventListener("click", () => {
      if (newCardModal) {
        newCardModal.classList.remove("hidden");
      } else {
        createNewBlankCard();
      }
    });
  }

  if (confirmNewCardModalBtn) {
    confirmNewCardModalBtn.addEventListener("click", () => {
      if (newCardModal) newCardModal.classList.add("hidden");
      createNewBlankCard();
    });
  }

  if (closeNewCardModalBtn) {
    closeNewCardModalBtn.addEventListener("click", () => {
      if (newCardModal) newCardModal.classList.add("hidden");
    });
  }

  if (cancelNewCardModalBtn) {
    cancelNewCardModalBtn.addEventListener("click", () => {
      if (newCardModal) newCardModal.classList.add("hidden");
    });
  }

  if (newCardModal) {
    newCardModal.addEventListener("click", (e) => {
      if (e.target === newCardModal) newCardModal.classList.add("hidden");
    });
  }

  // Side panel tabs: the left menu (Editor / Library / Gear) and the Content / Design / Branding
  // tabs are all .tab-btn[data-tab]; the Editor menu button returns to the last editor tab
  document.querySelectorAll(".tab-btn[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => showSidebarTab(btn.dataset.tab));
  });

  document.getElementById("inputTitle").addEventListener("input", (e) => {
    currentCard.title = e.target.value;
    document.getElementById("cardTitleDisplay").innerText = e.target.value;
    updateHeaderCardName();
  });
  document.getElementById("inputSubtitle").addEventListener("input", (e) => {
    currentCard.subtitle = e.target.value;
    document.getElementById("cardSubtitleDisplay").innerText = e.target.value;
    updateHeaderCardName();
  });
  document.getElementById("watermarkPattern").addEventListener("change", (e) => {
    currentCard.pattern = e.target.value;
    document.getElementById("flightcaseCard").setAttribute("data-pattern", e.target.value);
    saveActiveCardState();
  });
  document.getElementById("showWatermark").addEventListener("change", (e) => {
    currentCard.showWatermark = e.target.checked;
    document.getElementById("flightcaseCard").setAttribute("data-watermark", e.target.checked ? "on" : "off");
    syncWatermarkControls();
    saveActiveCardState();
  });
  document.getElementById("watermarkOpacity").addEventListener("input", (e) => {
    currentCard.watermarkOpacity = parseInt(e.target.value, 10);
    document
      .getElementById("flightcaseCard")
      .style.setProperty("--card-bg-watermark-opacity", currentCard.watermarkOpacity / 100);
    saveActiveCardState();
  });
  document.getElementById("companyName").addEventListener("input", (e) => {
    currentCard.company = e.target.value;
    document.getElementById("footerCompanyNameDisplay").innerHTML = formatCompanyNameHtml(e.target.value);
  });
  document.getElementById("companyPhone").addEventListener("input", (e) => {
    currentCard.phone = e.target.value;
    document.getElementById("footerPhoneDisplay").innerText = e.target.value;
  });
  document.getElementById("companyWebsite").addEventListener("input", (e) => {
    currentCard.website = e.target.value;
    document.getElementById("footerWebsiteDisplay").innerText = e.target.value;
  });

  document.getElementById("cardTitleDisplay").addEventListener("input", (e) => {
    currentCard.title = e.target.innerText;
    updateHeaderCardName();
    document.getElementById("inputTitle").value = e.target.innerText;
  });
  document.getElementById("cardSubtitleDisplay").addEventListener("input", (e) => {
    currentCard.subtitle = e.target.innerText;
    updateHeaderCardName();
    document.getElementById("inputSubtitle").value = e.target.innerText;
  });
  document.getElementById("footerCompanyNameDisplay").addEventListener("input", (e) => {
    currentCard.company = e.target.innerText;
    document.getElementById("companyName").value = e.target.innerText;
  });
  document.getElementById("footerPhoneDisplay").addEventListener("input", (e) => {
    currentCard.phone = e.target.innerText;
    document.getElementById("companyPhone").value = e.target.innerText;
  });
  document.getElementById("footerWebsiteDisplay").addEventListener("input", (e) => {
    currentCard.website = e.target.innerText;
    document.getElementById("companyWebsite").value = e.target.innerText;
  });

  document.getElementById("addItemBtn").addEventListener("click", () => {
    currentCard.items.push({
      id: String(Date.now()),
      qty: "1",
      content: "New Item Description",
      image: "",
    });
    renderCard();
    renderSidebar();
  });

  document.getElementById("addEmptyRowBtn").addEventListener("click", () => {
    currentCard.items.push({
      id: String(Date.now()),
      qty: "",
      content: "",
      image: "",
    });
    renderCard();
    renderSidebar();
  });

  // Custom Dimensions listeners
  document.getElementById("dimensionPreset").addEventListener("change", (e) => {
    currentCard.dimensions = e.target.value;
    const customRow = document.getElementById("customDimsRow");
    if (e.target.value === "custom") {
      customRow.classList.remove("hidden");
    } else {
      customRow.classList.add("hidden");
    }
    applyDimensionsToCard(e.target.value);
  });

  document.getElementById("customWidth").addEventListener("input", () => {
    applyDimensionsToCard("custom");
  });
  document.getElementById("customHeight").addEventListener("input", () => {
    applyDimensionsToCard("custom");
  });

  document.getElementById("orientationSelect").addEventListener("change", (e) => {
    currentCard.orientation = e.target.value;
    applyDimensionsToCard(currentCard.dimensions);
  });

  // Apply Stream My Event Brand Standard
  const applySmeBtn = document.getElementById("applySmeBrandBtn");
  if (applySmeBtn) {
    applySmeBtn.addEventListener("click", () => {
      currentCard.company = "STREAM MY EVENT";
      currentCard.phone = "+31(0)20 369 0970";
      currentCard.website = "www.streammyevent.com";
      currentCard.logo = "sme-live";
      currentCard.dimensions = "148x210";
      currentCard.printerMargin = 5;
      currentCard.fontScale = 1.0;

      document.getElementById("companyName").value = "STREAM MY EVENT";
      document.getElementById("companyPhone").value = "+31(0)20 369 0970";
      document.getElementById("companyWebsite").value = "www.streammyevent.com";
      document.getElementById("qrUrlInput").value = "https://streammyevent.com";

      const dimPreset = document.getElementById("dimensionPreset");
      if (dimPreset) dimPreset.value = "148x210";
      applyDimensionsToCard("148x210");
      applyPrinterMarginToCard(5, true);
      applyFontScaleToCard(1.0, true);

      document.querySelectorAll(".logo-preset-btn").forEach((b) => {
        b.classList.toggle("active", b.dataset.logo === "sme-live");
      });

      renderCard();
      alert("Standard Stream My Event company profile & DIN A5 format applied!");
    });
  }

  // Logo preset buttons
  document.querySelectorAll(".logo-preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".logo-preset-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentCard.logo = btn.dataset.logo;
      renderFooterLogo();
    });
  });

  // Custom Logo Upload
  const logoFileInput = document.getElementById("customLogoFile");
  if (logoFileInput) {
    logoFileInput.addEventListener("change", (e) => {
      if (e.target.files && e.target.files[0]) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          currentCard.logo = ev.target.result;
          document.querySelectorAll(".logo-preset-btn").forEach((b) => b.classList.remove("active"));
          renderFooterLogo();
        };
        reader.readAsDataURL(e.target.files[0]);
      }
    });
  }

  // Card Border Radius
  const radiusSelect = document.getElementById("cardBorderRadius");
  if (radiusSelect) {
    radiusSelect.addEventListener("change", (e) => {
      document.getElementById("flightcaseCard").style.borderRadius = e.target.value;
    });
  }

  // Font Size Slider & Presets
  const fontSizeSlider = document.getElementById("fontSizeSlider");
  if (fontSizeSlider) {
    fontSizeSlider.addEventListener("input", (e) => {
      const scale = parseFloat(e.target.value) / 100;
      applyFontScaleToCard(scale, false);
    });
  }

  document.querySelectorAll(".font-preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const scale = parseFloat(btn.dataset.scale) / 100;
      if (scale) applyFontScaleToCard(scale, true);
    });
  });

  // Printer Margin Slider, Numeric Input, Reset & Safety Guide Toggle
  const marginSlider = document.getElementById("printerMarginSlider");
  if (marginSlider) {
    marginSlider.addEventListener("input", (e) => {
      const marginMm = parseFloat(e.target.value);
      applyPrinterMarginToCard(marginMm, false);
      const numInput = document.getElementById("printerMarginInput");
      if (numInput) numInput.value = marginMm;
    });
  }

  const marginInput = document.getElementById("printerMarginInput");
  if (marginInput) {
    const handleMarginInput = (e) => {
      const marginMm = parseFloat(e.target.value);
      if (!isNaN(marginMm)) {
        applyPrinterMarginToCard(marginMm, false);
        const slider = document.getElementById("printerMarginSlider");
        if (slider) slider.value = marginMm;
      }
    };
    marginInput.addEventListener("input", handleMarginInput);
    marginInput.addEventListener("change", handleMarginInput);
  }

  const resetMarginBtn = document.getElementById("resetPrinterMarginBtn");
  if (resetMarginBtn) {
    resetMarginBtn.addEventListener("click", () => {
      applyPrinterMarginToCard(5, true);
    });
  }

  const marginGuideCheckbox = document.getElementById("showPrinterMarginGuide");
  if (marginGuideCheckbox) {
    marginGuideCheckbox.addEventListener("change", (e) => {
      togglePrinterMarginGuide(e.target.checked);
    });
  }

  // Cut Marks & Contrast
  const cutMarksCb = document.getElementById("showCutMarks");
  if (cutMarksCb) {
    cutMarksCb.addEventListener("change", (e) => {
      document.querySelectorAll(".cut-mark").forEach((m) => (m.style.display = e.target.checked ? "block" : "none"));
    });
  }

  const contrastCb = document.getElementById("highContrastPhotos");
  if (contrastCb) {
    contrastCb.addEventListener("change", (e) => {
      document.getElementById("flightcaseCard").classList.toggle("high-contrast", e.target.checked);
    });
  }

  // Photo Column Width Slider & Preset Buttons
  const photoSlider = document.getElementById("photoColWidthSlider");
  if (photoSlider) {
    photoSlider.addEventListener("input", (e) => {
      setPhotoColumnWidth(e.target.value, false);
    });
  }

  document.querySelectorAll(".photo-preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const w = parseInt(btn.dataset.width, 10);
      if (w) setPhotoColumnWidth(w, true);
    });
  });

  document.getElementById("enableQrCode").addEventListener("change", (e) => {
    if (e.target.checked) {
      document.getElementById("qrConfigGroup").classList.remove("hidden");
    } else {
      document.getElementById("qrConfigGroup").classList.add("hidden");
    }
    updateQrCodeDisplay();
  });
  document.getElementById("qrUrlInput").addEventListener("input", updateQrCodeDisplay);

  document.getElementById("zoomInBtn").addEventListener("click", () => setZoom(zoomLevel + 15));
  document.getElementById("zoomOutBtn").addEventListener("click", () => setZoom(zoomLevel - 15));
  document.getElementById("zoom100Btn").addEventListener("click", () => setZoom(100));
  document.getElementById("zoomFitBtn").addEventListener("click", () => fitCardToStage(250));

  // Import and Export JSON in Saved Cases Tab
  const exportBtn = document.getElementById("exportJsonBtn");
  if (exportBtn) {
    exportBtn.addEventListener("click", exportFlightcaseLibrary);
  }

  const importBtn = document.getElementById("importJsonBtn");
  const importInput = document.getElementById("importJsonInput");
  if (importBtn && importInput) {
    importBtn.addEventListener("click", () => importInput.click());
    importInput.addEventListener("change", (e) => {
      if (e.target.files && e.target.files[0]) {
        importFlightcaseJson(e.target.files[0]);
        importInput.value = "";
      }
    });
  }

  document.getElementById("closeBatchModalBtn").addEventListener("click", () => {
    document.getElementById("batchModal").classList.add("hidden");
  });
  document.getElementById("cancelBatchBtn").addEventListener("click", () => {
    document.getElementById("batchModal").classList.add("hidden");
  });
  ["sheetFormat", "sheetOrientation", "sheetGridCount", "sheetCutLines", "sheetBackgrounds"].forEach((id) =>
    document.getElementById(id).addEventListener("change", updateBatchSheetPreview),
  );
  ["sheetMarginMm", "sheetGapMm"].forEach((id) =>
    document.getElementById(id).addEventListener("input", updateBatchSheetPreview),
  );
  // Card ticks and copy counts
  const batchList = document.getElementById("batchCardList");
  batchList.addEventListener("change", updateBatchSheetPreview);
  batchList.addEventListener("input", updateBatchSheetPreview);
  const setAllBatchCards = (checked) => {
    batchList.querySelectorAll(".batch-card-check").forEach((cb) => {
      cb.checked = checked;
    });
    updateBatchSheetPreview();
  };
  document.getElementById("batchSelectAllBtn").addEventListener("click", () => setAllBatchCards(true));
  document.getElementById("batchSelectNoneBtn").addEventListener("click", () => setAllBatchCards(false));
  document.getElementById("printBatchSheetBtn").addEventListener("click", triggerBatchPrint);
}

// ==========================================================================
// GOOGLE SHARED DRIVE STORAGE & SYNC MODULE
// ==========================================================================

// Placeholder until storage.getConfig answers; the real settings live in the app (api.js)
let storageConfig = {
  enabled: false,
  drivePath: "",
  autoSync: true,
  isAccessible: false,
};

function initStorageModule() {
  const modal = document.getElementById("storageSettingsModal");
  const openBtn = document.getElementById("openStorageSettingsBtn");
  const closeBtn = document.getElementById("closeStorageModalBtn");
  const closeFooterBtn = document.getElementById("closeStorageModalFooterBtn");
  const saveConfigBtn = document.getElementById("saveStorageConfigBtn");
  const pushBtn = document.getElementById("pushToDriveBtn");
  const pullBtn = document.getElementById("pullFromDriveBtn");

  const openStorage = () => {
    fetchStorageConfigFromServer();
    if (modal) modal.classList.remove("hidden");
  };
  window.openStorageModal = openStorage;

  if (openBtn) openBtn.addEventListener("click", openStorage);
  if (closeBtn) closeBtn.addEventListener("click", () => modal && modal.classList.add("hidden"));
  if (closeFooterBtn) closeFooterBtn.addEventListener("click", () => modal && modal.classList.add("hidden"));

  // The folder is picked in a dialog: the page never sees or sends a path of its own
  const chooseBtn = document.getElementById("chooseStorageFolderBtn");
  if (chooseBtn) {
    chooseBtn.addEventListener("click", async () => {
      try {
        if (!window.toolbox) throw new Error("This needs the Producers Toolbox app.");
        if (await window.toolbox.folder.choose()) await fetchStorageConfigFromServer();
      } catch (e) {
        alert("Could not use that folder: " + e.message);
      }
    });
  }

  if (saveConfigBtn) {
    saveConfigBtn.addEventListener("click", () => {
      const enabled = document.getElementById("enableStorageDrive").checked;
      const autoSync = document.getElementById("storageAutoSync").checked;

      saveStorageConfigToServer({ enabled, autoSync });
    });
  }

  if (pushBtn) pushBtn.addEventListener("click", pushLocalDataToSharedDrive);
  if (pullBtn) pullBtn.addEventListener("click", pullDataFromSharedDrive);

  // Initial config check at startup
  fetchStorageConfigFromServer();
}

function updateStorageSubfolderDisplay(path) {
  const display = document.getElementById("storageBaseFolderDisplay");
  if (display) {
    display.innerText = path ? `📂 ${path}` : "[Google Shared Drive Root]";
  }
}

async function fetchStorageConfigFromServer() {
  try {
    const data = await appCall("storage.getConfig");
    {
      storageConfig = data;

      document.getElementById("enableStorageDrive").checked = data.enabled !== false;
      document.getElementById("storageDrivePathInput").value = data.drivePath || "";
      document.getElementById("storageAutoSync").checked = data.autoSync !== false;
      updateStorageSubfolderDisplay(data.drivePath);

      const openBtn = document.getElementById("openStorageSettingsBtn");

      if (data.isAccessible) {
        setDriveStatus("ok", "Connected and writable");
        if (openBtn) openBtn.title = `Google Shared Drive: ${data.drivePath} (Connected)`;
        // Auto-pull shared gear catalog and cases on startup
        if (data.autoSync !== false) {
          pullDataFromSharedDrive(true);
        }
      } else {
        setDriveStatus("off", data.drivePath ? "Drive not found · working on this computer only" : "No folder chosen");
        if (openBtn) openBtn.title = `Google Shared Drive: ${data.drivePath} (Click to connect)`;
      }
    }
  } catch (e) {
    console.warn("Storage API fetch error:", e);
  }
}

async function saveStorageConfigToServer(cfg) {
  try {
    const resp = await appCall("storage.setConfig", cfg);
    {
      storageConfig = resp;

      if (resp.isAccessible) {
        setDriveStatus("ok", "Connected · folders created");
        // Immediately sync from drive
        pullDataFromSharedDrive(false);
      } else {
        setDriveStatus("warn", resp.drivePath ? "Folder saved · waiting for the drive" : "No folder chosen");
      }
      document.getElementById("storageSettingsModal").classList.add("hidden");
    }
  } catch (e) {
    alert("Could not save the Shared Drive settings: " + e.message);
  }
}

async function pushLocalDataToSharedDrive() {
  try {
    showToastNotification("Pushing data to Google Shared Drive...", "☁️", "info");

    // 1. Push Full Gear DB
    const allGear = getAllGearItems();
    await appCall("storage.saveDatabase", scrubRentmanTokens(JSON.stringify(allGear)));

    // 2. Push Saved Cases & Current Active Card
    const cases = readLibrary();
    if (currentCard && currentCard.title) {
      const exists = cases.some((c) => c.title === currentCard.title);
      if (!exists) {
        cases.push(JSON.parse(JSON.stringify(currentCard)));
      }
    }

    let savedCasesCount = 0;
    for (const c of cases) {
      try {
        await appCall("storage.saveCase", scrubRentmanTokens(JSON.stringify(c)));
        savedCasesCount++;
      } catch (e) {
        console.warn("Could not save a card to the Shared Drive:", e);
      }
    }

    showToastNotification(`Pushed ${allGear.length} gear items & ${savedCasesCount} cases to Shared Drive!`, "☁️");
    alert(
      `Successfully pushed to Google Shared Drive!\n\n• ${allGear.length} equipment items -> gear-database/gear_inventory.json\n• ${savedCasesCount} flightcase cards -> cases/*.json\n• Shared Drive: ${storageConfig.drivePath || "(not set)"}`,
    );
  } catch (e) {
    console.error("Push to Google Shared Drive error:", e);
    alert("Error pushing to Google Shared Drive:\n" + e.message);
  }
}

// Shared Drive status in the top bar pill and the settings popup
function setDriveStatus(state, text) {
  const badge = document.getElementById("storageStatusBadge");
  const dot = document.getElementById("storageDriveStatusDot");
  const pill = document.getElementById("drivePillText");
  if (badge) {
    badge.className = "pill " + (state === "ok" ? "pill-ok" : state === "warn" ? "pill-warn" : "");
    badge.textContent = text;
  }
  if (dot) dot.style.background = state === "ok" ? "var(--ok)" : state === "warn" ? "var(--warn)" : "var(--faint)";
  if (pill)
    pill.textContent =
      state === "ok" ? "Shared Drive · synced" : state === "warn" ? "Shared Drive · waiting" : "Shared Drive · offline";
}

async function pullDataFromSharedDrive(silent = false) {
  try {
    // Drop any Rentman token that older versions wrote into shared image URLs
    const data = JSON.parse(scrubRentmanTokens(JSON.stringify(await appCall("storage.syncAll"))));

    if (data.gearDatabase && Array.isArray(data.gearDatabase) && data.gearDatabase.length > 0) {
      customGearDb = data.gearDatabase;
      try {
        writeGearDbLocal();
      } catch (e) {
        console.warn("Could not store the pulled gear database:", e);
      }
      updateGearDbCounters();
      renderGearDbTabList();
      renderSidebar();
      renderCard();
    }

    if (data.cases && Array.isArray(data.cases) && data.cases.length > 0) {
      writeLibrary(data.cases);
      loadSavedCasesFromStorage();
    }

    if (!silent) {
      alert(
        `Synced with Google Shared Drive!\n\nLoaded ${data.gearDatabase ? data.gearDatabase.length : 0} shared equipment items and ${data.cases ? data.cases.length : 0} team flightcases.`,
      );
    }
  } catch (e) {
    if (!silent) {
      alert("Sync error: " + e.message);
    }
  }
}

// Auto-sync helper for new gear / cases
function triggerAutoSyncGearDb() {
  if (storageConfig && storageConfig.enabled) {
    appCall("storage.saveDatabase", scrubRentmanTokens(JSON.stringify(customGearDb))).catch((e) =>
      console.warn("Auto-sync gear DB error:", e),
    );
  }
}

function triggerAutoSyncCase(caseObj) {
  if (storageConfig && storageConfig.enabled) {
    appCall("storage.saveCase", scrubRentmanTokens(JSON.stringify(caseObj))).catch((e) =>
      console.warn("Auto-sync case error:", e),
    );
  }
}

// ==========================================================================
// RENTMAN ERP INTEGRATION MODULE (ADVANCED OPTION)
// https://api.rentman.net/ (OpenAPI v1.16)
// ==========================================================================

let rentmanConfig = {
  token: "",
  connected: false,
  useDemo: true,
  includeCodeInContent: true,
  setCodeAsCaseTag: true,
};

let rentmanCachedEquipment = [];

// The token lives in the app's encrypted store. Versions before the Producers Toolbox kept it in localStorage: move
// it over once, and never leave a plaintext copy behind.
async function loadRentmanToken() {
  const legacy = localStorage.getItem("rentman_api_token");
  localStorage.removeItem("rentman_api_token");
  if (!window.toolbox) return;
  const { available, values } = await window.toolbox.secrets.getAll();
  let token = values.rentmanToken || "";
  if (!token && legacy && available) {
    await window.toolbox.secrets.set("rentmanToken", legacy);
    token = legacy;
  }
  rentmanConfig.token = token;
  rentmanConfig.useDemo = !token;
}
try {
  const savedRentmanCatalog = localStorage.getItem("rentman_cached_catalog");
  if (savedRentmanCatalog) {
    const parsed = JSON.parse(savedRentmanCatalog);
    if (Array.isArray(parsed) && parsed.length > 0) {
      rentmanCachedEquipment = parsed;
    }
  }
} catch (_) {}

const RENTMAN_SAMPLE_DATA = [
  {
    id: 101,
    name: "Astera AX3 LightDrop - 8-Way Flightcase Set",
    code: "CASE-AST-01",
    type: "case",
    is_combination: true,
    category: "lighting",
    current_quantity: 8,
    image: "https://images.unsplash.com/photo-1517457373958-b7bdd4587205?auto=format&fit=crop&w=400&q=80",
    items: [
      { id: 201, qty: "8", name: "Astera AX3 LightDrop Fixture", code: "LIG-AX3", image: "" },
      {
        id: 202,
        qty: "1",
        name: "Schuko Male to IEC Mains Cable 1.5m",
        code: "CAB-PWR-01",
        image: "",
      },
      { id: 203, qty: "8", name: "Astera Diffusor Lens 32°", code: "ACC-LENS-32", image: "" },
      { id: 204, qty: "8", name: "Astera Diffusor Lens 120°", code: "ACC-LENS-120", image: "" },
      {
        id: 205,
        qty: "8",
        name: "Astera Diffusor Dome Lens 220°",
        code: "ACC-DOME-220",
        image: "",
      },
      { id: 206, qty: "8", name: "Astera Hook with M4 Thread", code: "RIG-HOOK-M4", image: "" },
      { id: 207, qty: "8", name: "Astera Rubber Power Socket Plug", code: "ACC-PLUG-RUB", image: "" },
      {
        id: 208,
        qty: "1",
        name: "Astera ARC1 Infrared Remote Control",
        code: "CTRL-ARC1",
        image: "",
      },
    ],
  },
  {
    id: 102,
    name: "Sony FX6 Cinema Camera Production Kit",
    code: "KIT-CAM-FX6",
    type: "case",
    is_combination: true,
    category: "video",
    current_quantity: 4,
    image: "https://images.unsplash.com/photo-1516035069371-29a1b244cc32?auto=format&fit=crop&w=400&q=80",
    items: [
      {
        id: 211,
        qty: "1",
        name: "Sony FX6 Full-Frame Cinema Camera Body 4K",
        code: "CAM-FX6-01",
        image: "",
      },
      {
        id: 212,
        qty: "1",
        name: "Sony FE 24-70mm f/2.8 GM II Zoom Lens",
        code: "OPT-2470-GM",
        image: "",
      },
      {
        id: 213,
        qty: "2",
        name: "Sony BP-U70 High Capacity Lithium Battery",
        code: "BAT-BPU70",
        image: "",
      },
      { id: 214, qty: "1", name: "Sony BC-CU1 Dual Battery Charger", code: "CHG-BPU-02", image: "" },
      {
        id: 215,
        qty: "2",
        name: "SanDisk Extreme Pro 1TB Portable SSD USB-C",
        code: "REC-SSD-1TB",
        image: "",
      },
      {
        id: 216,
        qty: "2",
        name: "Canare 12G-SDI 4K BNC Coaxial Cable 3m",
        code: "CAB-SDI-3M",
        image: "",
      },
      {
        id: 217,
        qty: "1",
        name: "SmallRig Top Handle & Monitor Bracket",
        code: "RIG-FX6-TH",
        image: "",
      },
    ],
  },
  {
    id: 103,
    name: "Sennheiser EW-DX Wireless Dual Mic Set",
    code: "KIT-MIC-EWDX",
    type: "case",
    is_combination: true,
    category: "audio",
    current_quantity: 6,
    image: "https://images.unsplash.com/photo-1590602847861-f357a9332bbc?auto=format&fit=crop&w=400&q=80",
    items: [
      {
        id: 221,
        qty: "1",
        name: "Sennheiser EW-DX EM2 Dual Channel Receiver",
        code: "AUD-EWDX-REC",
        image: "",
      },
      {
        id: 222,
        qty: "2",
        name: "Sennheiser EW-DX SKM-S Handheld Transmitter",
        code: "AUD-SKM-835",
        image: "",
      },
      { id: 223, qty: "2", name: "BNC 1/2 Wave Rod Antennas", code: "AUD-ANT-BNC", image: "" },
      {
        id: 224,
        qty: "4",
        name: "Sennheiser BA 70 Rechargeable Battery Pack",
        code: "BAT-BA70",
        image: "",
      },
      {
        id: 225,
        qty: "1",
        name: "NT 12-5 CW+ Universal Power Supply EU/UK",
        code: "PWR-NT12-5",
        image: "",
      },
      { id: 226, qty: "2", name: "Microphone Stand Clamps MZQ 1", code: "RIG-MZQ1", image: "" },
    ],
  },
  {
    id: 104,
    name: "Aputure STORM 80c RGBWW 3-Light Kit",
    code: "KIT-APU-80C",
    type: "case",
    is_combination: true,
    category: "lighting",
    current_quantity: 2,
    image: "https://images.unsplash.com/photo-1507676184212-d03ab07a01bf?auto=format&fit=crop&w=400&q=80",
    items: [
      {
        id: 231,
        qty: "3",
        name: "Aputure STORM 80c Lamp Head (BLAIR-CG)",
        code: "LIG-STORM-80C",
        image: "",
      },
      {
        id: 232,
        qty: "3",
        name: "STORM 80c Hyper Reflector (Mini Pro Lock)",
        code: "OPT-REF-80C",
        image: "",
      },
      {
        id: 233,
        qty: "3",
        name: "Aputure CF4 Fresnel with Barn Doors",
        code: "OPT-FRES-CF4",
        image: "",
      },
      {
        id: 234,
        qty: "3",
        name: "STORM 80c Mini Lantern Diffuser",
        code: "OPT-LANT-80C",
        image: "",
      },
      { id: 235, qty: "3", name: "Locking AC Power Cable 4.0m", code: "CAB-AC-LOCK", image: "" },
      {
        id: 236,
        qty: "3",
        name: 'Aputure Super Clamp with 5/8" Stud',
        code: "RIG-CLAMP-APU",
        image: "",
      },
    ],
  },
  {
    id: 105,
    name: "Showtec Phantom 65 Spot Moving Head Twin Case",
    code: "CASE-SHW-65",
    type: "case",
    is_combination: true,
    category: "lighting",
    current_quantity: 4,
    image: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=400&q=80",
    items: [
      {
        id: 241,
        qty: "2",
        name: "Showtec Phantom 65 LED Moving Head Spot",
        code: "LIG-PHANT-65",
        image: "",
      },
      {
        id: 242,
        qty: "2",
        name: "Fast-Lock Quick-Release Omega Clamps",
        code: "RIG-OMEGA-01",
        image: "",
      },
      {
        id: 243,
        qty: "2",
        name: "Certified Safety Eyebolt Steel Wire 35kg",
        code: "RIG-SAFE-35",
        image: "",
      },
      {
        id: 244,
        qty: "2",
        name: "PowerCON TRUE1 TOP Mains Input Cable 1.5m",
        code: "CAB-TRUE1-15",
        image: "",
      },
      { id: 245, qty: "2", name: "DMX 5-Pin XLR Data Link Cable 3m", code: "CAB-DMX-3M", image: "" },
    ],
  },
  {
    id: 106,
    name: "Blackmagic ATEM Mini Extreme ISO Switcher Kit",
    code: "KIT-BMD-ATEM",
    type: "case",
    is_combination: true,
    category: "video",
    current_quantity: 3,
    image: "https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?auto=format&fit=crop&w=400&q=80",
    items: [
      {
        id: 251,
        qty: "1",
        name: "Blackmagic ATEM Mini Extreme ISO 8-Input Switcher",
        code: "VID-ATEM-EXT",
        image: "",
      },
      {
        id: 252,
        qty: "1",
        name: "12V 36W Power Supply with Lock Plug",
        code: "PWR-ATEM-12V",
        image: "",
      },
      { id: 253, qty: "2", name: "High Speed 4K HDMI 2.0 Cable 2m", code: "CAB-HDMI-2M", image: "" },
      {
        id: 254,
        qty: "1",
        name: "SanDisk Extreme Pro 1TB Portable SSD USB-C",
        code: "REC-SSD-1TB",
        image: "",
      },
    ],
  },
  {
    id: 107,
    name: "Sony ILME-FR7 Cinema PTZ Camera 4K",
    code: "CAM-FR7-01",
    type: "item",
    is_combination: false,
    category: "video",
    current_quantity: 2,
    image: "https://images.unsplash.com/photo-1502920917128-1aa500764cbd?auto=format&fit=crop&w=400&q=80",
  },
  {
    id: 108,
    name: "Neutrik EtherCON Cat6A Tour Grade Cable Reel 50m",
    code: "CAB-ETH-50M",
    type: "item",
    is_combination: false,
    category: "cables",
    current_quantity: 12,
    image: "https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?auto=format&fit=crop&w=400&q=80",
  },
  {
    id: 109,
    name: "63A 3-Phase to 4x 16A CEE Power Distribution Box",
    code: "PWR-DIST-63A",
    type: "item",
    is_combination: false,
    category: "power",
    current_quantity: 4,
    image: "https://images.unsplash.com/photo-1558494949-ef010cbdcc31?auto=format&fit=crop&w=400&q=80",
  },
];

function handleRentmanDemoRequest(endpoint, params = {}) {
  if (endpoint.includes("/equipmentsetscontent")) {
    const match = endpoint.match(/\/equipment\/(\d+)\/equipmentsetscontent/);
    const id = match ? parseInt(match[1], 10) : null;
    const parentKit = RENTMAN_SAMPLE_DATA.find((k) => k.id === id);
    if (parentKit && parentKit.items) {
      return {
        data: parentKit.items.map((it, idx) => ({
          id: idx + 1,
          quantity: it.qty,
          equipment: {
            id: it.id,
            name: it.name,
            code: it.code,
            image: { url: it.image },
          },
        })),
        itemCount: parentKit.items.length,
      };
    }
    return { data: [], itemCount: 0 };
  }

  return {
    data: RENTMAN_SAMPLE_DATA,
    itemCount: RENTMAN_SAMPLE_DATA.length,
    limit: 300,
    offset: 0,
  };
}

/**
 * STRICTLY READ-ONLY Rentman API Client
 * This client exclusively performs HTTP GET requests to inspect equipment, view photos,
 * and read kit contents. It NEVER sends POST, PUT, PATCH, or DELETE requests.
 */
async function fetchRentman(endpoint, params = {}) {
  if (rentmanConfig.useDemo || !rentmanConfig.token) {
    return handleRentmanDemoRequest(endpoint, params);
  }

  let pathOnly = endpoint;
  const mergedParams = { ...params };
  if (endpoint.includes("?")) {
    const parts = endpoint.split("?");
    pathOnly = parts[0];
    const existingParams = new URLSearchParams(parts[1]);
    for (const [k, v] of existingParams.entries()) {
      if (mergedParams[k] === undefined) {
        mergedParams[k] = v;
      }
    }
  }

  const queryStr = new URLSearchParams(mergedParams).toString();
  const urlPath = pathOnly + (queryStr ? "?" + queryStr : "");
  // Through the app: it adds the token, and only ever sends GET requests to api.rentman.net
  return appCall("rentman.get", urlPath);
}

let rentmanCatalogLoading = false;
let rentmanCatalogLoaded = false;

function updateRentmanLoadingStatus(text) {
  const statusEl = document.getElementById("rentmanCatalogLoadingMsg");
  if (statusEl) {
    if (text) {
      statusEl.style.display = "inline-flex";
      statusEl.innerHTML = `<span class="btn-spinner" style="font-size:0.75rem;">⏳</span> ${escapeHtml(text)}`;
    } else {
      statusEl.style.display = "none";
      statusEl.innerText = "";
    }
  }
  const summaryEl = document.getElementById("rentmanResultSummary");
  if (summaryEl && text) {
    summaryEl.innerText = text;
  }
}

function mapRentmanItemToNormalized(item) {
  let imgUrl = null;
  // No token in the URL: the app adds it when it loads the image (see the error listener at the top)
  if (item.image && typeof item.image === "object") {
    if (item.image.url) {
      imgUrl = `/api/rentman-image?url=${encodeURIComponent(item.image.url)}`;
    } else if (item.image.id) {
      imgUrl = `/api/rentman-image?url=${encodeURIComponent(`https://api.rentman.net/files/${item.image.id}`)}`;
    }
  } else if (typeof item.image === "string" && item.image.startsWith("http")) {
    imgUrl = `/api/rentman-image?url=${encodeURIComponent(item.image)}`;
  }
  const itemName = (item.name || item.displayname || "Unnamed Equipment").trim();
  const itemCode = (item.code || "").trim();
  const isKit = !!(item.is_combination || item.type === "case" || item.type === "set");
  return {
    id: item.id,
    name: itemName,
    code: itemCode,
    type: item.type || (isKit ? "case" : "item"),
    is_combination: isKit,
    quantity: item.current_quantity || 1,
    category: detectCategoryFromName(itemName),
    image: resolveRentmanImage(itemName, imgUrl),
    items: item.items || null,
  };
}

async function loadFullRentmanCatalog(forceRefresh = false) {
  if (rentmanConfig.useDemo || !rentmanConfig.token) {
    rentmanCachedEquipment = RENTMAN_SAMPLE_DATA;
    rentmanCatalogLoaded = true;
    return rentmanCachedEquipment;
  }

  if (rentmanCachedEquipment.length > 0 && !forceRefresh && rentmanCatalogLoaded) {
    return rentmanCachedEquipment;
  }

  if (rentmanCatalogLoading) {
    return rentmanCachedEquipment;
  }

  rentmanCatalogLoading = true;
  updateRentmanLoadingStatus("Connecting to Rentman API...");

  let allRawItems = [];
  let nextUrl =
    "/equipment?limit=1500&fields=id,name,code,current_quantity,image,type,is_combination,folder&expand=image";

  try {
    let pageCount = 0;
    while (nextUrl) {
      pageCount++;
      updateRentmanLoadingStatus(
        `Loading Rentman inventory (page ${pageCount}, ${allRawItems.length} items loaded)...`,
      );

      const resp = await fetchRentman(nextUrl);
      const items = Array.isArray(resp) ? resp : resp && resp.data ? resp.data : [];
      if (Array.isArray(items) && items.length > 0) {
        allRawItems = allRawItems.concat(items);
      }

      if (resp && resp.next_page_url) {
        try {
          const parsed = new URL(resp.next_page_url);
          nextUrl = parsed.pathname + parsed.search;
        } catch (_) {
          nextUrl = resp.next_page_url.replace(/^https?:\/\/[^/]+/i, "");
        }
      } else {
        nextUrl = null;
      }
    }

    if (allRawItems.length > 0) {
      rentmanCachedEquipment = allRawItems.map(mapRentmanItemToNormalized);
      rentmanCatalogLoaded = true;

      try {
        const cachePayload = rentmanCachedEquipment.map((it) => ({
          id: it.id,
          name: it.name,
          code: it.code,
          type: it.type,
          is_combination: it.is_combination,
          quantity: it.quantity,
          category: it.category,
          image: it.image,
        }));
        localStorage.setItem("rentman_cached_catalog", JSON.stringify(cachePayload));
        localStorage.setItem("rentman_cached_catalog_time", Date.now().toString());
      } catch (err) {
        console.warn("Storage quota exceeded caching rentman catalog:", err);
      }
    }
  } catch (err) {
    console.error("Error loading full Rentman catalog:", err);
    if (rentmanCachedEquipment.length === 0) {
      try {
        const saved = localStorage.getItem("rentman_cached_catalog");
        if (saved) {
          rentmanCachedEquipment = JSON.parse(saved);
          rentmanCatalogLoaded = true;
        }
      } catch (_) {}
    }
  } finally {
    rentmanCatalogLoading = false;
    updateRentmanLoadingStatus("");
  }

  return rentmanCachedEquipment;
}

// A catalog cached by an older version has guessed icons stored as the item's image. Keep only a real Rentman photo (or
// a sample item's own icon) and look everything else up again with the strict name match. Runs once per item.
function recheckCachedRentmanImage(item) {
  if (!item || item.imageChecked) return;
  item.imageChecked = true;
  const isRentmanPhoto = typeof item.image === "string" && item.image.startsWith("/api/rentman-image");
  if (isRentmanPhoto) return;
  item.image = resolveRentmanImage(item.name || "", "");
}

async function searchRentman(query = "", category = "all", typeFilter = "all") {
  // If catalog is not loaded yet and we have a token, start loading
  if (!rentmanConfig.useDemo && rentmanConfig.token && !rentmanCatalogLoaded && !rentmanCatalogLoading) {
    if (rentmanCachedEquipment.length === 0) {
      try {
        const saved = localStorage.getItem("rentman_cached_catalog");
        if (saved) {
          rentmanCachedEquipment = JSON.parse(saved);
        }
      } catch (_) {}
    }
    loadFullRentmanCatalog().then(() => {
      const modal = document.getElementById("rentmanModal");
      if (modal && !modal.classList.contains("hidden")) {
        const input = document.getElementById("rentmanSearchInput");
        if (input && input.value.trim() === query.trim()) {
          window.renderRentmanEquipmentSearchResults();
        }
      }
    });
  } else if (rentmanConfig.useDemo && rentmanCachedEquipment.length === 0) {
    rentmanCachedEquipment = RENTMAN_SAMPLE_DATA;
    rentmanCatalogLoaded = true;
  }

  let equipmentList =
    rentmanCachedEquipment.length > 0 ? rentmanCachedEquipment : rentmanConfig.useDemo ? RENTMAN_SAMPLE_DATA : [];
  const q = (query || "").toLowerCase().trim();

  // Search filtering
  let results = equipmentList.filter((item) => {
    // Type filter
    if (typeFilter === "kits" && !item.is_combination && item.type !== "case" && item.type !== "set") {
      return false;
    }
    if (typeFilter === "items" && (item.is_combination || item.type === "case" || item.type === "set")) {
      return false;
    }
    // Category filter
    if (category !== "all" && item.category !== category) {
      return false;
    }
    if (!q) return true;

    const itemName = item.name ? item.name.toLowerCase() : "";
    const itemCode = item.code ? item.code.toLowerCase() : "";
    if (itemName.includes(q)) return true;
    if (itemCode.includes(q)) return true;
    return false;
  });

  results.forEach(recheckCachedRentmanImage);

  // Fast direct server query fallback for exact codes / names:
  // If results are 0 or catalog is still loading, query Rentman directly by code and name
  if (
    q &&
    q.length >= 2 &&
    !rentmanConfig.useDemo &&
    rentmanConfig.token &&
    (results.length === 0 || rentmanCatalogLoading)
  ) {
    try {
      const codeResp = await fetchRentman("/equipment", {
        code: query.trim(),
        expand: "image",
        limit: 20,
      });
      const codeItems = Array.isArray(codeResp) ? codeResp : codeResp && codeResp.data ? codeResp.data : [];
      if (codeItems && codeItems.length > 0) {
        codeItems.forEach((ci) => {
          const norm = mapRentmanItemToNormalized(ci);
          if (!results.some((r) => r.id === norm.id)) results.unshift(norm);
          if (!rentmanCachedEquipment.some((r) => r.id === norm.id)) rentmanCachedEquipment.push(norm);
        });
      }
    } catch (_) {}
  }

  // Sort results intelligently:
  if (q) {
    results.sort((a, b) => {
      const aCode = (a.code || "").toLowerCase();
      const bCode = (b.code || "").toLowerCase();
      const aName = (a.name || "").toLowerCase();
      const bName = (b.name || "").toLowerCase();

      // Exact code match gets absolute top priority
      if (aCode === q && bCode !== q) return -1;
      if (bCode === q && aCode !== q) return 1;

      // Name starts with query
      if (aName.startsWith(q) && !bName.startsWith(q)) return -1;
      if (bName.startsWith(q) && !aName.startsWith(q)) return 1;

      // Code starts with query
      if (aCode.startsWith(q) && !bCode.startsWith(q)) return -1;
      if (bCode.startsWith(q) && !aCode.startsWith(q)) return 1;

      // Kits before single items
      if (a.is_combination && !b.is_combination) return -1;
      if (!a.is_combination && b.is_combination) return 1;

      return aName.localeCompare(bName);
    });
  }

  return results;
}

async function generateCardFromRentman(item) {
  if (!item) return;
  const isKit = item.is_combination || item.type === "case" || item.type === "set";
  let subItems = [];

  if (item.items && item.items.length > 0) {
    subItems = item.items;
  } else if (isKit) {
    try {
      const setsResp = await fetchRentman(`/equipment/${item.id}/equipmentsetscontent`, {
        expand: "equipment,equipment.image",
      });
      const list = Array.isArray(setsResp) ? setsResp : setsResp && setsResp.data ? setsResp.data : [];
      if (list.length > 0) {
        subItems = list.map((d) => {
          let eq = d.equipment;
          if (typeof eq === "number" && Array.isArray(rentmanCachedEquipment)) {
            const cached = rentmanCachedEquipment.find((c) => c && c.id === eq);
            if (cached) eq = cached;
          }
          if (!eq || typeof eq !== "object") eq = {};

          let eqImg = null;
          if (eq.image && typeof eq.image === "object") {
            if (eq.image.url) {
              eqImg = `/api/rentman-image?url=${encodeURIComponent(eq.image.url)}`;
            } else if (eq.image.id) {
              eqImg = `/api/rentman-image?url=${encodeURIComponent(`https://api.rentman.net/files/${eq.image.id}`)}`;
            }
          } else if (typeof eq.image === "string") {
            eqImg = eq.image.startsWith("http") ? `/api/rentman-image?url=${encodeURIComponent(eq.image)}` : eq.image;
          }

          const eqName = (eq.name || d.name || "Equipment Item").trim();
          return {
            id: String(eq.id || d.id || Date.now() + Math.random()),
            qty: String(d.quantity || "1"),
            name: eqName,
            code: (eq.code || "").trim(),
            image: resolveRentmanImage(eqName, eqImg),
          };
        });
      }
    } catch (e) {
      console.warn("Error fetching kit contents from Rentman:", e);
    }
  }

  if (subItems.length === 0) {
    subItems = [
      {
        id: String(Date.now()),
        qty: String(item.quantity || "1"),
        name: item.name || "Equipment Item",
        code: item.code || "",
        image: resolveRentmanImage(item.name || "", item.image),
      },
    ];
  }

  const cardItems = subItems.map((si) => {
    const sName = (si.name || "Equipment Item").trim();
    let contentText = sName;
    if (rentmanConfig.includeCodeInContent && si.code) {
      contentText = `[${si.code}]\n${sName}`;
    }
    try {
      registerOrUpdateGlobalGear(sName, si.image, null, false);
    } catch (e) {
      console.warn("Could not register gear:", e);
    }

    if (si.code && Array.isArray(customGearDb)) {
      const gearMatch = customGearDb.find(
        (g) => g && g.name && typeof g.name === "string" && g.name.toLowerCase() === sName.toLowerCase(),
      );
      if (gearMatch) gearMatch.code = si.code;
    }

    return {
      id: String(Date.now()) + "-" + Math.random().toString(36).substr(2, 4),
      qty: String(si.qty || "1"),
      content: contentText,
      image: si.image || "",
      noImage: !si.image,
    };
  });

  const itemName = (item.name || "Equipment Case").trim();
  currentCard = {
    title:
      itemName
        .replace(/\s*-\s*.*Set.*/i, "")
        .replace(/Flightcase.*$/i, "")
        .trim() || itemName,
    subtitle: itemName.includes("-") ? itemName.split("-")[1].trim() : "Equipment Kit",
    tag: rentmanConfig.setCodeAsCaseTag && item.code ? item.code : currentCard ? currentCard.tag || "" : "",
    pattern: currentCard ? currentCard.pattern || "diamonds" : "diamonds",
    company: currentCard && currentCard.company !== undefined ? currentCard.company : "STREAM MY EVENT",
    phone: currentCard && currentCard.phone !== undefined ? currentCard.phone : "+31(0)20 369 0970",
    website: currentCard && currentCard.website !== undefined ? currentCard.website : "www.streammyevent.com",
    logo: currentCard ? currentCard.logo || "sme-live" : "sme-live",
    dimensions: currentCard ? currentCard.dimensions || "105x148" : "105x148",
    photoColWidth: currentCard ? currentCard.photoColWidth || 52 : 52,
    items: cardItems,
  };

  saveActiveCardState();
  renderCard();
  renderSidebar();

  const rentmanModal = document.getElementById("rentmanModal");
  if (rentmanModal) rentmanModal.classList.add("hidden");
  const webImportModal = document.getElementById("webImportModal");
  if (webImportModal) webImportModal.classList.add("hidden");

  showToastNotification(`Generated FlightCase Card from Rentman: "${itemName}" (${cardItems.length} items)`, "⚡");
}

function addRentmanItemToCurrentCard(item) {
  if (!item) return;
  const itemName = (item.name || "Equipment Item").trim();
  const itemCode = (item.code || "").trim();
  const desc = rentmanConfig.includeCodeInContent && itemCode ? `[${itemCode}]\n${itemName}` : itemName;

  try {
    registerOrUpdateGlobalGear(itemName, item.image, null, false);
  } catch (e) {
    console.warn("Could not register gear:", e);
  }

  if (!currentCard.items) currentCard.items = [];
  const image = resolveRentmanImage(itemName, item.image);
  currentCard.items.push({
    id: String(Date.now()) + "-" + Math.random().toString(36).substr(2, 4),
    qty: String(item.quantity || "1"),
    content: desc,
    image,
    noImage: !image,
  });

  saveActiveCardState();
  renderCard();
  renderSidebar();

  const rentmanModal = document.getElementById("rentmanModal");
  if (rentmanModal) rentmanModal.classList.add("hidden");

  showToastNotification(`Added "${itemName}" to card!`, "➕");
}

function importRentmanItemToGearDb(item, notify = true) {
  if (!item) return;
  const cleanName = (item.name || "Equipment Item").trim();
  const cleanCode = (item.code || "").trim();
  const cat = item.category || detectCategoryFromName(cleanName);
  const aliases = [cleanName.toLowerCase()];
  if (cleanCode) aliases.push(cleanCode.toLowerCase());

  const existingIdx = Array.isArray(customGearDb)
    ? customGearDb.findIndex(
        (g) =>
          (g && g.name && typeof g.name === "string" && g.name.toLowerCase() === cleanName.toLowerCase()) ||
          (g && g.code && cleanCode && typeof g.code === "string" && g.code.toLowerCase() === cleanCode.toLowerCase()),
      )
    : -1;

  const gearEntry = {
    id: `rentman-${item.id || Date.now()}`,
    name: cleanName,
    code: cleanCode,
    category: cat,
    aliases: aliases,
    image:
      resolveRentmanImage(cleanName, item.image) || (existingIdx >= 0 ? customGearDb[existingIdx].image : "") || "",
    isCustom: true,
    source: "rentman",
  };

  if (existingIdx >= 0) {
    customGearDb[existingIdx] = gearEntry;
  } else {
    customGearDb.push(gearEntry);
  }

  saveCustomGearToStorage();
  try {
    renderGearDbTabList();
  } catch (err) {
    console.error("renderGearDbTabList error:", err);
  }
  if (notify) {
    showToastNotification(`Saved "[${cleanCode || "EQ"}] ${cleanName}" to Global Gear DB!`, "💾");
  }
}

function importAllRentmanResultsToGearDb(items) {
  if (!items || items.length === 0) {
    showToastNotification("No Rentman items in search results to import.", "⚠️", "info");
    return;
  }
  let count = 0;
  items.forEach((item) => {
    importRentmanItemToGearDb(item, false);
    count++;
    if (item.items && Array.isArray(item.items)) {
      item.items.forEach((sub) => {
        importRentmanItemToGearDb(
          {
            id: `${item.id}-${sub.id || Math.random()}`,
            name: sub.name,
            code: sub.code,
            category: detectCategoryFromName(sub.name),
            image: sub.image,
          },
          false,
        );
        count++;
      });
    }
  });
  updateGearDbCounters();
  try {
    renderGearDbTabList();
  } catch (err) {
    console.error("renderGearDbTabList error:", err);
  }
  showToastNotification(`Imported ${count} Rentman items & photos into Global Gear DB!`, "📥");
}

function initRentmanModule() {
  const modal = document.getElementById("rentmanModal");
  const openBtn = document.getElementById("openRentmanBtn");
  const openFromDbBtn = document.getElementById("openRentmanFromGearDbBtn");
  const openFromImportBtn = document.getElementById("openRentmanFromImportModalBtn");
  const closeBtn = document.getElementById("closeRentmanModalBtn");
  const closeFooterBtn = document.getElementById("closeRentmanModalFooterBtn");

  const searchInput = document.getElementById("rentmanSearchInput");
  const typeFilter = document.getElementById("rentmanTypeFilter");
  const categoryFilter = document.getElementById("rentmanCategoryFilter");
  const demoCb = document.getElementById("rentmanUseDemoCb");
  const tokenInput = document.getElementById("rentmanTokenInput");
  const tokenRow = document.getElementById("rentmanTokenRow");
  const toggleVisBtn = document.getElementById("toggleRentmanTokenVisBtn");
  const testConnBtn = document.getElementById("testRentmanConnBtn");
  const batchSyncBtn = document.getElementById("rentmanBatchSyncBtn");
  const includeCodeCb = document.getElementById("rentmanIncludeCodeInDesc");
  const setCodeTagCb = document.getElementById("rentmanSetCodeAsTag");
  const statusBadge = document.getElementById("rentmanStatusBadge");
  const webImportBadge = document.getElementById("webImportRentmanBadge");

  // Sync initial configuration states (again once the saved token has loaded)
  const syncTokenUi = () => {
    if (tokenInput) tokenInput.value = rentmanConfig.token;
    if (demoCb) demoCb.checked = rentmanConfig.useDemo;
    if (tokenRow) tokenRow.classList.toggle("hidden", rentmanConfig.useDemo);
  };
  syncTokenUi();
  if (includeCodeCb) includeCodeCb.checked = rentmanConfig.includeCodeInContent;
  if (setCodeTagCb) setCodeTagCb.checked = rentmanConfig.setCodeAsCaseTag;

  const updateStatusDisplay = () => {
    if (rentmanConfig.useDemo) {
      if (statusBadge) {
        statusBadge.className = "rentman-status-badge demo";
        statusBadge.innerText = "Demo mode (sample catalogue)";
      }
      if (webImportBadge) {
        webImportBadge.className = "rentman-status-badge demo";
        webImportBadge.innerText = "⚡ Demo Mode (Active)";
      }
    } else if (rentmanConfig.connected) {
      if (statusBadge) {
        statusBadge.className = "rentman-status-badge";
        statusBadge.innerText = "Connected to api.rentman.net";
      }
      if (webImportBadge) {
        webImportBadge.className = "rentman-status-badge";
        webImportBadge.innerText = "🟢 Connected";
      }
    } else {
      if (statusBadge) {
        statusBadge.className = "rentman-status-badge disconnected";
        statusBadge.innerText = "Not connected · enter your token and test the connection";
      }
      if (webImportBadge) {
        webImportBadge.className = "rentman-status-badge disconnected";
        webImportBadge.innerText = "○ Not connected";
      }
    }
  };
  updateStatusDisplay();
  loadRentmanToken()
    .then(() => {
      syncTokenUi();
      updateStatusDisplay();
    })
    .catch((e) => console.warn("Could not load the Rentman token:", e));

  let currentSearchResults = [];

  const performSearch = async () => {
    const list = document.getElementById("rentmanEquipmentList");
    if (!list) return;
    list.innerHTML = `<div style="grid-column: 1 / -1; text-align:center; padding:30px; color:var(--text-muted); font-size:0.85rem;"><span class="btn-spinner">⏳</span> Searching Rentman equipment catalog...</div>`;

    const q = searchInput ? searchInput.value : "";
    const type = typeFilter ? typeFilter.value : "all";
    const cat = categoryFilter ? categoryFilter.value : "all";

    const results = await searchRentman(q, cat, type);
    currentSearchResults = results;

    const summary = document.getElementById("rentmanResultSummary");
    if (summary) {
      const modeStr = rentmanConfig.useDemo
        ? "Demo Mode"
        : `Live API &bull; ${rentmanCachedEquipment.length} items synced`;
      summary.innerHTML = `Found <strong>${results.length}</strong> equipment items in Rentman (${modeStr})`;
    }

    list.innerHTML = "";
    if (results.length === 0) {
      list.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1">No items found matching "${escapeHtml(q)}". Try searching by code (e.g. <code>P1217</code>, <code>3091</code>, <code>FR7</code>) or switch filters.</div>`;
      return;
    }

    results.forEach((item) => {
      const card = document.createElement("div");
      card.className = "rentman-item-card";

      const thumbHtml = imageHtml(item.image, `alt="${escapeHtml(item.name)}" loading="lazy"`) || NO_IMAGE_HTML;

      const isKit = item.is_combination || item.type === "case" || item.type === "set";
      const codeHtml = item.code ? `<span class="rentman-code-tag">${escapeHtml(item.code)}</span>` : "";
      const typeHtml = isKit ? `<span class="rentman-kit-badge">Kit</span>` : `<span class="pill">Item</span>`;

      card.innerHTML = `
        <div>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            ${codeHtml}
            ${typeHtml}
          </div>
          <div class="rentman-item-thumb">
            ${thumbHtml}
          </div>
          <h4 style="font-size:14px; font-weight:600; margin:8px 0 4px 0; line-height:1.3; overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;">
            ${escapeHtml(item.name)}
          </h4>
          <div style="font-size:12px; color:var(--muted);">${escapeHtml(item.category)} · qty ${escapeHtml(item.quantity || 1)}</div>
        </div>
        <div style="display:flex; gap:6px; flex-direction:column;">
          <button type="button" class="btn ${isKit ? "btn-primary" : "btn-secondary"} btn-sm rentman-gen-card-btn" style="width:100%;">
            ${isKit ? "Create card" : "Add to card"}
          </button>
          <button type="button" class="btn btn-secondary btn-sm rentman-save-db-btn" style="width:100%;">
            Save photo to gear database
          </button>
        </div>
      `;

      const genBtn = card.querySelector(".rentman-gen-card-btn");
      if (genBtn) {
        genBtn.addEventListener("click", async () => {
          const origText = genBtn.innerHTML;
          genBtn.innerHTML = isKit ? "Creating card…" : "Adding…";
          genBtn.disabled = true;
          try {
            if (isKit) {
              await generateCardFromRentman(item);
            } else {
              addRentmanItemToCurrentCard(item);
            }
          } catch (err) {
            console.error("Rentman action error:", err);
            showToastNotification("Action failed: " + (err.message || err), "⚠️", "error");
          } finally {
            genBtn.innerHTML = origText;
            genBtn.disabled = false;
          }
        });
      }

      const saveDbBtn = card.querySelector(".rentman-save-db-btn");
      if (saveDbBtn) {
        saveDbBtn.addEventListener("click", () => {
          try {
            importRentmanItemToGearDb(item, true);
          } catch (err) {
            console.error("Save to Gear DB error:", err);
            showToastNotification("Could not save to DB: " + (err.message || err), "⚠️", "error");
          }
        });
      }

      list.appendChild(card);
    });
  };

  window.renderRentmanEquipmentSearchResults = performSearch;

  const openModal = () => {
    if (modal) modal.classList.remove("hidden");
    if (!rentmanConfig.useDemo && rentmanConfig.token && !rentmanCatalogLoaded && !rentmanCatalogLoading) {
      loadFullRentmanCatalog().then(() => {
        performSearch();
      });
    }
    performSearch();
  };
  window.openRentmanModal = openModal;

  if (openBtn) openBtn.addEventListener("click", openModal);
  if (openFromDbBtn) openFromDbBtn.addEventListener("click", openModal);
  if (openFromImportBtn) openFromImportBtn.addEventListener("click", openModal);

  const closeModal = () => {
    if (modal) modal.classList.add("hidden");
  };
  if (closeBtn) closeBtn.addEventListener("click", closeModal);
  if (closeFooterBtn) closeFooterBtn.addEventListener("click", closeModal);
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });
  }

  let searchDebounceTimer = null;
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(performSearch, 150);
    });
  }
  if (typeFilter) typeFilter.addEventListener("change", performSearch);
  if (categoryFilter) categoryFilter.addEventListener("change", performSearch);

  const refreshCatalogBtn = document.getElementById("rentmanRefreshCatalogBtn");
  if (refreshCatalogBtn) {
    refreshCatalogBtn.addEventListener("click", async () => {
      refreshCatalogBtn.disabled = true;
      refreshCatalogBtn.innerHTML = "⏳ Syncing...";
      try {
        await loadFullRentmanCatalog(true);
        showToastNotification(`Synced ${rentmanCachedEquipment.length} equipment items from Rentman!`, "🔄");
        performSearch();
      } catch (err) {
        showToastNotification("Catalog sync failed: " + err.message, "⚠️", "error");
      } finally {
        refreshCatalogBtn.disabled = false;
        refreshCatalogBtn.innerHTML = "🔄 Refresh Inventory";
      }
    });
  }

  if (demoCb) {
    demoCb.addEventListener("change", (e) => {
      rentmanConfig.useDemo = e.target.checked;
      if (tokenRow) tokenRow.classList.toggle("hidden", e.target.checked);
      rentmanCachedEquipment = [];
      updateStatusDisplay();
      performSearch();
    });
  }

  if (toggleVisBtn && tokenInput) {
    toggleVisBtn.addEventListener("click", () => {
      tokenInput.type = tokenInput.type === "password" ? "text" : "password";
    });
  }

  if (testConnBtn && tokenInput) {
    testConnBtn.addEventListener("click", async () => {
      const val = tokenInput.value.trim();
      if (!val) {
        alert("Please enter your Rentman API JWT token.");
        return;
      }
      testConnBtn.innerText = "Testing...";
      const previous = rentmanConfig.token;
      rentmanConfig.token = val;
      rentmanConfig.useDemo = false;
      try {
        if (!window.toolbox) throw new Error("This needs the Producers Toolbox app.");
        // The app keeps the token encrypted and uses it for every Rentman request
        await window.toolbox.secrets.set("rentmanToken", val);
        const testRes = await fetchRentman("/equipment", { limit: 1 }).catch(async (err) => {
          if (previous) await window.toolbox.secrets.set("rentmanToken", previous);
          else await window.toolbox.secrets.remove("rentmanToken");
          rentmanConfig.token = previous;
          throw err;
        });
        if (testRes) {
          rentmanConfig.connected = true;
          updateStatusDisplay();
          showToastNotification("Connected to api.rentman.net successfully!", "🟢");
          await loadFullRentmanCatalog(true);
          performSearch();
        }
      } catch (err) {
        rentmanConfig.connected = false;
        updateStatusDisplay();
        alert("Could not connect to Rentman API:\n" + err.message + "\n\nPlease verify your JWT token.");
      } finally {
        testConnBtn.innerText = "Test & Connect";
      }
    });
  }

  if (includeCodeCb) {
    includeCodeCb.addEventListener("change", (e) => {
      rentmanConfig.includeCodeInContent = e.target.checked;
    });
  }

  if (setCodeTagCb) {
    setCodeTagCb.addEventListener("change", (e) => {
      rentmanConfig.setCodeAsCaseTag = e.target.checked;
    });
  }

  if (batchSyncBtn) {
    batchSyncBtn.addEventListener("click", () => {
      importAllRentmanResultsToGearDb(currentSearchResults);
    });
  }

  // Render quick kits in webImportModal
  renderRentmanQuickKits();
}

function renderRentmanQuickKits() {
  const container = document.getElementById("rentmanQuickKitsList");
  if (!container) return;
  container.innerHTML = "";

  const kits = RENTMAN_SAMPLE_DATA.filter((item) => item.is_combination || item.type === "case" || item.type === "set");
  kits.forEach((kit) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "rentman-kit-row";

    const thumbHtml =
      imageHtml(kit.image, 'alt="" style="width:100%; height:100%; object-fit:contain;"') || NO_IMAGE_HTML;

    btn.innerHTML = `
      <div style="display:flex; align-items:center; gap:10px; width:100%;">
        <div style="width:42px; height:42px; flex-shrink:0; background:#fff; border:1px solid var(--border); border-radius:8px; display:flex; align-items:center; justify-content:center; overflow:hidden; color:#1d1d1f">
          ${thumbHtml}
        </div>
        <div style="flex:1; overflow:hidden;">
          <div style="display:flex; gap:6px; align-items:center; margin-bottom:2px;">
            <span class="rentman-code-tag">${escapeHtml(kit.code)}</span>
            <span style="font-size:12px; color:var(--muted);">${kit.items ? kit.items.length : 0} items</span>
          </div>
          <strong style="font-size:13px; font-weight:600; display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
            ${escapeHtml(kit.name)}
          </strong>
        </div>
      </div>
    `;

    btn.addEventListener("click", async () => {
      btn.style.opacity = "0.6";
      try {
        await generateCardFromRentman(kit);
      } catch (err) {
        console.error("Rentman quick kit error:", err);
        showToastNotification("Error generating card: " + (err.message || err), "⚠️", "error");
      } finally {
        btn.style.opacity = "1";
      }
    });

    container.appendChild(btn);
  });
}
