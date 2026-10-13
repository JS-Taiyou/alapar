/**
 * Generates the raster icon set from the brand mark (a squircle in the
 * primary blue with a white equals sign — "a la par" = on equal footing),
 * matching public/logo.svg. Dependency-free: manual PNG encoding via
 * node:zlib and a PNG-in-ICO container (Vista+ format).
 *
 *   node scripts/gen-icons.mjs
 *
 * Emits into public/: favicon.ico (16/32/48), apple-touch-icon.png (180),
 * icon-192.png, icon-512.png.
 */
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const BRAND = [0x09, 0x3e, 0xaa]; // #093eaa
const WHITE = [0xff, 0xff, 0xff];

/** Rounded-rect coverage test for one sample point. */
function insideRoundedRect(px, py, x, y, w, h, r) {
  if (px < x || px >= x + w || py < y || py >= y + h) return false;
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= r * r;
}

/** Fill a rounded rect with 4x4 supersampled antialiasing. */
function fillRoundRect(buf, size, x, y, w, h, r, [cr, cg, cb]) {
  const S = 4;
  const x0 = Math.max(0, Math.floor(x));
  const x1 = Math.min(size - 1, Math.ceil(x + w));
  const y0 = Math.max(0, Math.floor(y));
  const y1 = Math.min(size - 1, Math.ceil(y + h));
  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      let hit = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          if (insideRoundedRect(px + (sx + 0.5) / S, py + (sy + 0.5) / S, x, y, w, h, r)) hit++;
        }
      }
      if (!hit) continue;
      const alpha = hit / (S * S);
      const i = (py * size + px) * 4;
      const prevA = buf[i + 3] / 255;
      const outA = alpha + prevA * (1 - alpha);
      if (outA <= 0) continue;
      buf[i] = Math.round((cr * alpha + buf[i] * prevA * (1 - alpha)) / outA);
      buf[i + 1] = Math.round((cg * alpha + buf[i + 1] * prevA * (1 - alpha)) / outA);
      buf[i + 2] = Math.round((cb * alpha + buf[i + 2] * prevA * (1 - alpha)) / outA);
      buf[i + 3] = Math.round(outA * 255);
    }
  }
}

/** The brand mark at any size, mirroring public/logo.svg. */
function render(size) {
  const buf = new Uint8Array(size * size * 4);
  // Squircle: full bleed, radius 22.5% (rx=9 of 40).
  fillRoundRect(buf, size, 0, 0, size, size, size * 0.225, BRAND);
  // Equals bars: x 25%..75%, height 10% each, capsule ends, y centers at
  // 40% and 60% (margins == gap == bar height at the 40px reference).
  const barW = size * 0.5;
  const barH = size * 0.1;
  fillRoundRect(buf, size, size * 0.25, size * 0.4 - barH / 2, barW, barH, barH / 2, WHITE);
  fillRoundRect(buf, size, size * 0.25, size * 0.6 - barH / 2, barW, barH, barH / 2, WHITE);
  return buf;
}

// ---- Minimal PNG encoder ----
const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}

function encodePNG(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---- ICO (PNG-embedded, Vista+ PNG-inside format) ----
function encodeICO(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(entries.length * 16);
  let offset = 6 + entries.length * 16;
  entries.forEach(({ size, png }, i) => {
    dir.writeUInt8(size >= 256 ? 0 : size, i * 16);
    dir.writeUInt8(size >= 256 ? 0 : size, i * 16 + 1);
    dir.writeUInt16LE(1, i * 16 + 4);
    dir.writeUInt16LE(32, i * 16 + 6);
    dir.writeUInt32LE(png.length, i * 16 + 8);
    dir.writeUInt32LE(offset, i * 16 + 12);
    offset += png.length;
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}

// ---- Emit ----
const faviconPngs = [16, 32, 48].map((s) => ({ size: s, png: encodePNG(s, render(s)) }));

writeFileSync("public/favicon.ico", encodeICO(faviconPngs));
writeFileSync("public/apple-touch-icon.png", encodePNG(180, render(180)));
writeFileSync("public/icon-192.png", encodePNG(192, render(192)));
writeFileSync("public/icon-512.png", encodePNG(512, render(512)));
console.log(
  "icons written: favicon.ico (16/32/48), apple-touch-icon.png (180), icon-192.png, icon-512.png",
);
