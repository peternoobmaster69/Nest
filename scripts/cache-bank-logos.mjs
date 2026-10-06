import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { SINGAPORE_BANKS } from "../lib/singapore-banks.ts";

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, "public", "banks");
const token = process.env.NEXT_PUBLIC_LOGO_DEV_TOKEN;

if (!token) {
  console.error("Missing NEXT_PUBLIC_LOGO_DEV_TOKEN in environment.");
  process.exit(1);
}
if (!token.startsWith("pk_")) {
  console.error("NEXT_PUBLIC_LOGO_DEV_TOKEN must be a publishable Logo.dev key (pk_...).");
  console.error("Secret keys (sk_...) do not work with img.logo.dev.");
  process.exit(1);
}

const banks = SINGAPORE_BANKS.filter((bank) => bank.logoDomain)
  .map((bank) => ({ code: bank.code, domain: bank.logoDomain }));

if (!banks.length) {
  console.error("No banks found in lib/singapore-banks.ts.");
  process.exit(1);
}

await mkdir(OUTPUT_DIR, { recursive: true });

let ok = 0;
let failed = 0;

for (const bank of banks) {
  if (!/^[A-Z0-9]+$/.test(bank.code) || !/^[a-z0-9.-]+$/.test(bank.domain)) {
    throw new Error("Bank logo metadata contains an invalid code or domain.");
  }
  const url = new URL(`https://img.logo.dev/${bank.domain}`);
  url.searchParams.set("token", token);
  url.searchParams.set("size", "256");
  url.searchParams.set("format", "png");

  try {
    const res = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("image")) {
      throw new Error(`Unexpected content-type: ${contentType}`);
    }

    if (!res.body) throw new Error("Logo response is empty.");
    const chunks = [];
    let size = 0;
    for await (const chunk of res.body) {
      size += chunk.byteLength;
      if (size > 1_000_000) throw new Error("Logo response exceeds the size limit.");
      chunks.push(chunk);
    }
    // Decode and re-encode provider data before serving it as a local PNG.
    const bytes = await sharp(Buffer.concat(chunks), { limitInputPixels: 4_000_000 })
      .resize(256, 256, { fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
    const outFile = path.join(OUTPUT_DIR, `${bank.code}.png`);
    await writeFile(outFile, bytes);
    ok += 1;
    console.log(`OK   ${bank.code} <- ${bank.domain}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${bank.code} <- ${bank.domain}: ${error.message}`);
  }
}

console.log(`Done. Cached ${ok}/${banks.length} logos. Failed: ${failed}.`);
if (failed > 0) process.exitCode = 2;
