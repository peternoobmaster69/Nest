import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  withoutExposureStorageKey,
  withoutPolicyScope,
  withoutWorkspaceScope,
} from "../app/api/cio/_response.ts";

const root = process.cwd();
const source = (file) => readFile(path.join(root, file), "utf8");

const ROUTES = {
  "app/api/cio/overview/route.ts": { reads: 1, writes: 0, bodies: 0 },
  "app/api/cio/profile/route.ts": { reads: 1, writes: 1, bodies: 1 },
  "app/api/cio/policy/route.ts": { reads: 1, writes: 1, bodies: 1 },
  "app/api/cio/investments/[investmentId]/profile/route.ts": { reads: 1, writes: 1, bodies: 1 },
  "app/api/cio/investments/[investmentId]/exposures/route.ts": { reads: 1, writes: 1, bodies: 1 },
  "app/api/cio/recurring-flows/route.ts": { reads: 1, writes: 1, bodies: 1 },
  "app/api/cio/recurring-flows/[id]/route.ts": { reads: 0, writes: 2, bodies: 1 },
  "app/api/cio/planning-positions/route.ts": { reads: 1, writes: 1, bodies: 1 },
  "app/api/cio/planning-positions/[id]/route.ts": { reads: 0, writes: 2, bodies: 1 },
  "app/api/cio/retirement-projection/route.ts": { reads: 1, writes: 0, bodies: 1 },
};

function occurrences(text, pattern) {
  return text.match(pattern)?.length ?? 0;
}

test("CIO response envelopes remove internal scope and storage fields", () => {
  assert.deepEqual(
    withoutWorkspaceScope({ id: "profile-1", workspaceId: "workspace-secret", value: 1 }),
    { id: "profile-1", value: 1 },
  );
  assert.deepEqual(
    withoutPolicyScope({
      id: "band-1",
      workspaceId: "workspace-secret",
      policyId: "policy-internal",
      targetBps: 5_000,
    }),
    { id: "band-1", targetBps: 5_000 },
  );
  assert.deepEqual(
    withoutExposureStorageKey({
      id: "exposure-1",
      workspaceId: "workspace-secret",
      exposureKey: "EQUITY",
      weightBps: 10_000,
    }),
    { id: "exposure-1", key: "EQUITY", weightBps: 10_000 },
  );
});

test("CIO exposes the bounded route surface", async () => {
  const routeSources = await Promise.all(
    Object.entries(ROUTES).map(async ([file, contract]) => [file, contract, await source(file)]),
  );

  const expectedMethods = new Map([
    ["app/api/cio/overview/route.ts", ["GET"]],
    ["app/api/cio/profile/route.ts", ["GET", "PATCH"]],
    ["app/api/cio/policy/route.ts", ["GET", "PATCH"]],
    ["app/api/cio/investments/[investmentId]/profile/route.ts", ["GET", "PUT"]],
    ["app/api/cio/investments/[investmentId]/exposures/route.ts", ["GET", "PUT"]],
    ["app/api/cio/recurring-flows/route.ts", ["GET", "POST"]],
    ["app/api/cio/recurring-flows/[id]/route.ts", ["PATCH", "DELETE"]],
    ["app/api/cio/planning-positions/route.ts", ["GET", "POST"]],
    ["app/api/cio/planning-positions/[id]/route.ts", ["PATCH", "DELETE"]],
    ["app/api/cio/retirement-projection/route.ts", ["POST"]],
  ]);

  for (const [file, , route] of routeSources) {
    const methods = expectedMethods.get(file);
    assert.ok(methods, `missing method contract for ${file}`);
    for (const method of methods) {
      assert.match(route, new RegExp(`export async function ${method}\\b`), `${file} must export ${method}`);
    }
  }
});

