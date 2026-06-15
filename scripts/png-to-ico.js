#!/usr/bin/env node
// 把一张 PNG 包装成多尺寸 .ico（PNG-embedded entries，Windows Vista+ 支持）
// 用法：node scripts/png-to-ico.js <src.png> <out.ico> [sizes=16,24,32,48,64,128,256]
//
// 简化策略：仅嵌入一张 256x256 的 PNG（Windows 任务栏 / 资源管理器都会自动缩放）。
// 如需多尺寸可在 sizes 里列出，但需要外部图像库做 resize；这里只做单尺寸版本，足够大多数场景。

const fs = require("fs");
const path = require("path");

const [, , srcArg, outArg] = process.argv;
if (!srcArg || !outArg) {
  console.error("Usage: node scripts/png-to-ico.js <src.png> <out.ico>");
  process.exit(1);
}

const src = path.resolve(srcArg);
const out = path.resolve(outArg);
const png = fs.readFileSync(src);

if (png.slice(0, 8).toString("hex") !== "89504e470d0a1a0a") {
  console.error("Source is not a PNG file:", src);
  process.exit(1);
}

const ihdr = png.indexOf(Buffer.from("IHDR"));
if (ihdr < 0) {
  console.error("Invalid PNG: no IHDR chunk");
  process.exit(1);
}
const width = png.readUInt32BE(ihdr + 4);
const height = png.readUInt32BE(ihdr + 8);
console.log(`PNG: ${width} x ${height}, ${png.length} bytes`);

const numImages = 1;
const headerSize = 6;
const entrySize = 16;
const dataOffset = headerSize + entrySize * numImages;

const buf = Buffer.alloc(dataOffset + png.length);
buf.writeUInt16LE(0, 0);
buf.writeUInt16LE(1, 2);
buf.writeUInt16LE(numImages, 4);

const entry = headerSize;
buf.writeUInt8(width >= 256 ? 0 : width, entry + 0);
buf.writeUInt8(height >= 256 ? 0 : height, entry + 1);
buf.writeUInt8(0, entry + 2);
buf.writeUInt8(0, entry + 3);
buf.writeUInt16LE(1, entry + 4);
buf.writeUInt16LE(32, entry + 6);
buf.writeUInt32LE(png.length, entry + 8);
buf.writeUInt32LE(dataOffset, entry + 12);

png.copy(buf, dataOffset);

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, buf);
console.log(`Wrote ICO: ${out} (${buf.length} bytes)`);
