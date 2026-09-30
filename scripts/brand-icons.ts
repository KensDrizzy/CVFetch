// Regenerate the browser and home-screen icons from industry/brand/logo.svg.
// Run with Node 24 after npm ci: node scripts/brand-icons.ts
import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";

const dir = new URL("../industry/brand/", import.meta.url);
const svg = await readFile(new URL("logo.svg", dir));
for (const [name, size] of [["icon.png", 512], ["icon-192.png", 192], ["apple-icon.png", 180]] as const) {
  await sharp(svg).resize(size, size).png().toFile(new URL(name, dir).pathname);
}

// ICO directory with PNG entries, retaining detail at both tab and shortcut sizes.
const entries = await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await sharp(svg).resize(size, size).png().toBuffer() })));
const header = Buffer.alloc(6 + entries.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(entries.length, 4);
let offset = header.length;
entries.forEach(({ size, data }, i) => {
  const at = 6 + i * 16;
  header[at] = size;
  header[at + 1] = size;
  header.writeUInt16LE(1, at + 4);
  header.writeUInt16LE(32, at + 6);
  header.writeUInt32LE(data.length, at + 8);
  header.writeUInt32LE(offset, at + 12);
  offset += data.length;
});
await writeFile(new URL("favicon.ico", dir), Buffer.concat([header, ...entries.map(({ data }) => data)]));
