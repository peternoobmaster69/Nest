import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, afterEach, beforeEach, mock } from "node:test";
import { createReactHarness } from "./react-harness.mjs";

export async function createAgentUiHarness() {
  const ui = await createReactHarness();
  const require = createRequire(import.meta.url);
  const { QueryClient, QueryClientProvider } = require("@tanstack/react-query");
  const { AGENT_IDS, defaultAgentConfiguration } = require("../lib/ai/agent-catalog.ts");
  const state = { requests: [], responses: new Map(), notices: [], invalidations: [], changes: 0, details: new Map(), registry: null };
  const clients = [];
  mock.module("../lib/api/client.ts", { namedExports: { apiFetch: async (url, options = {}) => {
    const request = { url, ...options, method: options.method ?? "GET", body: options.body ? JSON.parse(options.body) : undefined };
    state.requests.push(request);
    const key = `${request.method} ${url}`;
    assert.ok(state.responses.has(key), `Unexpected API call: ${key}`);
    const response = state.responses.get(key);
    if (response instanceof Error) throw response;
    return structuredClone(typeof response === "function" ? await response(request) : response);
  } } });
  mock.module("../components/toast-provider.tsx", { namedExports: { useToast: () => ({
    success: (message) => state.notices.push({ tone: "success", message }),
    error: (message) => state.notices.push({ tone: "error", message }),
  }) } });
  mock.module("../components/workspace-provider.tsx", { namedExports: { useWorkspaceId: () => "workspace-one" } });

  function detail(id = "ask-nest", values = {}) {
    return { configuration: { ...defaultAgentConfiguration(id), revision: 1 }, trainingCount: 1, evaluationCount: 0, draftCount: 0,
      examples: [], evaluations: [], fineTuningJobs: [], revisions: [], ...values };
  }
  function example(id, values = {}) {
    return { id, agentId: "ask-nest", revision: 2, updatedAt: "2026-10-01T12:00:00Z", title: `Example ${id}`, input: `Request ${id}`,
      expectedOutput: `Answer ${id}`, contextJson: "{}", purpose: "TRAINING", status: "APPROVED", matchMode: "CONTAINS", ...values };
  }
  function job(id = "job-one", values = {}) {
    return { id, providerJobId: "azure-job-one", baseModel: "gpt-base", trainingType: "Standard", status: "QUEUED", fineTunedModel: null,
      trainingCount: 12, validationCount: 2, revision: 1, error: null, createdAt: "2026-10-01T12:00:00Z", updatedAt: "2026-10-01T12:00:00Z", ...values };
  }
  function show(Component, props = {}) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } } });
    const invalidate = client.invalidateQueries.bind(client);
    client.invalidateQueries = (options) => { state.invalidations.push(options.queryKey); return invalidate(options); };
    clients.push(client);
    const onChanged = async () => { state.changes++; };
    const element = (values) => ui.h(QueryClientProvider, { client }, ui.h(Component, { onChanged, ...values }));
    return { ...ui.render(element(props)), client, element };
  }
  function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
  }
  beforeEach(() => {
    state.requests.length = state.notices.length = state.invalidations.length = 0;
    state.changes = 0;
    state.details = new Map(AGENT_IDS.map((id) => [id, detail(id)]));
    state.registry = { agents: [...state.details.values()].map(({ configuration, trainingCount, evaluationCount, draftCount }) => ({ configuration, trainingCount, evaluationCount, draftCount })),
      provider: { configured: true, model: "default-deployment" } };
    state.responses = new Map([["GET /api/admin/agents", () => state.registry]]);
    for (const id of AGENT_IDS) state.responses.set(`GET /api/admin/agents/${id}`, () => state.details.get(id));
  });
  afterEach(() => { ui.cleanup(); for (const client of clients.splice(0)) client.clear(); });
  after(() => ui.dispose());
  return { ui, require, state, detail, example, job, show, deferred };
}
