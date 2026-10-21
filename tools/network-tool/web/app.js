"use strict";
const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const RANK = { FAIL: 0, WARN: 1, PASS: 2, INFO: 3 };
const KIND = { unifi: 0, mikrotik: 1, equipment: 2 };
const AUTO_MS = 30_000;
const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
let timer,
  scanning = false,
  last = null,
  selected = null,
  selPort = null,
  editing = false;
// Standard colour per VLAN type, matched on the UniFi network name. Others get a spare colour by VID.
const VLAN_COLORS = [
  [/manag|default/i, "#9a98b0"],
  [/control|tech/i, "#3d7bff"],
  [/dante/i, "#ff4040"],
  [/green ?go/i, "#2ee05a"],
  [/ptz|video|cam/i, "#ffd400"],
  [/kvm/i, "#b45cff"],
  [/wi-?fi|guest/i, "#22d8d8"],
];
const SPARE = ["#ff7ab6", "#ff8c1a", "#a0e000", "#7fb2ff", "#d8a070"];

// Methods of the tool's api.js in the main process (apps/desktop/src/types/toolbox.d.ts).
const call = (method, ...args) => window.toolbox.call(method, ...args);

async function start() {
  const s = await call("status.get");
  const sel = $("#iface");
  sel.innerHTML = s.interfaces
    .map((i) => `<option value="${esc(i.name)}">${esc(i.name)} · ${esc(i.cidr)}</option>`)
    .join("");
  sel.value = s.defaultIface ?? "";
  sel.hidden = s.interfaces.length < 2;
  if (!s.hasLogins) return showSetup();
  scan();
}

// The network lead gives crew the crew code file (creds.enc) and the crew code. The logins then stay on this
// computer, encrypted by the system.
function showSetup() {
  $("#main").innerHTML = `
    <div class="unlock px">
      <h2>SET UP THIS COMPUTER</h2>
      <p>Choose the crew code file from the network lead and type the crew code. The tool keeps the switch and UniFi logins on this computer, encrypted.</p>
      <form id="f"><input id="file" type="file" aria-label="Crew code file"><input id="code" type="password" autocomplete="off" aria-label="Crew code" placeholder="CODE"><button>Import</button></form>
      <div class="err" id="err" role="alert"></div>
    </div>`;
  $("#f").onsubmit = async (e) => {
    e.preventDefault();
    try {
      const file = $("#file").files[0];
      if (!file) throw new Error("Choose the crew code file.");
      await call("creds.import", await file.text(), $("#code").value);
      scan();
    } catch (err) {
      $("#err").textContent = err.message.toUpperCase();
      $("#code").select();
    }
  };
}

function showMessage(level, title, text) {
  $("#main").innerHTML =
    `<div class="banner px ${level}"><div><div class="t">${esc(title)}</div><small>${esc(text)}</small></div></div>`;
}

async function scan() {
  if (scanning) return;
  scanning = true;
  clearTimeout(timer);
  $("#rescan").hidden = false;
  $("#rescan").disabled = true;
  $("#rescan").textContent = "Scanning";
  if (!last)
    $("#main").innerHTML =
      `<div class="banner px busy"><div><div class="t blink">SCANNING...</div><small>Reading UniFi and the switches. This takes about 10 seconds.</small><div class="load"></div></div></div>`;
  try {
    last = await call("audit.run", $("#iface").value);
    if (!editing) render(last);
  } catch (err) {
    if (!(await call("status.get").catch(() => ({ hasLogins: true }))).hasLogins) return showSetup();
    showMessage("FAIL", "SCAN FAILED", err.message);
  } finally {
    scanning = false;
    $("#rescan").disabled = false;
    $("#rescan").textContent = "Scan again";
    timer = setTimeout(auto, AUTO_MS);
  }
}

// An open port change holds the auto-scan, so the panel does not redraw under the user.
function auto() {
  if (editing) timer = setTimeout(auto, AUTO_MS);
  else scan();
}

function worst(rows) {
  return rows.reduce((w, r) => (RANK[r.level] < RANK[w] ? r.level : w), "INFO");
}

