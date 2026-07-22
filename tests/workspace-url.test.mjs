import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWorkspacePath,
  getWorkspaceIdFromPathname,
  getWorkspaceRelativePath,
} from "../lib/workspace-entry.ts";

test("workspace paths preserve page state while changing only the workspace segment", () => {
  assert.equal(buildWorkspacePath("workspace-a"), "/w/workspace-a");
  assert.equal(
    buildWorkspacePath("workspace-b", "/transactions?month=7#recent"),
    "/w/workspace-b/transactions?month=7#recent",
  );
  assert.equal(
    buildWorkspacePath("workspace-b", "/w/workspace-a/credit-cards?add=1"),
    "/w/workspace-b/credit-cards?add=1",
  );
});

test("workspace path parsing is bounded to the canonical route prefix", () => {
  assert.equal(getWorkspaceIdFromPathname("/w/workspace-a/transactions"), "workspace-a");
  assert.equal(getWorkspaceIdFromPathname("/transactions"), null);
  assert.equal(getWorkspaceRelativePath("/w/workspace-a"), "/");
  assert.equal(getWorkspaceRelativePath("/w/workspace-a/settings"), "/settings");
});
