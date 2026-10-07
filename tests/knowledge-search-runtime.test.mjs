import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { beforeEach, mock } from "node:test";

const require = createRequire(import.meta.url);
const calls = [];
let documents, failure;
class QueryCredential { constructor(key) { this.key = key; } }
class ManagedCredential {}
class SearchClient {
  constructor(endpoint, index, credential) { calls.push({ type: "client", endpoint, index, credential }); }
  async search(query, options) {
    calls.push({ type: "search", query, options });
    if (failure) throw failure;
    return { results: (async function* () { yield* documents; })() };
  }
}
for (const [name, namedExports] of [
  ["@azure/core-auth", { AzureKeyCredential: QueryCredential }],
  ["@azure/identity", { DefaultAzureCredential: ManagedCredential }],
  ["@azure/search-documents", { SearchClient }],
]) {
  mock.module(name, { namedExports });
  mock.module(require.resolve(name), { namedExports });
}
const { getAskNestSearchGate: gate, searchAskNestKnowledge: search } = require("../lib/ai/knowledge-search.ts");
const fields = ["ASK_NEST_SEARCH_ENABLED", "ASK_NEST_SEARCH_EVAL_PASS", "AZURE_SEARCH_ENDPOINT", "AZURE_SEARCH_INDEX", "AZURE_SEARCH_QUERY_KEY", "AZURE_SEARCH_SEMANTIC_CONFIGURATION"];
const params = { workspaceId: "home", userId: "owner", query: "food", limit: 4 };
beforeEach((t) => {
  assert.equal(require("@azure/search-documents").SearchClient, SearchClient);
  const original = new Map(fields.map((key) => [key, process.env[key]]));
  t.after(() => { for (const [key, value] of original) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  for (const key of fields) delete process.env[key];
  calls.length = 0; documents = []; failure = null;
});
function configure() {
  process.env.ASK_NEST_SEARCH_ENABLED = " TRUE ";
  process.env.ASK_NEST_SEARCH_EVAL_PASS = "true";
  process.env.AZURE_SEARCH_ENDPOINT = " https://search.example.test/ ";
  process.env.AZURE_SEARCH_INDEX = " workspace-notes ";
}

test("knowledge search requires configuration, explicit enablement, and a passing evaluation before any provider request", async () => {
  assert.deepEqual(gate(), { enabled: false, evaluationPassed: false, configured: false, active: false, reason: "DISABLED" });
  assert.deepEqual(await search(params), []);
  process.env.ASK_NEST_SEARCH_ENABLED = "true";
  assert.equal(gate().reason, "EVALUATION_REQUIRED");
  process.env.ASK_NEST_SEARCH_EVAL_PASS = "true";
  assert.equal(gate().reason, "NOT_CONFIGURED");
  assert.deepEqual(await search(params), []);
  configure();
  process.env.ASK_NEST_SEARCH_ENABLED = "false";
  assert.deepEqual(await search(params), []);
  process.env.ASK_NEST_SEARCH_ENABLED = "true";
  process.env.ASK_NEST_SEARCH_EVAL_PASS = "false";
  assert.deepEqual(await search(params), []);
  assert.equal(calls.length, 0);
});

test("invalid endpoints and missing index names cannot activate the search client", async () => {
  configure();
  for (const endpoint of ["", "not a url", "http://search.example.test", "https://user@search.example.test", "https://:pass@search.example.test", "https://search.example.test?private=1", "https://search.example.test#fragment"]) {
    process.env.AZURE_SEARCH_ENDPOINT = endpoint;
    assert.equal(gate().configured, false);
    assert.deepEqual(await search(params), []);
  }
  process.env.AZURE_SEARCH_ENDPOINT = "https://search.example.test";
  process.env.AZURE_SEARCH_INDEX = " ";
  assert.equal(gate().reason, "NOT_CONFIGURED");
  assert.equal(calls.length, 0);
});

test("search uses identity credentials, escapes tenant filters, and bounds semantic and vector results", async () => {
  configure();
  assert.deepEqual(gate(), { enabled: true, evaluationPassed: true, configured: true, active: true, reason: "ACTIVE" });
  await search({ ...params, workspaceId: "home' or true", userId: "owner's", limit: 100 });
  assert.ok(calls[0].credential instanceof ManagedCredential);
  assert.equal(calls[0].endpoint, "https://search.example.test");
  assert.equal(calls[0].index, "workspace-notes");
  const options = calls[1].options;
  assert.equal(options.filter, "workspaceId eq 'home'' or true' and (userId eq null or userId eq 'owner''s')");
  assert.equal(options.top, 8);
  assert.equal(options.semanticSearchOptions.configurationName, "ask-nest-semantic");
  assert.equal(options.vectorSearchOptions.filterMode, "preFilter");
  assert.deepEqual(options.vectorSearchOptions.queries, [{ kind: "text", text: "food", fields: ["contentVector"], kNearestNeighborsCount: 50 }]);
  assert.ok(!options.select.includes("contentVector"));
  process.env.AZURE_SEARCH_QUERY_KEY = " fixture-query-key ";
  process.env.AZURE_SEARCH_SEMANTIC_CONFIGURATION = " custom-semantic ";
  await search({ ...params, limit: 0 });
  assert.ok(calls[2].credential instanceof QueryCredential);
  assert.equal(calls[2].credential.key, "fixture-query-key");
  assert.equal(calls[3].options.top, 1);
  assert.equal(calls[3].options.semanticSearchOptions.configurationName, "custom-semantic");
});

test("indexed content is bounded and every evidence link stays within the application", async () => {
  configure();
  documents = [undefined, null, "https://outside.example.test", "//outside.example.test", "/\\outside.example.test", "/transactions?budget=food#one"].map((sourceUrl, index) => ({
    document: { id: String(index), title: "t".repeat(200), content: "c".repeat(1500), sourceType: "s".repeat(70), sourceId: index === 0 ? null : "i".repeat(200), sourceUrl },
    score: index === 0 ? undefined : 1.5, rerankerScore: index === 0 ? null : 2.5,
  }));
  const results = await search(params);
  assert.equal(results.length, 6);
  assert.ok(results.every((item) => item.title.length === 180 && item.content.length === 1200 && item.sourceType.length === 60));
  assert.ok(results.slice(0, 5).every((item) => item.href === "/transactions"));
  assert.equal(results[5].href, "/transactions?budget=food#one");
  assert.equal(results[0].sourceId, null); assert.equal(results[0].score, null); assert.equal(results[0].rerankerScore, null);
  assert.equal(results[1].sourceId.length, 180); assert.equal(results[1].score, 1.5); assert.equal(results[1].rerankerScore, 2.5);
});

test("provider failures propagate without substituting ungrounded search results", async () => {
  configure();
  failure = new Error("Search unavailable");
  await assert.rejects(search(params), (error) => error === failure);
});