test("CIO routes derive workspace scope from secure auth and keep handlers thin", async () => {
  for (const [file, contract] of Object.entries(ROUTES)) {
    const route = await source(file);
    const handlerCount = contract.reads + contract.writes;

    assert.match(route, /runSecureApiRoute/);
    assert.equal(
      occurrences(route, /runSecureApiRoute\(/g),
      handlerCount,
      `${file} must secure every handler`,
    );
    assert.equal(
      occurrences(route, /minimumRole:\s*"VIEWER"/g),
      contract.reads,
      `${file} must require VIEWER for reads`,
    );
    assert.equal(
      occurrences(route, /minimumRole:\s*"EDITOR"/g),
      contract.writes,
      `${file} must require EDITOR for writes`,
    );
    assert.equal(
      occurrences(route, /mutation:\s*true/g),
      contract.writes,
      `${file} must apply same-origin checks to every mutation`,
    );
    assert.equal(
      occurrences(route, /parseJsonBody\(/g),
      contract.bodies,
      `${file} must parse each JSON body through a bounded contract`,
    );
    assert.equal(
      occurrences(route, /parseJsonBody\(\s*request,\s*\w+,\s*\d+\s*\*\s*1024\s*,?\s*\)/g),
      contract.bodies,
      `${file} must set an explicit request-body byte limit`,
    );
    assert.equal(
      occurrences(route, /noStore:\s*true/g),
      handlerCount,
      `${file} must make private caching policy explicit`,
    );
    assert.equal(
      occurrences(route, /errorMessage:\s*"[^"]+"/g),
      handlerCount,
      `${file} must use stable public failure messages`,
    );
    assert.doesNotMatch(route, /searchParams\.get\(["']workspaceId["']\)/);
    assert.doesNotMatch(route, /auth:\s*\{[^}]*workspaceId/);
    assert.doesNotMatch(route, /@\/lib\/prisma|\bprisma\./);
    assert.doesNotMatch(route, /request\.json\(|safeParse\(await request/);
    assert.doesNotMatch(route, /catch\s*\(/);
  }
});

test("CIO request contracts are strict, bounded, and omit caller workspace identity", async () => {
  const contracts = await source("lib/domains/cio/contracts.ts");

  for (const schema of [
    "CioBoundedIdSchema",
    "CioProfileInputSchema",
    "CioPolicyInputSchema",
    "CioInvestmentProfileInputSchema",
    "CioExposureInputSchema",
    "CioExposuresInputSchema",
    "CioRecurringFlowCreateSchema",
    "CioRecurringFlowUpdateSchema",
    "CioPlanningPositionCreateSchema",
    "CioPlanningPositionUpdateSchema",
    "CioRetirementProjectionInputSchema",
  ]) {
    assert.match(contracts, new RegExp(`export const ${schema}\\b`), `${schema} must be shared`);
  }

  assert.match(contracts, /\.strict\(\)/);
  assert.match(contracts, /\.max\(/);
  assert.doesNotMatch(contracts, /workspaceId\s*:\s*z\./);
});

test("CIO routes delegate scoped references and mutations to the domain repository", async () => {
  const repository = await source("lib/domains/cio/repository.ts");

  assert.match(repository, /where: \{ id: investmentAccountId, workspaceId \}/);
  assert.match(repository, /where: \{ id: value\.sourceFinancialAccountId, workspaceId \}/);
  assert.match(repository, /requireInvestment\(db, workspaceId, value\.sourceInvestmentAccountId\)/);
  assert.match(repository, /requireInvestment\(db, workspaceId, value\.destinationInvestmentAccountId\)/);
  assert.match(repository, /where: \{ id: params\.id, workspaceId: params\.workspaceId \}/);
  assert.match(repository, /deleteMany\(\{ where: \{ id: params\.id, workspaceId: params\.workspaceId \} \}\)/);
  assert.match(repository, /workspaceAuditLog\.create/);
  assert.match(repository, /isolationLevel: Prisma\.TransactionIsolationLevel\.Serializable/);
});
