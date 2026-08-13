import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";

import { backgroundJobToProgress, sanitizeBackgroundJobError } from "../lib/background-jobs.ts";

function makeJob(overrides = {}) {
  return {
    id: "job-1",
    type: "GMAIL_SYNC",
    key: "gmail:integration-1",
    status: "RUNNING",
    workspaceId: "workspace-1",
    userId: "user-1",
    progress: 0,
    total: 0,
    current: 0,
    message: "Gmail sync queued.",
    resultJson: null,
    error: null,
    lockedAt: new Date("2026-07-21T00:00:00.000Z"),
    leaseExpiresAt: new Date("2026-07-21T00:15:00.000Z"),
    startedAt: new Date("2026-07-21T00:00:00.000Z"),
    finishedAt: null,
    createdAt: new Date("2026-07-21T00:00:00.000Z"),
    updatedAt: new Date("2026-07-21T00:00:00.000Z"),
    ...overrides,
  };
}

test("an active background job keeps reporting its persisted progress", () => {
  const progress = backgroundJobToProgress(
    makeJob(),
    new Date("2026-07-21T00:10:00.000Z").getTime(),
  );

  assert.equal(progress?.phase, "writing");
  assert.equal(progress?.message, "Gmail sync queued.");
  assert.equal(progress?.progress, 0);
});

test("an expired background job stops polling and asks the user to retry", () => {
  const progress = backgroundJobToProgress(
    makeJob(),
    new Date("2026-07-21T00:15:00.000Z").getTime(),
  );

  assert.equal(progress?.phase, "error");
  assert.equal(progress?.progress, 100);
  assert.match(progress?.message ?? "", /Please retry/);
  assert.equal(progress?.errorCode, "LEASE_EXPIRED");
});

test("a failed background job exposes its safe error code to the owning UI", () => {
  const progress = backgroundJobToProgress(makeJob({
    status: "FAILED",
    errorCode: "GMAIL_RECONNECT_REQUIRED",
    message: "Reconnect Gmail in Settings.",
    leaseExpiresAt: null,
  }));

  assert.equal(progress?.phase, "error");
  assert.equal(progress?.errorCode, "GMAIL_RECONNECT_REQUIRED");
});

test("a database constraint failure retains only its safe constraint name", () => {
  const failure = sanitizeBackgroundJobError(new Prisma.PrismaClientKnownRequestError(
    "database rejected private row data",
    {
      code: "P2003",
      clientVersion: "test",
      meta: { constraint: "CardAlertStaging_currency_check" },
    },
  ));

  assert.equal(failure.code, "P2003:CardAlertStaging_currency_check");
  assert.match(failure.message, /database validation/);
  assert.doesNotMatch(failure.message, /private row data/);
});
