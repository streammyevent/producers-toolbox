const $ = (id) => document.getElementById(id);
const grid = $("grid");
const menu = $("menu");
const menuBtn = $("menuBtn");

let tools = [];
let settings = {
  theme: "system",
  startWithWindows: false,
  minimizeToTray: false,
  autoCheckUpdates: true,
  pinnedTools: [],
  hiddenTools: [],
};
let updates = { app: { state: "idle" } };
const MORE = "M5 12h.01M12 12h.01M19 12h.01";

const STAR = "m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z";
const svg = (path) => {
  const ns = "http://www.w3.org/2000/svg";
  const el = document.createElementNS(ns, "svg");
  el.setAttribute("class", "ico ico-sm");
  el.setAttribute("viewBox", "0 0 24 24");
  const p = document.createElementNS(ns, "path");
  p.setAttribute("d", path);
  el.append(p);
  return el;
};

// ---- Theme ----
function applyTheme(pref) {
  try {
    localStorage.setItem("tb-theme", pref);
  } catch {}
  const dark = pref === "dark" || (pref !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
}
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (settings.theme === "system") applyTheme("system");
});

async function save(patch) {
  settings = await window.launcher.setSettings(patch);
  applyTheme(settings.theme);
  return settings;
}

// ---- Cards ----
function render() {
  const q = $("search").value.trim().toLowerCase();
  const pinned = new Set(settings.pinnedTools);
  const shown = tools
    .filter((t) => !q || t.name.toLowerCase().includes(q))
    .sort((a, b) => pinned.has(b.id) - pinned.has(a.id) || a.name.localeCompare(b.name));
  grid.replaceChildren();
  if (!shown.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = tools.length ? "No tools match your search." : "No tools found.";
    grid.append(p);
    return;
  }
  for (const t of shown) {
    const card = document.createElement("section");
    card.className = "card" + (t.running ? " running" : "");

    const top = document.createElement("div");
    top.className = "top";
    const icon = document.createElement("div");
    icon.className = "icon";
    if (t.icon) {
      const img = document.createElement("img");
      img.src = t.icon;
      img.alt = "";
      icon.append(img);
    } else {
      icon.textContent = t.name.slice(0, 1).toUpperCase();
    }
    const title = document.createElement("div");
    const h = document.createElement("h2");
    h.textContent = t.name;
    const v = document.createElement("small");
    v.textContent = t.version ? "v" + t.version : "";
    title.append(h, v);
    top.append(icon, title);

    const isPinned = pinned.has(t.id);
    const pin = document.createElement("button");
    pin.type = "button";
    pin.className = "icon-btn icon-btn-sm pin" + (isPinned ? " on" : "");
    pin.title = isPinned ? "Unpin" : "Pin to top";
    pin.setAttribute("aria-label", (isPinned ? "Unpin " : "Pin ") + t.name);
    pin.setAttribute("aria-pressed", String(isPinned));
    pin.append(svg(STAR));
    pin.addEventListener("click", async () => {
      const next = isPinned ? settings.pinnedTools.filter((id) => id !== t.id) : [...settings.pinnedTools, t.id];
      await save({ pinnedTools: next });
      render();
    });

    const status = document.createElement("span");
    status.className = "status";
    const dot = document.createElement("span");
    dot.className = "dot";
    status.append(dot, t.running ? "Running" : "Stopped");

    const actions = document.createElement("div");
    actions.className = "actions";
    const open = document.createElement("button");
    open.className = "btn btn-primary btn-sm";
    open.textContent = t.running ? "Show" : "Start";
    open.addEventListener("click", () => window.launcher.start(t.id));
    actions.append(open);
    if (t.running) {
      const stop = document.createElement("button");
      stop.className = "btn btn-danger btn-sm";
      stop.textContent = "Stop";
      stop.addEventListener("click", () => window.launcher.stop(t.id));
      actions.append(stop);
    }

    const more = document.createElement("button");
    more.type = "button";
    more.className = "icon-btn icon-btn-sm more";
    more.title = "More";
    more.setAttribute("aria-label", "More options for " + t.name);
    more.setAttribute("aria-haspopup", "menu");
    more.append(svg(MORE));
    const cardMenu = document.createElement("div");
    cardMenu.className = "dropdown-menu card-menu hidden";
    cardMenu.setAttribute("role", "menu");
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "dropdown-item danger";
    remove.setAttribute("role", "menuitem");
    remove.textContent = "Remove…";
    remove.addEventListener("click", () => {
      cardMenu.classList.add("hidden");
      window.launcher.removeTool(t.id);
    });
    cardMenu.append(remove);
    more.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = cardMenu.classList.contains("hidden");
      closeCardMenus();
      cardMenu.classList.toggle("hidden", !open);
    });

    card.append(top, status, actions, pin, more, cardMenu);
    grid.append(card);
  }
}

const closeCardMenus = () => document.querySelectorAll(".card-menu").forEach((m) => m.classList.add("hidden"));
document.addEventListener("click", (e) => {
  if (!e.target.closest(".card-menu")) closeCardMenus();
});

// ---- Menu ----
const setMenu = (open) => {
  menu.classList.toggle("hidden", !open);
  menuBtn.setAttribute("aria-expanded", String(open));
};
menuBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  setMenu(menu.classList.contains("hidden"));
});
document.addEventListener("click", (e) => {
  if (!menu.contains(e.target)) setMenu(false);
});

