import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { bootstrapSonar } from "../scripts/sonar-ci-bootstrap.mjs";

const hostedEnvironment = {
  GITHUB_ACTIONS: "true",
  RUNNER_ENVIRONMENT: "github-hosted",
  SONAR_DISPOSABLE: "true",
  SONAR_HOST_URL: "http://127.0.0.1:9000",
  RUNNER_TEMP: "/tmp/nest-ci-fixture",
  GITHUB_ENV: "/tmp/nest-ci-fixture/env",
};

function fixture(timestamp = "2026-10-06T23:59:59.999Z") {
  let clock = Date.parse(timestamp);
  const requests = [];
  const masks = [];
  const published = [];
  const credentials = [];
  const responses = new Map([
    ["api/system/status", { status: "UP" }],
    ["api/projects/search", { paging: { total: 0 } }],
    ["api/users/change_password", {}],
    ["api/projects/create", {}],
  ]);
  const options = {
    env: { ...hostedEnvironment },
    now: () => clock,
    pause: async (ms) => { clock += ms; },
    mask: (secret) => masks.push(secret),
    publish: (name, secret) => {
      assert.ok(masks.includes(secret), "credentials must be masked before export");
      published.push([name, secret]);
    },
    client: ({ serverUrl, authorization }) => {
      assert.equal(serverUrl, "http://127.0.0.1:9000");
      const credential = Buffer.from(authorization.slice("Basic ".length), "base64").toString();
      credentials.push(credential);
      return async (endpoint, params = {}, method = "GET") => {
        requests.push({ endpoint, params, method, credential });
        if (endpoint === "api/user_tokens/generate" && !responses.has(endpoint)) {
          return { token: `fixture-${params.type}` };
        }
        assert.ok(responses.has(endpoint), `Unexpected endpoint ${endpoint}`);
        const response = responses.get(endpoint);
        return typeof response === "function" ? response() : response;
      };
    },
  };
  return { options, requests, masks, published, credentials, responses };
}

test("Sonar bootstrap refuses non-disposable, non-hosted, or external environments before connecting", async () => {
  for (const key of Object.keys(hostedEnvironment)) {
    const state = fixture();
    state.options.env[key] = "";
    await assert.rejects(bootstrapSonar(state.options), /restricted to the disposable/);
    assert.equal(state.requests.length, 0);
  }
  const state = fixture();
  state.options.env.SONAR_HOST_URL = "https://production.example.test";
  await assert.rejects(bootstrapSonar(state.options), /restricted to the disposable/);
  assert.deepEqual(state.credentials, []);
});

test("Sonar bootstrap never replaces credentials or settings on an existing instance", async () => {
  const state = fixture();
  state.responses.set("api/projects/search", { paging: { total: 1 } });
  await assert.rejects(bootstrapSonar(state.options), /existing SonarQube instance/);
  assert.ok(state.requests.every((request) => request.method === "GET"));
  assert.deepEqual(state.published, []);
});

test("disposable credentials remain valid across UTC midnight and stay scoped and masked", async () => {
  for (const timestamp of ["2026-10-06T00:00:00.000Z", "2026-10-06T23:59:59.999Z", "2026-12-31T23:59:00.000Z"]) {
    const state = fixture(timestamp);
    await bootstrapSonar(state.options);
    const change = state.requests.find((request) => request.endpoint === "api/users/change_password");
    assert.equal(change.params.previousPassword, "admin");
    assert.match(change.params.password, /^Nest_[a-f0-9]{64}Aa1!$/);
    assert.ok(state.masks.includes(change.params.password));
    assert.equal(state.credentials[1], `admin:${change.params.password}`);
    const created = state.requests.find((request) => request.endpoint === "api/projects/create");
    assert.equal(created.params.visibility, "private");
    assert.equal(created.method, "POST");
    const tokens = state.requests.filter((request) => request.endpoint === "api/user_tokens/generate");
    assert.equal(tokens.length, 2);
    for (const request of tokens) {
      const lifetime = Date.parse(`${request.params.expirationDate}T00:00:00.000Z`) - Date.parse(timestamp);
      assert.ok(lifetime >= 86_400_000 && lifetime <= 2 * 86_400_000);
      assert.equal(request.method, "POST");
    }
    assert.equal(tokens[0].params.type, "USER_TOKEN");
    assert.equal(tokens[0].params.projectKey, undefined);
    assert.equal(tokens[1].params.type, "PROJECT_ANALYSIS_TOKEN");
    assert.equal(tokens[1].params.projectKey, "nest");
    assert.deepEqual(state.published.map(([name]) => name), ["SONAR_ADMIN_TOKEN", "SONAR_TOKEN"]);
  }
});

test("Sonar startup retries connection errors and non-ready states but has a deadline", async () => {
  const state = fixture();
  let attempts = 0;
  state.responses.set("api/system/status", () => {
    attempts += 1;
    if (attempts === 1) throw new Error("Starting");
    return { status: attempts === 2 ? "STARTING" : "UP" };
  });
  await bootstrapSonar(state.options);
  assert.equal(attempts, 3);
  const unavailable = fixture();
  unavailable.responses.set("api/system/status", { status: "STARTING" });
  await assert.rejects(bootstrapSonar(unavailable.options), /within five minutes/);
  assert.deepEqual(unavailable.published, []);
});

test("missing Sonar tokens fail without publishing an unusable credential", async () => {
  const state = fixture();
  state.responses.set("api/user_tokens/generate", {});
  await assert.rejects(bootstrapSonar(state.options), /did not return a CI token/);
  assert.deepEqual(state.published, []);
});

test("the bootstrap command reports rejected environments with a failing exit status", () => {
  const result = spawnSync(process.execPath, ["scripts/sonar-ci-bootstrap.mjs"], {
    env: { ...process.env, GITHUB_ACTIONS: "false" },
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /restricted to the disposable/);
});
