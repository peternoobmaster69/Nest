import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateAnnualInvestmentContributions,
  compareInvestmentEntries,
  getLatestInvestmentEntry,
} from "../lib/investment-entry-order.ts";

const entry = (id, date, createdAt) => ({ id, date, createdAt });

test("latest investment snapshot uses creation order for entries on the same date", () => {
  const first = entry("first", "2026-07-23T00:00:00.000Z", "2026-07-23T02:00:00.000Z");
  const second = entry("second", "2026-07-23T00:00:00.000Z", "2026-07-23T04:00:00.000Z");

  assert.equal(getLatestInvestmentEntry([second, first]), second);
  assert.deepEqual([second, first].sort(compareInvestmentEntries), [first, second]);
});

test("snapshot date takes precedence over creation time", () => {
  const olderSnapshot = entry("older", "2026-07-22T00:00:00.000Z", "2026-07-23T10:00:00.000Z");
  const newerSnapshot = entry("newer", "2026-07-23T00:00:00.000Z", "2026-07-23T01:00:00.000Z");

  assert.equal(getLatestInvestmentEntry([olderSnapshot, newerSnapshot]), newerSnapshot);
});

test("snapshot ordering has a deterministic id fallback", () => {
  const first = entry("a", "2026-07-23T00:00:00.000Z", "2026-07-23T02:00:00.000Z");
  const second = entry("b", "2026-07-23T00:00:00.000Z", "2026-07-23T02:00:00.000Z");

  assert.equal(getLatestInvestmentEntry([second, first]), second);
});

test("annual contributions combine positive invested increases across accounts", () => {
  const accounts = [
    {
      inceptionDate: "2024-01-01T00:00:00.000Z",
      entries: [
        { ...entry("a-2026", "2026-04-01T00:00:00.000Z", "2026-04-01T01:00:00.000Z"), investedCents: 18_000 },
        { ...entry("a-2024", "2024-02-01T00:00:00.000Z", "2024-02-01T01:00:00.000Z"), investedCents: 10_000 },
        { ...entry("a-2025", "2025-03-01T00:00:00.000Z", "2025-03-01T01:00:00.000Z"), investedCents: 15_000 },
      ],
    },
    {
      inceptionDate: "2025-01-01T00:00:00.000Z",
      entries: [
        { ...entry("b-2025", "2025-06-01T00:00:00.000Z", "2025-06-01T01:00:00.000Z"), investedCents: 2_000 },
        { ...entry("b-2026", "2026-06-01T00:00:00.000Z", "2026-06-01T01:00:00.000Z"), investedCents: 3_500 },
      ],
    },
  ];

  assert.deepEqual(calculateAnnualInvestmentContributions(accounts), [
    { year: 2026, contributedCents: 4_500 },
    { year: 2025, contributedCents: 7_000 },
    { year: 2024, contributedCents: 10_000 },
  ]);
});

test("annual contributions use the net invested change within each year", () => {
  const accounts = [{
    inceptionDate: "2025-01-01T00:00:00.000Z",
    entries: [
      { ...entry("initial", "2025-01-01T00:00:00.000Z"), investedCents: 10_000 },
      { ...entry("reduction", "2026-01-01T00:00:00.000Z"), investedCents: 8_000 },
    ],
  }];

  assert.deepEqual(calculateAnnualInvestmentContributions(accounts), [
    { year: 2026, contributedCents: -2_000 },
    { year: 2025, contributedCents: 10_000 },
  ]);
});

test("an account's first snapshot is attributed to its first recorded year", () => {
  const accounts = [{
    inceptionDate: "2022-02-23T00:00:00.000Z",
    entries: [
      { ...entry("baseline", "2026-03-01T00:00:00.000Z"), investedCents: 33_350 },
      { ...entry("latest", "2026-08-11T00:00:00.000Z"), investedCents: 36_650 },
    ],
  }];

  assert.deepEqual(calculateAnnualInvestmentContributions(accounts), [
    { year: 2026, contributedCents: 36_650 },
  ]);
});

test("accounts first recorded in later years follow the graph and reconcile to total invested", () => {
  const accounts = [
    {
      inceptionDate: "2021-01-01T00:00:00.000Z",
      entries: [
        { ...entry("a-2021", "2021-01-01T00:00:00.000Z"), investedCents: 10_000 },
        { ...entry("a-2022", "2022-01-01T00:00:00.000Z"), investedCents: 20_000 },
      ],
    },
    {
      inceptionDate: "2020-01-01T00:00:00.000Z",
      entries: [{ ...entry("b-2022", "2022-06-01T00:00:00.000Z"), investedCents: 5_000 }],
    },
  ];

  const annual = calculateAnnualInvestmentContributions(accounts);
  assert.deepEqual(annual, [
    { year: 2022, contributedCents: 15_000 },
    { year: 2021, contributedCents: 10_000 },
  ]);
  assert.equal(annual.reduce((sum, row) => sum + row.contributedCents, 0), 25_000);
});

test("same-year reductions offset later top-ups instead of inflating contributions", () => {
  const accounts = [{
    inceptionDate: "2023-04-30T00:00:00.000Z",
    entries: [
      { ...entry("baseline", "2026-03-09T00:00:00.000Z"), investedCents: 1_750 },
      { ...entry("reduction", "2026-04-03T00:00:00.000Z"), investedCents: 750 },
      { ...entry("top-up", "2026-06-11T00:00:00.000Z"), investedCents: 31_750 },
      { ...entry("latest", "2026-08-11T00:00:00.000Z"), investedCents: 30_250 },
    ],
  }];

  assert.deepEqual(calculateAnnualInvestmentContributions(accounts), [
    { year: 2026, contributedCents: 30_250 },
  ]);
});

test("YTD contribution calculations exclude future-dated snapshots", () => {
  const accounts = [{
    inceptionDate: "2026-01-01T00:00:00.000Z",
    entries: [
      { ...entry("past", "2026-04-01T00:00:00.000Z"), investedCents: 10_000 },
      { ...entry("future", "2026-12-01T00:00:00.000Z"), investedCents: 15_000 },
    ],
  }];

  assert.deepEqual(
    calculateAnnualInvestmentContributions(accounts, "2026-08-14T00:00:00.000Z"),
    [{ year: 2026, contributedCents: 10_000 }],
  );
});