function row(r, dev) {
  const where =
    r.where && r.where !== dev.id && r.where !== dev.title && !r.where.startsWith(dev.id + " (")
      ? `<div class="where">${esc(r.where)}</div>`
      : "";
  const fix = r.fix ? `<details class="fix"><summary>How to fix</summary><p>${esc(r.fix)}</p></details>` : "";
  return `<div class="row ${r.level}"><span class="dot ${r.level}"></span><div class="body">${where}<div class="msg">${esc(r.msg)}</div>${fix}</div></div>`;
}

function render(d) {
  const n = d.network;
  $("#net").textContent = `${n.name} · ${n.address} · gateway ${n.gateway}`;
  $("#when").textContent = `Last scan ${new Date(d.scannedAt).toLocaleTimeString()}`;

  const fails = d.results.filter((r) => r.level === "FAIL").length;
  const warns = d.results.filter((r) => r.level === "WARN").length;
  const overall = fails ? "FAIL" : warns ? "WARN" : "PASS";
  const headline = fails
    ? `${fails} PROBLEM${fails > 1 ? "S" : ""} FOUND`
    : warns
      ? `${warns} WARNING${warns > 1 ? "S" : ""}`
      : "ALL CHECKS PASSED";
  const sub = fails
    ? "Select a red device and follow “How to fix”."
    : warns
      ? "The network works. Check the orange devices when you have time."
      : "The network is ready for Dante.";

  const items = d.devices
    .map((dev) => {
      const rows = d.results.filter((r) => r.device === dev.id).sort((a, b) => RANK[a.level] - RANK[b.level]);
      return { dev, rows, level: worst(rows) };
    })
    .sort(
      (a, b) =>
        RANK[a.level] - RANK[b.level] || KIND[a.dev.kind] - KIND[b.dev.kind] || a.dev.title.localeCompare(b.dev.title),
    );
  if (!items.some((i) => i.dev.id === selected)) selected = items[0]?.dev.id;

  const missing = d.results.some((r) => r.msg.startsWith("missing since"));
  const unknown = d.seen.some((s) => !s.equipment && s.name !== "this computer");
  const tools = [
    missing && `<button class="ghost" id="forget">Forget missing</button>`,
    unknown && `<button class="ghost" id="learn">Add unknown devices</button>`,
  ].filter(Boolean);
  const group = (title, list) =>
    list.length ? `<div class="group">${title} (${list.length})</div>${list.map(item).join("")}` : "";

  $("#main").innerHTML = `
    <div class="banner px ${overall}"><span class="dot ${overall}"></span><div><div class="t">${headline}</div><small>${sub} Scan took ${(d.ms / 1000).toFixed(1)} s. The page scans again every ${AUTO_MS / 1000} s.</small></div></div>
    <div class="split">
      <section class="list px" aria-label="Devices">
        ${tools.length ? `<div class="tools">${tools.join("")}<span id="learned"></span></div>` : ""}
        ${group(
          "Network",
          items.filter((i) => i.dev.kind !== "equipment"),
        )}
        ${group(
          "Equipment",
          items.filter((i) => i.dev.kind === "equipment"),
        )}
      </section>
      <section class="panel card px" id="panel" aria-live="polite"></section>
    </div>`;
  showPanel(items);
  $("#main")
    .querySelectorAll("button.item")
    .forEach(
      (b) =>
        (b.onclick = () => {
          selected = b.dataset.id;
          editing = false;
          showPanel(items);
          if (matchMedia("(max-width: 900px)").matches)
            $("#panel").scrollIntoView({ behavior: calm ? "auto" : "smooth" });
        }),
    );
  const forget = $("#forget");
  if (forget)
    forget.onclick = async () => {
      forget.disabled = true;
      await call("known.forget");
      scan();
    };
  const learn = $("#learn");
  if (learn)
    learn.onclick = async () => {
      learn.disabled = true;
      const r = await call("equipment.learn");
      $("#learned").textContent = r.added
        ? `Added ${r.added} to the equipment list on this computer`
        : "No unknown devices to add";
      learn.disabled = false;
    };
}

