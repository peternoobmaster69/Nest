import { mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { Session } from "node:inspector";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { threadId } from "node:worker_threads";
import TestExclude from "test-exclude";

const directory = process.env.NODE_V8_COVERAGE;
if (directory) {
  const config = JSON.parse(await readFile(path.resolve(".c8rc.json"), "utf8"));
  const scope = new TestExclude({ cwd: process.cwd(), include: config.include, exclude: config.exclude, extension: config.extension });
  const selected = new Set((await scope.glob(process.cwd())).map((file) => path.resolve(file)));
  mkdirSync(directory, { recursive: true });
  const session = new Session();
  session.connect();
  session.on("Debugger.scriptParsed", ({ params }) => {
    const url = path.isAbsolute(params.url) ? pathToFileURL(params.url).href : params.url;
    if (!url.startsWith("file:")) return;
    if (!selected.has(fileURLToPath(url).split("?tsx-commonjs-", 1)[0])) return;
    session.post("Debugger.getScriptSource", { scriptId: params.scriptId }, (error, result) => {
      if (error) throw new Error(`Unable to collect executed source: ${url}`, { cause: error });
      const data = { url, source: result.scriptSource, scriptId: params.scriptId, processId: process.pid, threadId };
      writeFileSync(path.join(directory, `source-${process.pid}-${threadId}-${params.scriptId}.json`), JSON.stringify(data));
    });
  });
  // The local inspector returns already parsed scripts too, including this
  // preload. It opens no listening port and does not alter native hit counts.
  session.post("Debugger.enable");
  // Keep it connected through shutdown: disconnecting in an exit handler drops
  // V8's block counters before Node writes its native coverage files.
}
