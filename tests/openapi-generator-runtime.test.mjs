import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test, { beforeEach, mock } from "node:test";

const root = resolve(import.meta.dirname, "..");
const apiRoot = resolve(root, "app/api");
const outputPath = resolve(root, "generated/openapi.json");
const generatedDirectory = dirname(outputPath);
const handlers = (...methods) => methods.map((method) => `export async function ${method}() {}`).join("\n");
const routeSources = new Map(Object.entries({
  "route.ts": handlers("GET"),
  "auth/[...nextauth]/route.ts": "const handler = () => {}; export { handler as GET, handler as POST };",
  "public/demo/[token]/route.ts": handlers("GET"),
  "passkeys/authenticate/options/route.ts": handlers("POST"),
  "cron/refresh/route.ts": handlers("GET"),
  "optional/[[...segments]]/route.ts": handlers("GET"),
  "generic/[id]/route.ts": `
    export const GET = () => {};
    export let POST = async (request) => {
      DirectSchema.safeParse(request); parseJsonBody(request, BodySchema);
      DirectSchema.parse(request); parseJsonBody(request, BodySchema);
      parseJsonBody(); parseJsonBody(request, {}); helper(request);
      validator.object().parse(request); notASchemaName.parse(request);
    };
    export const { ignored } = anotherModule;
    const documentation = "PhantomSchema.parse(request)";
    // export function DELETE() { CommentSchema.parse(request); }
  `,
  "hidden/route.ts": `
    function GET() {}
    export { GET as hidden };
    export type { POST } from "./types";
    export { type PUT } from "./types";
    export default function DELETE() {}
    export class PATCH {}
    export * from "./elsewhere";
  `,
  "admin/agents/route.ts": handlers("GET"),
  "admin/agents/[agentId]/examples/route.ts": handlers("POST"),
  "admin/agents/[agentId]/examples/[exampleId]/route.ts": handlers("PUT", "DELETE"),
  "admin/agents/[agentId]/dataset/route.ts": handlers("GET"),
  "admin/agents/[agentId]/fine-tuning/route.ts": handlers("POST"),
  "admin/agents/[agentId]/fine-tuning/[jobId]/route.ts": handlers("POST"),
  "cio/profile/route.ts": `${handlers("GET", "PATCH")}\nCioProfileInputSchema.parse({});`,
  "cio/recurring-flows/route.ts": handlers("GET", "POST"),
  "cio/reports/[id]/pdf/route.ts": handlers("GET"),
  "budgets/plan/route.ts": handlers("DELETE", "POST", "PATCH"),
  "ai/transactions/route.ts": `${handlers("GET", "POST")}\nTransactionAgentRequestSchema.parse({});`,
  "ai/ask/route.ts": handlers("POST"),
  "notes/README.md": "Not a route",
}));
let stored, calls, messages, scenario = 0;
const namedFs = Object.fromEntries(Object.entries(fs).filter(([name]) => name !== "default"));
const overrides = {
  async readdir(directory, options) {
    if (!String(directory).startsWith(apiRoot)) return fs.readdir(directory, options);
    assert.equal(options.withFileTypes, true);
    const prefix = directory === apiRoot ? "" : `${String(directory).slice(apiRoot.length + 1).split(sep).join("/")}/`;
    const entries = new Map();
    for (const file of routeSources.keys()) {
      if (!file.startsWith(prefix)) continue;
      const remainder = file.slice(prefix.length);
      const name = remainder.split("/")[0];
      const directory = remainder.includes("/");
      entries.set(name, { name, isDirectory: () => directory, isFile: () => !directory });
    }
    entries.set("shortcut", { name: "shortcut", isDirectory: () => false, isFile: () => false });
    return [...entries.values()].reverse();
  },
  async readFile(path, encoding) {
    const filename = path instanceof URL ? fileURLToPath(path) : String(path);
    if (filename === outputPath) {
      if (stored === undefined) throw Object.assign(new Error("Missing generated file"), { code: "ENOENT" });
      return stored;
    }
    if (filename.startsWith(`${apiRoot}${sep}`)) {
      const relative = filename.slice(apiRoot.length + 1).split(sep).join("/");
      assert.ok(routeSources.has(relative), `Unexpected route read: ${relative}`);
      return routeSources.get(relative);
    }
    return fs.readFile(path, encoding);
  },
  async mkdir(directory, options) {
    if (directory !== generatedDirectory) return fs.mkdir(directory, options);
    calls.push({ kind: "mkdir", directory, options });
  },
  async writeFile(path, content, encoding) {
    assert.equal(path, outputPath);
    assert.equal(encoding, "utf8");
    calls.push({ kind: "write", path });
    stored = content;
  },
};
mock.module("node:fs/promises", { namedExports: { ...namedFs, ...overrides }, defaultExport: { ...fs.default, ...overrides } });

async function generate(check = false) {
  process.argv = [process.execPath, resolve(root, "scripts/generate-openapi.mjs"), ...(check ? ["--check"] : [])];
  await import(`../scripts/generate-openapi.mjs?fixture=${scenario++}`);
  return stored === undefined ? null : JSON.parse(stored);
}

beforeEach((t) => {
  const argv = process.argv;
  const exitCode = process.exitCode;
  t.after(() => { process.argv = argv; process.exitCode = exitCode; });
  process.exitCode = 0;
  calls = [];
  messages = [];
  stored = undefined;
  t.mock.method(console, "log", (message) => messages.push({ level: "log", message }));
  t.mock.method(console, "error", (message) => messages.push({ level: "error", message }));
});

