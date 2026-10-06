import { mkdir, readFile } from "node:fs/promises";
import sharp from "sharp";

const logo = await readFile(new URL("../app/icon.svg", import.meta.url), "utf8");
const placeLogo = (x, y, size) => logo.replace("<svg ", `<svg x="${x}" y="${y}" width="${size}" height="${size}" `);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="background" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f7f8f2"/>
      <stop offset="1" stop-color="#e5eee5"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#background)"/>
  <circle cx="1010" cy="245" r="270" fill="#d8e8d9"/>
  <circle cx="1010" cy="245" r="215" fill="#e8f1e7"/>
  ${placeLogo(66, 53, 75)}
  <g font-family="Arial, Helvetica, sans-serif" fill="#163d2e">
    <text x="154" y="109" font-size="42" font-weight="700">Nest</text>
    <text x="76" y="227" font-size="22" letter-spacing="2">PERSONAL FINANCE, MADE CLEAR</text>
    <text x="72" y="315" font-size="72" font-weight="700">Every dollar.</text>
    <text x="72" y="397" font-size="72" font-weight="700">Fully explained.</text>
    <text x="76" y="456" font-size="25" fill="#496454">Budgeting, expenses, savings</text>
    <text x="76" y="491" font-size="25" fill="#496454">and investments in one place.</text>
  </g>
  ${placeLogo(842, 158, 280)}
  <path d="M76 540H1124" stroke="#bccfbe"/>
  <text x="76" y="583" font-family="Arial, Helvetica, sans-serif" font-size="23" fill="#163d2e">save.htet.info</text>
  <text x="1124" y="583" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="21" fill="#496454">Plan. Track. Save.</text>
</svg>`;

const destination = new URL("../public/og/", import.meta.url);
await mkdir(destination, { recursive: true });
await sharp(Buffer.from(svg)).png().toFile(new URL("nest.png", destination).pathname);
console.log("Generated public/og/nest.png (1200 × 630).");
