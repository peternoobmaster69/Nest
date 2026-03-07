import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const BANKS_FILE = path.join(ROOT, "lib", "singapore-banks.ts");
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

const banksSource = await readFile(BANKS_FILE, "utf8");
const bankRegex = /\{\s*code:\s*"([^"]+)"[\s\S]*?logoDomain:\s*"([^"]+)"/g;
const banks = [];

for (const match of banksSource.matchAll(bankRegex)) {
  const code = match[1];
  const domain = match[2];
  banks.push({ code, domain });
}

if (!banks.length) {
  console.error("No banks found in lib/singapore-banks.ts.");
  process.exit(1);
}

await mkdir(OUTPUT_DIR, { recursive: true });

let ok = 0;
let failed = 0;

for (const bank of banks) {
  const url = new URL(`https://img.logo.dev/${bank.domain}`);
  url.searchParams.set("token", token);
  url.searchParams.set("size", "256");
  url.searchParams.set("format", "png");

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("image")) {
      throw new Error(`Unexpected content-type: ${contentType}`);
    }

    const bytes = Buffer.from(await res.arrayBuffer());
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
