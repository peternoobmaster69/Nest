import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const source = await readFile(path.join(root, "public", "icon.svg"));
const outputDir = path.join(root, "public", "icons");
await mkdir(outputDir, { recursive: true });

async function render(name, size) {
  await sharp(source)
    .resize(size, size)
    .png({ compressionLevel: 9, palette: true })
    .toFile(path.join(outputDir, name));
}

async function renderMaskable(name, size) {
  const foregroundSize = Math.round(size * 0.8);
  const foreground = await sharp(source)
    .resize(foregroundSize, foregroundSize)
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: "#1C2B1C",
    },
  })
    .composite([{ input: foreground, gravity: "centre" }])
    .png({ compressionLevel: 9, palette: true })
    .toFile(path.join(outputDir, name));
}

await Promise.all([
  render("icon-192.png", 192),
  render("icon-512.png", 512),
  render("apple-touch-icon.png", 180),
  renderMaskable("icon-maskable-192.png", 192),
  renderMaskable("icon-maskable-512.png", 512),
]);

console.log("Generated install icons in public/icons");