test("OpenAPI discovery uses actual exports, aliases, and catch-all paths without documenting comments or types", async () => {
  const { paths } = await generate();
  assert.equal(paths["/api"].get.operationId, "get_api");
  assert.deepEqual(paths["/api"].get.tags, ["api"]);
  assert.deepEqual(Object.keys(paths["/api/auth/{nextauth}"]), ["get", "post"]);
  assert.deepEqual(Object.keys(paths["/api/generic/{id}"]), ["get", "post"]);
  assert.equal(paths["/api/hidden"], undefined);
  assert.equal(paths["/api/notes"], undefined);
  assert.equal(paths["/api/optional/{segments}"].get.parameters[0].name, "segments");
  assert.deepEqual(paths["/api/generic/{id}"].get.parameters, [{ name: "id", in: "path", required: true, schema: { type: "string", maxLength: 191 } }]);
  assert.equal(paths["/api/generic/{id}"].post["x-source-handler"], "app/api/generic/[id]/route.ts");
  assert.deepEqual(paths["/api/generic/{id}"].post["x-request-schemas"], ["BodySchema", "DirectSchema"]);
  assert.deepEqual(paths["/api/generic/{id}"].post.requestBody.content["application/json"].schema, { type: "object" });
  assert.deepEqual(calls, [{ kind: "mkdir", directory: generatedDirectory, options: { recursive: true } }, { kind: "write", path: outputPath }]);
  assert.ok(stored.endsWith("\n"));
  assert.equal(Object.keys(paths).length, 19);
  assert.deepEqual(messages.filter(({ level }) => level === "log"), [{ level: "log", message: "Generated 19 OpenAPI paths." }]);
});

test("OpenAPI preserves public, scheduler, workspace, and administrator authentication and request contracts", async () => {
  const spec = await generate();
  const { paths } = spec;
  for (const [path, method] of [["/api/auth/{nextauth}", "get"], ["/api/public/demo/{token}", "get"], ["/api/passkeys/authenticate/options", "post"]]) {
    assert.deepEqual(paths[path][method].security, []);
  }
  assert.deepEqual(paths["/api/cron/refresh"].get.security, [{ cronSecret: [] }]);
  assert.deepEqual(paths["/api/generic/{id}"].get.security, [{ sessionCookie: [] }, { secureSessionCookie: [] }]);
  const profile = paths["/api/cio/profile"];
  assert.equal(profile.get["x-required-workspace-role"], "VIEWER");
  assert.equal(profile.get["x-same-origin-required"], false);
  assert.equal(profile.get["x-request-schemas"], undefined);
  assert.equal(profile.patch["x-required-workspace-role"], "EDITOR");
  assert.equal(profile.patch["x-same-origin-required"], true);
  assert.equal(profile.patch.requestBody.content["application/json"].schema.$ref, "#/components/schemas/CioProfileInputSchema");
  for (const status of ["404", "413", "415"]) assert.ok(profile.patch.responses[status]);
  assert.equal(paths["/api/cio/recurring-flows"].post.responses["201"].description, "Resource created");
  assert.equal(paths["/api/cio/reports/{id}/pdf"].get.responses["200"].content["application/pdf"].schema.format, "binary");
  const example = paths["/api/admin/agents/{agentId}/examples/{exampleId}"];
  assert.ok(example.delete.responses["204"]);
  assert.equal(example.delete["x-required-admin"], true);
  assert.equal(example.delete.requestBody.content["application/json"].schema.$ref, "#/components/schemas/AgentRevisionSchema");
  assert.deepEqual(example.put.parameters[0].schema.enum, ["ask-nest", "transaction-assistant", "smart-review"]);
  assert.ok(paths["/api/admin/agents/{agentId}/examples"].post.responses["201"]);
  assert.ok(paths["/api/admin/agents/{agentId}/fine-tuning"].post.responses["201"]);
  assert.ok(paths["/api/admin/agents/{agentId}/fine-tuning/{jobId}"].post.responses["200"]);
  const dataset = paths["/api/admin/agents/{agentId}/dataset"].get;
  assert.equal(dataset.parameters.at(-1).schema.default, "TRAINING");
  assert.ok(dataset.responses["200"].content["application/x-ndjson"]);
  const plan = paths["/api/budgets/plan"].delete;
  assert.deepEqual(plan.parameters.map((parameter) => parameter.name), ["workspaceId", "id", "type"]);
  assert.equal(plan.requestBody, undefined);
  const transactions = paths["/api/ai/transactions"];
  assert.equal(transactions.get["x-request-schemas"], undefined);
  assert.equal(transactions.get.parameters.at(-1).name, "draftId");
  assert.equal(transactions.post["x-same-origin-required"], true);
  assert.equal(transactions.post.requestBody.content["application/json"].schema.$ref, "#/components/schemas/TransactionAgentRequestSchema");
  assert.equal(spec.components.securitySchemes.secureSessionCookie.name, "__Secure-next-auth.session-token");
  assert.ok(spec.components.schemas.CioProfileInputSchema.allOf.length > 0);
  assert.equal(spec.components.schemas.CioPlanningPositionUpdateSchema.minProperties, 1);
  assert.match(spec.components.schemas.AskNestRequestSchema["x-runtime-refinements"][0], /Combined history content/);
  assert.equal(spec.components.responses.RateLimited.headers["Retry-After"].schema.type, "integer");
});

test("OpenAPI check mode accepts identical output and reports stale or missing files without writing", async () => {
  await generate();
  calls.length = 0;
  messages.length = 0;
  await generate(true);
  assert.equal(process.exitCode, 0);
  assert.deepEqual(calls, []);
  assert.deepEqual(messages, []);
  for (const previous of ["{}", undefined]) {
    stored = previous;
    process.exitCode = 0;
    await generate(true);
    assert.equal(process.exitCode, 1);
    assert.equal(stored, previous);
    assert.deepEqual(calls, []);
    assert.match(messages.at(-1).message, /openapi.json is stale/);
  }
});