// ---- Modals ----
const openModal = (el) => {
  el.classList.remove("hidden");
  const first = el.querySelector("select, input, button");
  if (first) first.focus();
};
const closeModals = () => document.querySelectorAll(".modal-backdrop").forEach((m) => m.classList.add("hidden"));
document.querySelectorAll(".modal-backdrop").forEach((m) => {
  m.addEventListener("click", (e) => {
    if (e.target === m || e.target.closest("[data-close]")) m.classList.add("hidden");
  });
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeModals();
    setMenu(false);
    closeCardMenus();
  }
});

function openSettings() {
  $("setTheme").value = settings.theme;
  $("setStart").checked = settings.startWithWindows;
  $("setTray").checked = settings.minimizeToTray;
  $("setUpdates").checked = settings.autoCheckUpdates;
  renderHidden();
  openModal($("settingsModal"));
}
function renderHidden() {
  const n = settings.hiddenTools.length;
  $("hiddenRow").classList.toggle("hidden", !n);
  $("hiddenText").textContent = n === 1 ? "1 tool is hidden." : `${n} tools are hidden.`;
}
$("restoreHidden").addEventListener("click", async () => {
  await save({ hiddenTools: [] });
  renderHidden();
});
$("settingsSave").addEventListener("click", async () => {
  await save({
    theme: $("setTheme").value,
    startWithWindows: $("setStart").checked,
    minimizeToTray: $("setTray").checked,
    autoCheckUpdates: $("setUpdates").checked,
  });
  closeModals();
});

menu.addEventListener("click", async (e) => {
  const item = e.target.closest("[data-action]");
  if (!item || item.disabled) return;
  setMenu(false);
  switch (item.dataset.action) {
    case "settings":
      return openSettings();
    case "quit":
      return window.launcher.quit();
    case "uninstall":
      return window.launcher.uninstall();
    case "updates":
      openModal($("updatesModal"));
      renderUpdates();
      return checkUpdates();
    case "about": {
      const info = await window.launcher.appInfo();
      $("aboutText").textContent = `${info.name} v${info.version} (Electron ${info.electron})`;
      return openModal($("aboutModal"));
    }
  }
});

$("themeToggle").addEventListener("click", () => {
  const dark = document.documentElement.getAttribute("data-theme") === "dark";
  save({ theme: dark ? "light" : "dark" });
});
$("search").addEventListener("input", render);

// ---- Updates ----
let checkingNow = false;
async function checkUpdates() {
  checkingNow = true;
  renderUpdates();
  try {
    updates = await window.launcher.checkUpdates();
  } finally {
    checkingNow = false;
    renderUpdates();
  }
}

function appStatusText(a) {
  switch (a.state) {
    case "unsupported":
      return a.packaged
        ? "This build has no update feed; Toolbox updates need the version installed with the setup program."
        : "Toolbox updates are only available in the installed app.";
    case "checking":
      return "Checking for Toolbox updates…";
    case "up-to-date":
      return `The Toolbox is up to date (v${a.version}).`;
    case "downloading":
      return `Downloading Toolbox v${a.version || ""}… ${a.percent || 0}%`;
    case "downloaded":
      return `Toolbox v${a.version} is ready. Restart to finish updating.`;
    case "error":
      return `Could not check for Toolbox updates: ${a.message}`;
    default:
      return checkingNow ? "Checking for updates…" : "Not checked yet.";
  }
}

function renderUpdates() {
  const a = updates.app || { state: "idle" };
  $("updAppStatus").textContent = appStatusText(a);
  $("updProgress").classList.toggle("hidden", a.state !== "downloading");
  $("updProgress").firstElementChild.style.width = (a.percent || 0) + "%";
  $("updProgress").setAttribute("aria-valuenow", String(a.percent || 0));
  const ready = a.state === "downloaded";
  $("updRestart").classList.toggle("hidden", !ready);
  $("updatePill").classList.toggle("hidden", !ready);
  $("updCheck").disabled = checkingNow;
}
$("updCheck").addEventListener("click", checkUpdates);
$("updRestart").addEventListener("click", () => window.launcher.restartToUpdate());
$("updatePill").addEventListener("click", () => window.launcher.restartToUpdate());
window.launcher.onUpdateStatus((s) => {
  updates = s;
  renderUpdates();
});

// Main may change settings too (removing a tool hides/unpins it), so refresh both.
window.launcher.onChange(async (list) => {
  tools = list;
  settings = await window.launcher.getSettings();
  render();
});
Promise.all([
  window.launcher.getSettings(),
  window.launcher.listTools(),
  window.launcher.appInfo(),
  window.launcher.updateStatus(),
]).then(([s, list, info, upd]) => {
  settings = s;
  updates = upd;
  renderUpdates();
  // Only the installed Windows app has an uninstaller; on macOS the app goes to the Trash
  const uninstall = menu.querySelector('[data-action="uninstall"]');
  if (info.platform !== "win32") {
    uninstall.remove();
    $("setStart").closest("label").style.display = "none";
  } else if (!info.packaged) uninstall.title = "Only available in the installed app";
  applyTheme(s.theme);
  tools = list;
  render();
});
