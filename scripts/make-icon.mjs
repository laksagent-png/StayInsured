// Generates the source app icon and the monochrome tray icon as PNGs.
// Run with: node scripts/make-icon.mjs
// Then run: npx tauri icon scripts/app-icon.png   (produces every platform size)
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour with alpha
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0; // no filter
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;

/** Signed coverage helpers: each returns true when the sample is inside the shape. */
function insideRoundedRect(x, y, left, top, right, bottom, r) {
  if (x < left || x > right || y < top || y > bottom) return false;
  const cx = Math.min(Math.max(x, left + r), right - r);
  const cy = Math.min(Math.max(y, top + r), bottom - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

/** A shield: near-vertical sides with rounded shoulders, tapering to a rounded point. */
function insideShield(x, y, cx, top, bottom, halfW) {
  if (y < top || y > bottom) return false;
  const t = (y - top) / (bottom - top);
  let hw;
  const shoulder = 0.52;
  if (t < shoulder) {
    hw = halfW * (1 - 0.06 * (t / shoulder));
  } else {
    const u = (t - shoulder) / (1 - shoulder);
    hw = halfW * 0.94 * Math.sqrt(Math.max(0, 1 - u * u));
  }
  // Round the top shoulders.
  const r = halfW * 0.34;
  const dy = y - top;
  if (dy < r) {
    const inset = r - Math.sqrt(Math.max(0, r * r - (r - dy) ** 2));
    hw = Math.min(hw, halfW - inset);
  }
  return Math.abs(x - cx) <= hw;
}

function distToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const t = clamp01((wx * vx + wy * vy) / (vx * vx + vy * vy));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

function insideCheck(x, y, s) {
  const w = 44 * s;
  const a = distToSegment(x, y, 430 * s, 528 * s, 484 * s, 588 * s);
  const b = distToSegment(x, y, 484 * s, 588 * s, 606 * s, 448 * s);
  return Math.min(a, b) <= w / 2;
}

/** Composite src over dst, both premultiplied-free 0-255 RGBA arrays of length 4. */
function over(dst, src) {
  const sa = src[3] / 255;
  const da = dst[3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa === 0) return [0, 0, 0, 0];
  const ch = (i) => (src[i] * sa + dst[i] * da * (1 - sa)) / oa;
  return [ch(0), ch(1), ch(2), oa * 255];
}

function renderAppIcon(size) {
  const s = size / 1024;
  const rgba = Buffer.alloc(size * size * 4);
  const SS = 3; // supersampling factor per axis
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let acc = [0, 0, 0, 0];
      let n = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = px + (sx + 0.5) / SS;
          const y = py + (sy + 0.5) / SS;
          let sample = [0, 0, 0, 0];
          if (insideRoundedRect(x, y, 40 * s, 40 * s, 984 * s, 984 * s, 208 * s)) {
            // Teal gradient background, lighter at the top.
            const g = clamp01((y / size) * 1.05);
            sample = [lerp(45, 13, g), lerp(212, 118, g), lerp(191, 110, g), 255];
          }
          if (insideShield(x, y, 512 * s, 250 * s, 792 * s, 196 * s)) {
            sample = over(sample, [255, 255, 255, 250]);
          }
          if (insideCheck(x, y, s)) {
            sample = over(sample, [13, 108, 100, 255]);
          }
          acc = [acc[0] + sample[0], acc[1] + sample[1], acc[2] + sample[2], acc[3] + sample[3]];
          n++;
        }
      }
      const o = (py * size + px) * 4;
      rgba[o] = Math.round(acc[0] / n);
      rgba[o + 1] = Math.round(acc[1] / n);
      rgba[o + 2] = Math.round(acc[2] / n);
      rgba[o + 3] = Math.round(acc[3] / n);
    }
  }
  return encodePng(size, size, rgba);
}

/** Tray icons are template images on macOS: black shape plus alpha only. */
function renderTrayIcon(size) {
  const s = size / 1024;
  const rgba = Buffer.alloc(size * size * 4);
  const SS = 4;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let cov = 0;
      let n = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = px + (sx + 0.5) / SS;
          const y = py + (sy + 0.5) / SS;
          const inShield = insideShield(x, y, 512 * s, 140 * s, 900 * s, 300 * s);
          if (inShield && !insideCheckTray(x, y, s)) cov++;
          n++;
        }
      }
      const o = (py * size + px) * 4;
      rgba[o] = 0;
      rgba[o + 1] = 0;
      rgba[o + 2] = 0;
      rgba[o + 3] = Math.round((cov / n) * 255);
    }
  }
  return encodePng(size, size, rgba);
}

function insideCheckTray(x, y, s) {
  const w = 70 * s;
  const a = distToSegment(x, y, 400 * s, 505 * s, 476 * s, 590 * s);
  const b = distToSegment(x, y, 476 * s, 590 * s, 640 * s, 400 * s);
  return Math.min(a, b) <= w / 2;
}

mkdirSync(resolve(here, "../src-tauri/icons"), { recursive: true });
writeFileSync(resolve(here, "app-icon.png"), renderAppIcon(1024));
writeFileSync(resolve(here, "../src-tauri/icons/tray.png"), renderTrayIcon(32));
writeFileSync(resolve(here, "../src-tauri/icons/tray@2x.png"), renderTrayIcon(64));
console.log("wrote scripts/app-icon.png, src-tauri/icons/tray.png, src-tauri/icons/tray@2x.png");
