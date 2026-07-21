import assert from "node:assert/strict";
import test from "node:test";

import { isDatabaseWakeTransientError } from "../lib/database-errors.ts";
import { waitForDatabaseReady } from "../lib/database-readiness.ts";

test("Azure SQL serverless resume errors are retryable", () => {
  assert.equal(
    isDatabaseWakeTransientError(new Error("Database unavailable (40613). Retry the connection.")),
    true,
  );
  assert.equal(isDatabaseWakeTransientError({ code: "P1001" }), true);
  assert.equal(isDatabaseWakeTransientError(new Error("Login failed for user")), false);
});

test("database readiness uses bounded backoff and runs the real probe until it succeeds", async () => {
  const waits = [];
  let attempts = 0;

  await waitForDatabaseReady({
    probe: async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("Database unavailable (40613)");
    },
    retryDelaysMs: [5_000, 10_000, 20_000],
    sleep: async (delayMs) => {
      waits.push(delayMs);
    },
  });

  assert.equal(attempts, 3);
  assert.deepEqual(waits, [5_000, 10_000]);
});

test("database readiness does not retry permanent failures", async () => {
  let attempts = 0;

  await assert.rejects(
    waitForDatabaseReady({
      probe: async () => {
        attempts += 1;
        throw new Error("Login failed for user");
      },
      retryDelaysMs: [5_000, 10_000],
      sleep: async () => undefined,
    }),
    /Login failed/,
  );

  assert.equal(attempts, 1);
});
