// 生成 PWA 图标（无第三方依赖）：深色底 + 一颗显示「对子」的骰子。
// 用法：npm run icons

import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

function png(size, draw) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = draw(x / size, y / size);
      const i = y * (size * 4 + 1) + 1 + x * 4;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const BG = [20, 22, 31, 255];
const DIE = [232, 230, 223, 255];
const PIP = [176, 58, 58, 255];
const ACCENT = [224, 166, 74, 255];

// 两颗骰子（「双子」），左边白、右边金，各显示 4 点
function draw(u, v) {
  const inRound = (x0, y0, x1, y1, r) => {
    if (u < x0 || u > x1 || v < y0 || v > y1) return false;
    const cx = Math.min(Math.max(u, x0 + r), x1 - r);
    const cy = Math.min(Math.max(v, y0 + r), y1 - r);
    return (u - cx) ** 2 + (v - cy) ** 2 <= r * r;
  };
  const pip = (x0, y0, s) =>
    [
      [0.28, 0.28],
      [0.72, 0.28],
      [0.28, 0.72],
      [0.72, 0.72],
    ].some(([px, py]) => (u - (x0 + px * s)) ** 2 + (v - (y0 + py * s)) ** 2 <= (s * 0.1) ** 2);
  const dice = [
    { x: 0.14, y: 0.3, s: 0.38, color: DIE },
    { x: 0.48, y: 0.3, s: 0.38, color: ACCENT },
  ];
  for (const d of dice.reverse()) {
    if (inRound(d.x, d.y, d.x + d.s, d.y + d.s, d.s * 0.18)) return pip(d.x, d.y, d.s) ? PIP : d.color;
  }
  return BG;
}

mkdirSync('public/icons', { recursive: true });
for (const [name, size] of [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
]) {
  writeFileSync(`public/icons/${name}`, png(size, draw));
  console.log(`public/icons/${name}`);
}
