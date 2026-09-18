import { deflateSync } from "node:zlib";
import { writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const BG = [0xf6, 0xf7, 0xf9];
const INK = [0x1c, 0x1f, 0x23];
const WHITE = [0xff, 0xff, 0xff];
const BRANDS = [[0xee, 0x78, 0x00], [0x00, 0xa9, 0x4f], [0x00, 0x68, 0xb7]];

/** 글자를 그릴 수 없으니(글꼴이 없다) 「1+1」을 네모로 직접 그린다 */
function canvas(width, height, bg) {
  const rgb = Buffer.alloc(width * height * 3);
  const put = (x, y, c) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const at = (y * width + x) * 3;
    rgb[at] = c[0]; rgb[at + 1] = c[1]; rgb[at + 2] = c[2];
  };
  const rect = (x, y, w, h, c) => {
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) put(Math.round(x + dx), Math.round(y + dy), c);
  };
  const disc = (cx, cy, r, c) => {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy <= r * r) put(Math.round(cx + dx), Math.round(cy + dy), c);
    }
  };
  rect(0, 0, width, height, bg);
  return { width, height, rgb, rect, disc };
}

const one = (g, x, y, h, c) => {
  const t = Math.max(2, h * 0.16);
  g.rect(x + h * 0.3, y, t, h - h * 0.14, c);
  g.rect(x + h * 0.06, y + h * 0.86, h * 0.58, h * 0.14, c);
  for (let i = 0; i < h * 0.22; i++) g.rect(x + h * 0.3 - i * 0.8, y + i, t * 0.8, 1.2, c);
};

const plus = (g, x, y, h, c) => {
  const t = Math.max(2, h * 0.16);
  g.rect(x, y + h * 0.5 - t / 2, h, t, c);
  g.rect(x + h * 0.5 - t / 2, y, t, h, c);
};

/** 「1+1」 한 덩이를 가운데 놓는다 */
function mark(g, height, c) {
  const h = height;
  const gap = h * 0.16;
  const w = h * 0.64 + gap + h * 0.6 + gap + h * 0.64;
  let x = (g.width - w) / 2;
  const y = (g.height - h) / 2;
  one(g, x, y, h, c);
  x += h * 0.64 + gap;
  plus(g, x, y + h * 0.2, h * 0.6, c);
  x += h * 0.6 + gap;
  one(g, x, y, h, c);
  return { y, h };
}

export function ogCanvas() {
  const g = canvas(1200, 630, BG);
  const { y, h } = mark(g, 260, INK);
  BRANDS.forEach((c, i) => g.disc(g.width / 2 + (i - 1) * 90, y + h + 90, 28, c));
  return g;
}

export function iconCanvas(size) {
  const g = canvas(size, size, INK);
  mark(g, size * 0.44, WHITE);
  return g;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 0);
  return Buffer.concat([head, data, crc]);
};

/** 그림 한 장 만드느라 꾸러미를 들이지 않는다 — PNG 는 zlib 만으로 쓸 수 있다 */
export function pngBuffer({ width, height, rgb }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8bit RGB
  const rows = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) {
    rows[y * (width * 3 + 1)] = 0;
    rgb.copy(rows, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(rows, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function main() {
  const files = [
    ["og.png", ogCanvas()],
    ["icon-192.png", iconCanvas(192)],
    ["icon-512.png", iconCanvas(512)],
  ];
  for (const [name, g] of files) {
    const body = pngBuffer(g);
    await writeFile(join(ROOT, "public", name), body);
    console.log(`public/${name} — ${g.width}×${g.height} ${(body.length / 1024).toFixed(1)}KB`);
  }
}

if (process.argv[1] && process.argv[1].endsWith("ogimage.mjs")) await main();