const offline = (rows) => rows.some((r) => r.level === "INFO" && r.msg.startsWith("offline"));

function item({ dev, rows, level }) {
  const issues = rows.filter((r) => r.level === "FAIL" || r.level === "WARN");
  const status = issues.length
    ? `${issues[0].msg}${issues.length > 1 ? ` · +${issues.length - 1} more` : ""}`
    : offline(rows)
      ? "Offline"
      : "OK";
  const tone = issues.length ? level : offline(rows) ? "INFO" : "PASS";
  return `<button class="item" data-id="${esc(dev.id)}" aria-pressed="${dev.id === selected}"><span class="dot ${tone}"></span>
    <span class="body"><span class="title">${esc(dev.title)}</span><span class="sub">${esc(dev.subtitle)}</span><span class="status ${tone}">${esc(status)}</span></span></button>`;
}

function showPanel(items) {
  $("#main")
    .querySelectorAll("button.item")
    .forEach((b) => b.setAttribute("aria-pressed", b.dataset.id === selected));
  const it = items.find((i) => i.dev.id === selected);
  const el = $("#panel");
  if (!it) return (el.hidden = true);
  const { dev, rows, level } = it;
  const issues = rows.filter((r) => r.level !== "INFO");
  const info = rows.filter((r) => r.level === "INFO");
  const ok = issues.some((r) => r.level !== "PASS")
    ? ""
    : offline(rows)
      ? `<div class="ok off">Offline · not checked</div>`
      : `<div class="ok">No problems found.</div>`;
  el.className = `panel card px ${level}`;
  el.innerHTML = `<div class="head"><span class="dot ${level}"></span><div><h2>${esc(dev.title)}</h2><div class="sub">${esc(dev.subtitle)}</div></div></div>
    ${dev.ports ? front(dev) : ""}
    ${ok}${issues.map((r) => row(r, dev)).join("")}
    ${info.length ? `<h3>Details</h3>${info.map((r) => row(r, dev)).join("")}` : ""}`;
  if (dev.ports) wirePorts(dev, items);
}

// --- Switch front panel -----------------------------------------------------

const net = (vid) => last.networks.find((n) => n.vid === vid);
const vname = (v) => (v === "trunk" ? "Trunk" : `${net(v)?.name ?? "Not in UniFi"} (${v})`);
function vcolor(v) {
  const name = net(v)?.name ?? "";
  return VLAN_COLORS.find(([re]) => re.test(name))?.[1] ?? SPARE[v % SPARE.length];
}
const speed = (p) => (p.up ? (p.rate?.replace("bps", "") ?? "link") : "no link");
const slow = (p) => p.up && /^(10|100)M/.test(p.rate ?? "");

function front(dev) {
  const ports = new Map(dev.ports.map((p) => [p.name, p]));
  const btn = (name, label) => {
    const p = ports.get(name);
    if (!p) return `<span></span>`;
    const trunk = p.vlan === "trunk";
    return `<button class="port${trunk ? " trunk" : ""}${p.locked ? " locked" : ""}" data-port="${esc(name)}" style="--v:${trunk ? "none" : vcolor(p.vlan)}"
      aria-pressed="${selPort === `${dev.id}/${name}`}" aria-label="${esc(`${name}, ${vname(p.vlan)}, ${speed(p)}`)}" title="${esc(`${name} · ${vname(p.vlan)} · ${speed(p)}`)}">
      <span class="led${p.up ? (slow(p) ? " slow" : " up") : ""}"></span>${label}</button>`;
  };
  // CRS328 front: three blocks of 4×2 RJ45 with the even ports on top (port 1 is bottom left), then the SFP+ cages.
  const row = (first) => [0, 1, 2, 3].map((i) => btn(`ether${first + i * 2}`, first + i * 2)).join("");
  const block = (from) => `<div class="blk">${row(from + 1)}${row(from)}</div>`;
  const sfp = `<div class="blk sfp">${[2, 4, 1, 3].map((i) => btn(`sfp-sfpplus${i}`, `S${i}`)).join("")}</div>`;
  const used = [...new Set(dev.ports.map((p) => p.vlan))].sort((a, b) =>
    a === "trunk" ? -1 : b === "trunk" ? 1 : a - b,
  );
  const legend =
    used
      .map(
        (v) =>
          `<span><span class="sw${v === "trunk" ? " trunk" : ""}" style="--v:${v === "trunk" ? "none" : vcolor(v)}"></span>${esc(vname(v))}</span>`,
      )
      .join("") + `<span><span class="sw locked"></span>Locked</span>`;
  const sel = selPort?.startsWith(dev.id + "/") ? ports.get(selPort.slice(dev.id.length + 1)) : null;
  return `<div class="front" role="group" aria-label="Ports of ${esc(dev.title)}">${block(1)}${block(9)}${block(17)}${sfp}</div>
    <div class="legend">${legend}</div>${sel ? portBox(sel) : ""}`;
}

