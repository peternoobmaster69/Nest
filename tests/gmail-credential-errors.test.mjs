import assert from "node:assert/strict";
import test from "node:test";
import { GmailProviderError, openGmailCredential } from "../lib/gmail.ts";

test("an unreadable stored Gmail credential asks for reconnection", () => {
  const previousKey = process.env.INTEGRATION_ENCRYPTION_KEY;
  const previousVersion = process.env.INTEGRATION_ENCRYPTION_KEY_VERSION;
  process.env.INTEGRATION_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.INTEGRATION_ENCRYPTION_KEY_VERSION = "v1";

  try {
    assert.throws(
      () => openGmailCredential({
        integrationId: "integration-1",
        workspaceId: "workspace-1",
        field: "accessToken",
        value: "enc:v1:v1:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAA:AAAA",
      }),
      (error) => {
        assert.equal(error instanceof GmailProviderError, true);
        assert.equal(error.code, "GMAIL_RECONNECT_REQUIRED");
        assert.equal(error.retryable, false);
        assert.match(error.safeMessage, /Reconnect Gmail/);
        return true;
      },
    );
  } finally {
    if (previousKey === undefined) delete process.env.INTEGRATION_ENCRYPTION_KEY;
    else process.env.INTEGRATION_ENCRYPTION_KEY = previousKey;
    if (previousVersion === undefined) delete process.env.INTEGRATION_ENCRYPTION_KEY_VERSION;
    else process.env.INTEGRATION_ENCRYPTION_KEY_VERSION = previousVersion;
  }
});
