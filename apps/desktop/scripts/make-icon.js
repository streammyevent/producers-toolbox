// Draws the app icon (the launcher's brand mark: red rounded square, two white slanted bars)
// into build/icon.png (512px) and build/icon.ico (16-256px). No image libraries needed.
// Run: node apps/desktop/scripts/make-icon.js
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const RED = [215, 38, 61];
// Brand mark from renderer/index.html: viewBox 0 0 40 24, drawn at 20x14 inside a 32px square.
const BARS = [
  [
    [4, 22],
    [14, 2],
    [20, 2],
    [10, 22],
  ],
  [
    [16, 22],
    [26, 2],
    [32, 2],
    [22, 22],
  ],
];

function inside(poly, x, y) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function inRoundedSquare(x, y, size, r) {
  const cx = Math.min(Math.max(x, r), size - r);
  const cy = Math.min(Math.max(y, r), size - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

// RGBA pixels for one size, 4x4 supersampled.
function draw(size) {
  const s = size / 32; // the 32px launcher square
  const markScale = (20 * s) / 40; // svg drawn 20 units wide
  const ox = (size - 40 * markScale) / 2;
  const oy = (size - 24 * markScale) / 2;
  const bars = BARS.map((p) => p.map(([x, y]) => [ox + x * markScale, oy + y * markScale]));
  const px = Buffer.alloc(size * size * 4);
  const N = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bg = 0;
      let fg = 0;
      for (let sy = 0; sy < N; sy++) {
        for (let sx = 0; sx < N; sx++) {
          const fx = x + (sx + 0.5) / N;
          const fy = y + (sy + 0.5) / N;
          if (!inRoundedSquare(fx, fy, size, 8 * s)) continue;
          bg++;
          if (bars.some((b) => inside(b, fx, fy))) fg++;
        }
      }
      const a = bg / (N * N);
      const w = bg ? fg / bg : 0;
      const i = (y * size + x) * 4;
      px[i] = Math.round(RED[0] + (255 - RED[0]) * w);
      px[i + 1] = Math.round(RED[1] + (255 - RED[1]) * w);
      px[i + 2] = Math.round(RED[2] + (255 - RED[2]) * w);
      px[i + 3] = Math.round(a * 255);
    }
  }
  return px;
}

function png(size) {
  const px = draw(size);
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ICO with PNG-encoded images (supported since Windows Vista).
function ico(sizes) {
  const images = sizes.map(png);
  const head = Buffer.alloc(6 + 16 * sizes.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(sizes.length, 4);
  let offset = head.length;
  sizes.forEach((size, i) => {
    const e = 6 + i * 16;
    head[e] = size >= 256 ? 0 : size;
    head[e + 1] = size >= 256 ? 0 : size;
    head.writeUInt16LE(1, e + 4);
    head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(images[i].length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += images[i].length;
  });
  return Buffer.concat([head, ...images]);
}

const out = path.join(__dirname, "..", "build");
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "icon.png"), png(512));
fs.writeFileSync(path.join(out, "icon.ico"), ico([16, 24, 32, 48, 64, 128, 256]));
console.log("Wrote", path.join(out, "icon.png"), "and icon.ico");
