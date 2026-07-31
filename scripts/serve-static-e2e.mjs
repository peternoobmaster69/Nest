import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const root = join(process.cwd(), "public");
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url || "/", "http://127.0.0.1").pathname);
  const relative = normalize(pathname).replace(/^([/\\])+/, "");
  const file = join(root, relative || "offline.html");
  if (!file.startsWith(root)) {
    response.writeHead(403).end();
    return;
  }
  try {
    if (!(await stat(file)).isFile()) throw new Error("not a file");
    response.writeHead(200, { "Content-Type": contentTypes[extname(file)] || "application/octet-stream" });
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404).end("Not found");
  }
}).listen(3100, "127.0.0.1");
