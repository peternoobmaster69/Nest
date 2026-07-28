---
title: Ask Nest and Smart Review API
description: Endpoint contracts for grounded answers, history, feedback, memory, and card-accounting suggestions.
audience: [engineers, API-consumers, ai-safety-reviewers, ai-assistants]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# Ask Nest and Smart Review API

## Purpose

Document AI request bounds, private response behavior, quality state, and the no-mutation boundary.

## Scope

All routes require VIEWER workspace access and return `private, no-store`. The client cannot specify a workspace in these bodies.

## Endpoints

| Operation | Request | Success example | Errors/limits |
| --- | --- | --- | --- |
| `POST /api/ai/ask` | question 2–600; page path≤120 matching safe path regex; ≤6 history messages, each≤1,600 and total≤6,000 | Structured `AskNestAnswer` with summary/sections/evidence/optional visualization/turnId/memory updates | Distributed 20/10 min plus short process limit; 400, 429, 502/503/504, grounded-response codes |
| `POST /api/ai/feedback` | turn≤1,000, HELPFUL with null reason or NOT_HELPFUL with one reason | `{"rating":"NOT_HELPFUL","reason":"WRONG_DATA"}` | 404 wrong user/workspace/expired turn |
| `GET /api/ai/history` | optional cursor≤1,000; limit 1–20 default 10 | `{"turns":[...],"nextCursor":null}` | Malformed stored JSON is skipped |
| `DELETE /api/ai/history` | No body | 204 | Archives usage before raw deletion |
| `GET /api/ai/memory` | No input | `{"memories":[...]}` | Max 100 active scoped memories |
| `PATCH /api/ai/memory` | ID≤1,000, safe content 3–240 | `{"memory":{"id":"...","content":"..."}}` | Content safety validation; 404 scope/status |
| `DELETE /api/ai/memory` | optional `id` query; absent deletes all scoped memories | `{"deleted":2}` | User/workspace owner hash enforced |
| `POST /api/ai/smart-review` | 1–250 transaction IDs, each≤180 | Suggestions with fingerprint/generated time and concrete actions | 10/10 min; only visible unaccounted rows reviewed |

Feedback reasons: `WRONG_DATA`, `MISUNDERSTOOD`, `MISSING_DETAIL`, `NO_RESULTS`, `OTHER`.

## Example: Ask Nest

```http
POST /api/ai/ask
Content-Type: application/json
X-Workspace-Id: ws_123

{"question":"How much did I spend on transport this month?","pagePath":"/transactions","history":[]}
```

```json
{
  "turnId":"turn_1",
  "summary":"You spent $120.00 on confirmed transport transactions this month.",
  "sections":[...],
  "evidence":[{"label":"Transactions","href":"/transactions?..."}]
}
```

The exact structured answer union is in `lib/ai/ask-nest-types.ts`.

## Example: approve Smart Review safely

Smart Review itself does not mutate:

```http
POST /api/ai/smart-review
Content-Type: application/json

{"transactionIds":["cctx_1"]}
```

The UI sends the returned fingerprint/time and chosen action to `POST /api/credit-transactions/{id}/accounting`. That route recomputes the fingerprint and rejects stale suggestions.

## Provider failure codes

Ask route distinguishes:

- `AI_INVALID_REQUEST`
- `AI_UNAUTHORIZED`
- `AI_NOT_CONFIGURED`
- `AI_AUTH_FAILED`
- `AI_RATE_LIMITED` / `AI_PROVIDER_RATE_LIMITED`
- `AI_TIMEOUT`
- `AI_UNAVAILABLE`
- `AI_PROVIDER_ERROR`
- response grounding/incomplete codes from `AskNestResponseError`
- `AI_INTERNAL_ERROR`

## Security

- No mutation tool.
- No body workspace override.
- Memory is not a source for finance totals.
- Tool results/evidence ground money values.
- External search/news has additional privacy gates.

## Related Files

- [`lib/ai/ask-nest-types.ts`](../../lib/ai/ask-nest-types.ts)
- [`lib/ai/ask-nest.ts`](../../lib/ai/ask-nest.ts)
- [AI module](../modules/ai.md)

## Dependencies

- Azure OpenAI; optional Azure AI Search/Massive/SerpApi; Azure SQL.

## Assumptions

- Examples summarize the stable response intent, not every optional visualization shape.

## Known Limitations

- Model/provider latency and exact generated prose are nondeterministic.

## Future Improvements

- Generate response unions and tool result schemas into OpenAPI.

## Last Updated

2026-07-28