function portBox(p) {
  const opts = last.networks.map(
    (n) =>
      `<option value="${n.vid}" style="color:${vcolor(n.vid)}"${n.vid === p.vlan ? " selected" : ""}>■ ${esc(n.name)} (${n.vid})${n.critical ? " · critical" : ""}</option>`,
  );
  if (p.sfp) opts.unshift(`<option value="trunk"${p.vlan === "trunk" ? " selected" : ""}>Trunk (all VLANs)</option>`);
  return `<div class="portbox">
    <div class="pt">${esc(p.name)} · ${esc(speed(p))} · <span class="sw${p.vlan === "trunk" ? " trunk" : ""}" style="--v:${p.vlan === "trunk" ? "none" : vcolor(p.vlan)}"></span>${esc(vname(p.vlan))}</div>
    <div class="hosts">${p.hosts.length ? `Connected: ${esc(p.hosts.join(" · "))}` : "Nothing connected."}</div>
    ${p.locked ? `<div class="lock">Locked: ${esc(p.locked)}</div>` : `<div class="edit"><label for="pv">Untagged VLAN</label><select id="pv">${opts.join("")}</select><button id="papply" hidden></button></div>`}
    <div class="pmsg" id="pmsg" role="status"></div></div>`;
}

function wirePorts(dev, items) {
  const el = $("#panel");
  el.querySelectorAll("button.port").forEach(
    (b) =>
      (b.onclick = () => {
        const key = `${dev.id}/${b.dataset.port}`;
        selPort = selPort === key ? null : key;
        editing = false;
        showPanel(items);
        el.querySelector(`button.port[data-port="${b.dataset.port}"]`)?.focus();
      }),
  );
  const pv = $("#pv"),
    apply = $("#papply"),
    msg = $("#pmsg");
  if (!pv) return;
  const port = dev.ports.find((p) => `${dev.id}/${p.name}` === selPort);
  pv.onchange = () => {
    const v = pv.value === "trunk" ? "trunk" : Number(pv.value);
    editing = v !== port.vlan;
    apply.hidden = !editing;
    apply.textContent = `Set ${port.name} to ${vname(v)}`;
    msg.textContent = "";
  };
  apply.onclick = async () => {
    apply.disabled = pv.disabled = true;
    msg.className = "pmsg";
    msg.textContent = "Changing the port...";
    try {
      const r = await call("port.change", dev.id, port.name, pv.value);
      editing = false;
      while (scanning) await new Promise((r) => setTimeout(r, 200));
      await scan();
      const m = $("#pmsg");
      if (m) Object.assign(m, { className: "pmsg ok", textContent: r.msg });
    } catch (err) {
      Object.assign(msg, { className: "pmsg bad", textContent: err.message });
      apply.disabled = pv.disabled = false;
    }
  };
}

// --- Starfield --------------------------------------------------------------

