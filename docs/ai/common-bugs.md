---
title: AI Common Bugs
description: Symptom, likely cause, and safe fix direction for recurring Nest failure classes.
audience: [ai-assistants, engineers, operators]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# AI common bugs

## Purpose

Speed diagnosis while preventing unsafe fixes.

## Scope

Failure classes inferred from guards, tests, configuration, and architecture.

## Bug Map

| Symptom | Likely cause | Safe fix direction |
| --- | --- | --- |
| Private record returns `404` | Wrong workspace or deliberately concealed resource | Verify URL/header/membership; do not remove scope |
| Duplicate transaction/payment | Unstable/absent operation key | Reuse stable caller identity and posting service |
| Balance is off after correction | History edited instead of reversed | Reconstruct posting chain; add reversal |
| Passkey fails only on deployment | Origin/RP mismatch | Align canonical HTTPS config |
| OAuth callback loop | Callback URL differs from `NEXTAUTH_URL` | Align provider and deployment origins |
| Job executes twice | Lease overlap or non-idempotent handler | Repair claim/dedupe; preserve safe retry |
| Job never completes | Provider error or bounded slice needs continuation | Inspect job state; reschedule, do not loop unbounded |
| OpenAPI CI drift | Route registry changed without generation | Regenerate and review artifact |
| UI policy failure | Controller crossed exception ceiling | Extract behavior/view; lower or hold ceiling |
| Search grounding inactive | Only one feature gate enabled | Require both enable and evaluation-pass gates |
| Provider/public route is slow | Sequential provider calls or missing cap | Bound/batch with timeout; preserve minimal response |
| Build reports server module in client | `"use client"` import crosses boundary | Move server call behind route/server component |

## Unknowns

Production incident frequency and the statistically most common defects are **Unknown from source code.** This page lists plausible recurring classes, not incident history.

## Related Files

- [Troubleshooting](../troubleshooting/common-issues.md)
- [Pitfalls](pitfalls.md)
- [Debugging](../guides/debugging.md)

## Dependencies

- Sanitized runtime evidence and focused tests.

## Assumptions

- Diagnose before modifying behavior.

## Known Limitations

- Similar symptoms can have different root causes.

## Future Improvements

- Replace inferred frequency with incident-backed data.

## Last Updated

2026-07-28
