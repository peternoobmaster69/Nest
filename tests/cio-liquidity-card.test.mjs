import assert from "node:assert/strict";
import test from "node:test";

import { liquidityRunwayDescription } from "../components/cio/cio-liquidity-card.tsx";

test("CIO liquidity copy distinguishes missing, zero, and positive essential spending", () => {
  assert.equal(
    liquidityRunwayDescription(null, null),
    "Set essential monthly spending to calculate emergency runway.",
  );
  assert.equal(
    liquidityRunwayDescription(0, null),
    "Essential monthly spending is set to zero; emergency runway does not apply.",
  );
  assert.equal(
    liquidityRunwayDescription(4_000, 6.25),
    "6.3 months of essential spending is readily available.",
  );
});