function starfield() {
  const c = $("#stars"),
    g = c.getContext("2d");
  const LAYERS = [
    { n: 90, v: 0.18, s: 1, a: 0.27 },
    { n: 50, v: 0.5, s: 2, a: 0.42 },
    { n: 22, v: 1.1, s: 2, a: 0.6 },
  ];
  let stars = [];
  const resize = () => {
    c.width = innerWidth >> 1; // half resolution, scaled up pixelated
    c.height = innerHeight >> 1;
    stars = LAYERS.flatMap((l) =>
      Array.from({ length: l.n }, () => ({ ...l, x: Math.random() * c.width, y: Math.random() * c.height })),
    );
  };
  const draw = () => {
    g.fillStyle = "#05010f";
    g.fillRect(0, 0, c.width, c.height);
    for (const st of stars) {
      if (!calm) st.x = (st.x - st.v + c.width) % c.width;
      g.fillStyle = `rgba(200, 220, 255, ${st.a})`;
      g.fillRect(st.x | 0, st.y | 0, st.s, st.s);
    }
    if (!calm) requestAnimationFrame(draw);
  };
  addEventListener("resize", () => {
    resize();
    if (calm) draw();
  });
  resize();
  draw();
}

// --- Logo and globe ---------------------------------------------------------

const LOGO = [
  "███████╗███╗   ███╗███████╗",
  "██╔════╝████╗ ████║██╔════╝",
  "███████╗██╔████╔██║█████╗  ",
  "╚════██║██║╚██╔╝██║██╔══╝  ",
  "███████║██║ ╚═╝ ██║███████╗",
  "╚══════╝╚═╝     ╚═╝╚══════╝",
].join("\n");
$("#logo").innerHTML = LOGO.replace(/[╗╔═║╚╝]+/g, (m) => `<span class="sh">${m}</span>`);

// Wireframe globe: parallels and meridians every 30°, back lines fade with depth.
function globe() {
  const c = $("#globe"),
    g = c.getContext("2d");
  const D = Math.PI / 180,
    TILT = 20 * D,
    SPEED = 20 * D; // radians per second
  const NODES = [
    [52, 5],
    [40, -74],
    [35, 139],
    [-34, 151],
  ]; // Amsterdam, New York, Tokyo, Sydney
  const lines = [];
  for (let lat = -60; lat <= 60; lat += 30) lines.push(Array.from({ length: 61 }, (_, i) => [lat, i * 6]));
  for (let lon = 0; lon < 360; lon += 30) lines.push(Array.from({ length: 31 }, (_, i) => [-90 + i * 6, lon]));
  let size = 0,
    r = 0;
  const fit = () => {
    const css = c.clientWidth,
      dpr = devicePixelRatio || 1;
    c.width = c.height = Math.round(css * dpr);
    size = c.width;
    r = size / 2 - 2 * dpr;
    g.lineWidth = Math.max(1, dpr * 0.9);
  };
  const project = ([lat, lon], spin) => {
    const la = lat * D,
      lo = lon * D + spin;
    const x = Math.cos(la) * Math.sin(lo),
      y = Math.sin(la),
      z = Math.cos(la) * Math.cos(lo);
    const yt = y * Math.cos(TILT) - z * Math.sin(TILT),
      zt = y * Math.sin(TILT) + z * Math.cos(TILT);
    return [size / 2 + x * r, size / 2 - yt * r, zt];
  };
  const frame = (t) => {
    const spin = calm ? 0 : (t / 1000) * SPEED;
    g.clearRect(0, 0, size, size);
    g.strokeStyle = "rgb(0, 229, 255)";
    g.globalAlpha = 0.35;
    g.beginPath();
    g.arc(size / 2, size / 2, r, 0, 2 * Math.PI);
    g.stroke();
    for (const line of lines) {
      let prev = project(line[0], spin);
      for (let i = 1; i < line.length; i++) {
        const p = project(line[i], spin);
        g.globalAlpha = 0.12 + 0.88 * ((prev[2] + p[2] + 2) / 4) ** 1.5;
        g.beginPath();
        g.moveTo(prev[0], prev[1]);
        g.lineTo(p[0], p[1]);
        g.stroke();
        prev = p;
      }
    }
    g.globalAlpha = 1;
    g.fillStyle = "#e8ffff";
    for (const n of NODES) {
      const [x, y, z] = project(n, spin);
      if (z > 0.1) g.fillRect(x - r / 22, y - r / 22, r / 11, r / 11);
    }
    if (!calm) requestAnimationFrame(frame);
  };
  addEventListener("resize", () => {
    fit();
    if (calm) frame(0);
  });
  fit();
  requestAnimationFrame(frame);
}

