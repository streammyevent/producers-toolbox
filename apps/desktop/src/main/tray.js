const { Tray, Menu, nativeImage } = require("electron");

// Small red square with a white mark, drawn in code so no icon asset is needed.
function trayIcon() {
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const inner = x >= 4 && x <= 11 && y >= 4 && y <= 11;
      const [r, g, b] = inner ? [255, 255, 255] : [215, 38, 61]; // BGRA below
      buf[i] = b;
      buf[i + 1] = g;
      buf[i + 2] = r;
      buf[i + 3] = 255;
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

let tray = null;

function createTray({ onShow, onQuit }) {
  if (tray) return tray;
  tray = new Tray(trayIcon());
  tray.setToolTip("Producers Toolbox");
  tray.setContextMenu(
    Menu.buildFromTemplate([{ label: "Show", click: onShow }, { type: "separator" }, { label: "Quit", click: onQuit }]),
  );
  tray.on("click", onShow);
  return tray;
}

function destroyTray() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

module.exports = { createTray, destroyTray };
