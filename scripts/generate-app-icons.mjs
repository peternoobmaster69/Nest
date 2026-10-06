import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const markSource = await readFile(path.join(root, "public", "icon.svg"));

// Keep in sync with APP_ICON_VARIANTS in lib/app-icons.ts. The first entry is the
// default and renders to the original top-level paths.
const VARIANTS = [
  { id: "classic", tile: ["#25674A", "#143A2C"] },
  { id: "cream", tile: ["#FBF8F2", "#EDE6D8"] },
  { id: "midnight", tile: ["#2B2F3A", "#111318"], glow: "#34D399" },
  { id: "sunrise", tile: ["#FFB98A", "#E46F4C"] },
];

const markInner = markSource.toString().replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");

// One scalable tile: gradient background (optionally a soft glow) with the mascot on top.
// `radius` rounds the tile; `scale` is the mark's share of the tile.
function tileSvg(variant, { radius = 15, scale = 0.94, prefix = "t" } = {}) {
  const [top, bottom] = variant.tile;
  const size = 64 * scale;
  const offset = (64 - size) / 2;
  const inner = markInner.replaceAll("nest-", `${prefix}-nest-`);
  const glow = variant.glow
    ? `<radialGradient id="${prefix}-glow" cx="32" cy="38" r="28" gradientUnits="userSpaceOnUse">` +
      `<stop offset="0" stop-color="${variant.glow}" stop-opacity="0.45"/><stop offset="1" stop-color="${variant.glow}" stop-opacity="0"/></radialGradient>`
    : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Nest">` +
    `<defs><linearGradient id="${prefix}-tile" x1="0" y1="0" x2="0" y2="64" gradientUnits="userSpaceOnUse">` +
    `<stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>${glow}</defs>` +
    `<rect width="64" height="64" rx="${radius}" fill="url(#${prefix}-tile)"/>` +
    (variant.glow ? `<rect width="64" height="64" rx="${radius}" fill="url(#${prefix}-glow)"/>` : "") +
    `<svg x="${offset}" y="${offset + 1}" width="${size}" height="${size}" viewBox="0 0 64 64" fill="none">${inner}</svg>` +
    `</svg>\n`
  );
}

async function png(svg, size, file) {
  await sharp(Buffer.from(svg), { density: 72 * Math.ceil(size / 64) * 2 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(file);
}

// An .ico holding 16/32/48px PNGs, for browsers that request /favicon.ico.
async function writeIco(svg, file) {
  const sizes = [16, 32, 48];
  const images = await Promise.all(sizes.map((size) =>
    sharp(Buffer.from(svg), { density: 600 }).resize(size, size).png().toBuffer()));
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, index) => {
    const entry = 6 + index * 16;
    header.writeUInt8(size, entry);
    header.writeUInt8(size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(images[index].length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += images[index].length;
  });
  await writeFile(file, Buffer.concat([header, ...images]));
}

async function renderVariant(variant, isDefault) {
  const dir = isDefault ? path.join(root, "public", "icons") : path.join(root, "public", "icons", variant.id);
  await mkdir(dir, { recursive: true });
  const rounded = (size) => tileSvg(variant, { radius: 14.5, scale: 0.74, prefix: `r${size}` });
  // Maskable and Apple icons stay square: the platform applies its own mask. The mark
  // stays inside the maskable safe zone (inner 80%).
  const square = tileSvg(variant, { radius: 0, scale: 0.74 });
  const maskable = tileSvg(variant, { radius: 0, scale: 0.62 });
  const favicon = tileSvg(variant);

  await Promise.all([
    png(rounded(192), 192, path.join(dir, "icon-192.png")),
    png(rounded(512), 512, path.join(dir, "icon-512.png")),
    png(square, 180, path.join(dir, "apple-touch-icon.png")),
    png(maskable, 192, path.join(dir, "icon-maskable-192.png")),
    png(maskable, 512, path.join(dir, "icon-maskable-512.png")),
    writeFile(isDefault ? path.join(root, "public", "favicon.svg") : path.join(dir, "favicon.svg"), favicon),
    isDefault ? writeIco(favicon, path.join(root, "public", "favicon.ico")) : Promise.resolve(),
  ]);
}

await Promise.all(VARIANTS.map((variant, index) => renderVariant(variant, index === 0)));
console.log(`Generated favicon and install icons for ${VARIANTS.length} variants in public/icons`);