// --- Music ------------------------------------------------------------------
// Public-domain keygen modules (see Credits), played by libopenmpt via chiptune3.

const music = (() => {
  const VOLUME = 0.35,
    FADE = 0.3;
  let player,
    tracks,
    idx,
    ready,
    on = false;

  async function init() {
    const [{ ChiptuneJsPlayer }, list] = await Promise.all([
      import("./vendor/chiptune3/chiptune3.js"),
      fetch("music/tracks.json").then((r) => r.json()),
    ]);
    tracks = list;
    idx = Math.floor(Math.random() * tracks.length);
    player = new ChiptuneJsPlayer({ repeatCount: 0 });
    player.gain.gain.value = 0;
    // chiptune3 only logs worklet failures, so time out instead of waiting forever.
    await new Promise((res, rej) => {
      player.onInitialized(res);
      setTimeout(() => rej(new Error("player did not start")), 8000);
    });
    player.onEnded(() => on && api.next());
  }

  function fade(to) {
    const g = player.gain.gain,
      now = player.context.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(to, now + FADE);
  }

  function load() {
    const t = tracks[idx];
    player.load(`music/${encodeURIComponent(t.file)}`);
    api.onTrack?.(t);
  }

  const api = {
    onTrack: null,
    get on() {
      return on;
    },
    async start() {
      on = true;
      ready ??= init();
      await ready;
      if (!on) return;
      await player.context.resume();
      if (player.meta) player.unpause();
      else load();
      fade(VOLUME);
    },
    stop() {
      on = false;
      if (!player) return;
      fade(0);
      setTimeout(
        () => {
          if (on) return;
          player.pause();
          player.context.suspend();
        },
        FADE * 1000 + 50,
      );
    },
    next() {
      if (!player) return;
      idx = (idx + 1) % tracks.length;
      load();
    },
  };
  return api;
})();

const pref = {
  get: () => {
    try {
      return localStorage.getItem("music") === "on";
    } catch {
      return false;
    }
  },
  set: (v) => {
    try {
      localStorage.setItem("music", v ? "on" : "off");
    } catch {}
  },
};

function setMusicButton(on) {
  $("#music").setAttribute("aria-pressed", on);
  $("#music").textContent = on ? "Music: on" : "Music: off";
  $("#next").hidden = !on;
  $("#np").hidden = !on;
}

function startMusic() {
  music.start().catch(() => {
    $("#music").textContent = "Music: n/a";
    $("#music").disabled = true;
    $("#next").hidden = true;
  });
}
music.onTrack = (t) => ($("#np").textContent = `♫ ${t.title} · ${t.artist}`.toUpperCase());

$("#music").onclick = () => {
  const on = !music.on;
  on ? startMusic() : music.stop();
  pref.set(on);
  setMusicButton(on);
};
$("#next").onclick = () => music.next();
if (pref.get()) {
  // Browsers only allow audio after a user gesture.
  setMusicButton(true);
  const resume = (e) => {
    if (e.target.closest?.("#music")) return;
    if (pref.get()) startMusic();
    removeEventListener("pointerdown", resume);
    removeEventListener("keydown", resume);
  };
  addEventListener("pointerdown", resume);
  addEventListener("keydown", resume);
}

$("#rescan").onclick = () => {
  editing = false;
  scan();
};
$("#iface").onchange = () => {
  last = null;
  scan();
};
$("#credits").onclick = async () => {
  if (!$("#creditsText").textContent)
    $("#creditsText").textContent = await (await fetch("THIRD_PARTY_NOTICES.txt")).text();
  $("#creditsDlg").showModal();
};
$("#creditsClose").onclick = () => $("#creditsDlg").close();
starfield();
globe();
start().catch((e) => showMessage("FAIL", "CAN'T START", e.message));
