import { readFile } from "node:fs/promises";
import path from "node:path";

const orderedStyles = [
  "app/styles/tokens.css",
  "app/styles/base.css",
  "app/styles/features.css",
  "app/styles/components.css",
  "app/styles/utilities.css",
  "app/styles/landing.css",
  "app/styles/ask-nest.css",
];

export async function readAppStyles(root = process.cwd()) {
  return (await Promise.all(orderedStyles.map((file) => readFile(path.join(root, file), "utf8")))).join("\n");
}
