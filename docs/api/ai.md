---
title: Ask Nest and Smart Review API
description: Endpoint contracts for grounded answers, history, feedback, memory, and card-accounting suggestions.
audience: [engineers, API-consumers, ai-safety-reviewers, ai-assistants]
status: living
source_of_truth: false
last_updated: 2026-10-01
---

# Ask Nest and Smart Review API

## Purpose

Document AI request bounds, private response behavior, quality state, and the no-mutation boundary.

## Scope

Question, history, memory, feedback, and Smart Review routes require VIEWER workspace access. The transaction assistant requires EDITOR access. All return `private, no-store`. The client cannot specify a workspace in these bodies.

## Endpoints

| Operation | Request | Success example | Errors/limits |
| --- | --- | --- | --- |
| `POST /api/ai/ask` | question 2–600; page path≤120 matching safe path regex; ≤6 history messages (user≤600, assistant≤6,000), total≤19,800 | Structured `AskNestAnswer` with answer≤6,000 characters, highlights, evidence, optional visualization, turnId, and memory updates | Distributed 20/10 min plus short process limit; 400, 429, 502/503/504, grounded-response codes |
| `POST /api/ai/feedback` | turn≤1,000, HELPFUL with null reason or NOT_HELPFUL with one reason | `{"rating":"NOT_HELPFUL","reason":"WRONG_DATA"}` | 404 wrong user/workspace/expired turn |
| `GET /api/ai/history` | optional cursor≤1,000; limit 1–20 default 10 | `{"turns":[...],"nextCursor":null}` | Malformed stored JSON is skipped |
| `DELETE /api/ai/history` | No body | 204 | Archives usage before raw deletion |
| `GET /api/ai/memory` | No input | `{"memories":[...]}` | Max 100 active scoped memories |
| `PATCH /api/ai/memory` | ID≤1,000, safe content 3–240 | `{"memory":{"id":"...","content":"..."}}` | Content safety validation; 404 scope/status |
| `DELETE /api/ai/memory` | optional `id` query; absent deletes all scoped memories | `{"deleted":2}` | User/workspace owner hash enforced |
| `POST /api/ai/smart-review` | 1–250 transaction IDs, each≤180 | Suggestions with fingerprint/generated time and concrete actions | 10/10 min; only visible unaccounted rows reviewed |

Feedback reasons: `WRONG_DATA`, `MISUNDERSTOOD`, `MISSING_DETAIL`, `NO_RESULTS`, `OTHER`.

## Administrator agent management

These application-wide routes require an authenticated session whose email matches server-side `ADMIN`, independently of workspace role. They use private/no-store responses and same-origin mutation checks. Mutations are limited to 100 per ten minutes per administrator; evaluation and training submissions have a separate limit of ten. Supported agent IDs are `ask-nest`, `transaction-assistant`, and `smart-review`.

| Operation | Request | Success |
| --- | --- | --- |
| `GET /api/admin/agents` | None | Registered configurations, example counts, provider presence/default model |
| `GET /api/admin/agents/{agentId}` | Agent ID | Configuration, examples, latest ten revisions/evaluations/jobs |
| `PATCH /api/admin/agents/{agentId}` | Complete settings plus current `revision` | Updated configuration and revision |
| `POST /api/admin/agents/{agentId}/examples` | `title`, `input`, `expectedOutput`, `contextJson`, `purpose`, `status`, `matchMode` | `201` saved example |
| `PUT /api/admin/agents/{agentId}/examples/{exampleId}` | Same example fields plus example `revision` | Updated example |
| `DELETE /api/admin/agents/{agentId}/examples/{exampleId}` | JSON body with example `revision` | `204` |
| `GET /api/admin/agents/{agentId}/dataset` | Optional `purpose=TRAINING` or `EVALUATION` | Download of approved, complete JSONL examples |
| `POST /api/admin/agents/{agentId}/evaluations` | UUID `requestId`, agent `revision`, one to five approved `exampleIds` | Persisted evaluation results; same request ID replays the run |
| `POST /api/admin/agents/{agentId}/fine-tuning` | UUID `requestId`, agent `revision`, `baseModel`, `trainingType`, optional `epochs` | Persisted Azure job/submission status |
| `POST /api/admin/agents/{agentId}/fine-tuning/{jobId}` | `action`: `refresh` or `cancel` | Updated job status |

Validation and bounds are defined in `lib/ai/agent-contracts.ts` and generated OpenAPI. Common errors are `401` (session), `403` (administrator/origin), `409` (stale revision, request-ID conflict, or active job), `422` (unsupported capability or incomplete dataset), `429` (rate limit), `502` (provider), and `503` (provider or database migration not ready). Runtime AI routes also return `403` when an agent is paused or its requested operation is disabled.

Configuration contains `enabled`, `instructions`, nullable `deployment`, `reasoningEffort`, `maxOutputTokens`, `maxToolRounds`, `maxToolCalls`, `trainingExampleLimit`, and capability IDs. Revisions advance for both configuration and example changes. Fine-tuning base models are provider model IDs; runtime model overrides are Azure deployment names. See [Agent administration](../modules/agents.md) for fixture formats, evaluation scope, export restrictions, and deployment handoff.

## Example: Ask Nest

`GET/POST /api/ai/transactions` provides revisioned transaction drafts and explicit confirmation. See the [transaction assistant API and interaction contract](../modules/transaction-agent.md). Financial writes occur only through its separate `confirm` action, which accepts a persisted draft ID and revision.

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

For CIO questions, deterministic routing may select `get_cio_overview`, `get_cio_policy_status`, `run_cio_retirement_projection`, or `compare_cio_contribution_scenarios`. Those tools accept no workspace override, return an `asOfDate`, assumptions, warnings, and evidence, and never expose configuration writes or trading actions.

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
- [`lib/ai/ask-nest-contracts.ts`](../../lib/ai/ask-nest-contracts.ts)
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

2026-10-01
