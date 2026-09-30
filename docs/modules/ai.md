---
title: Ask Nest and Smart Review Module
description: AI intent, bounded read tools, grounding, memory/history, quality telemetry, provider retrieval, and suggestion safety.
audience: [ai-engineers, backend-engineers, security-reviewers, ai-assistants]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# Ask Nest and Smart Review

## Purpose

Provide useful finance explanations and accounting suggestions without granting a probabilistic model mutation authority.

## Scope

Ask Nest request/response, deterministic intent/category/entity logic, 18+ read tools, history, explicit memory, usage/feedback, Smart Review, Azure OpenAI, Azure AI Search, Massive, and SerpApi.

## Responsibilities

- Classify question intent and planning hint deterministically.
- Expose bounded workspace/user-scoped read tools.
- Resolve accounts/envelopes/cards deterministically.
- Classify spending independently of user sub-account names.
- Validate structured answers and ground displayed money by numerical value, allowing equivalent formatting and clearly labelled user-supplied scenario inputs.
- Retain bounded history, quality diagnostics, feedback, and daily usage summaries.
- Store only explicit safe memory; never use memory as finance truth.
- Generate card suggestions that require fresh normal-route approval.
- Keep public news queries private-data-free.

## Public APIs and important symbols

| File | Exported surface | Purpose |
| --- | --- | --- |
| `lib/ai/ask-nest.ts` | `answerAskNest`, result/error types | Responses API orchestration/grounding |
| `lib/ai/ask-nest-tools.ts` | tool schema/execution | Bounded finance read surface |
| `lib/ai/tools/cio-tools.ts` | CIO tool registry | Bounded reads over deterministic CIO services |
| `lib/ai/ask-nest-intent.mjs` | classify/hint | Deterministic routing |
| `lib/ai/entity-resolution.ts` | resolve/canonicalize helpers | Workspace entity matching |
| `lib/ai/transaction-categories.mjs` | category keys/labels/classifier | Deterministic spending rules |
| `lib/ai/memory.ts` | safe save/load helpers | Explicit scoped memory |
| `lib/ai/ask-nest-retention.ts` | archive/clear/retention | Usage-preserving deletion |
| `lib/ai/smart-review.ts` | review/fingerprint/freshness | Read-only card suggestions |
| `lib/ai/knowledge-search.ts` | gated hybrid search | Optional notes/documents |
| market/news clients | configured checks and bounded search/history | Public provider context |

## Ask Nest workflow

For transaction creation and correction, Ask Nest starts a [transaction draft](transaction-agent.md) inline in the same thread. The model extracts a draft only; an EDITOR must approve its current review through the confirmation endpoint. Existing question-answering tools remain read-only.

Question/history bounds → workspace rate limit → deterministic hint → Azure Responses call → tool-call loop → structured answer → evidence/visualization merge → value grounding → persist turn/usage/memory candidates → return.

History is at most six client-provided messages plus server persistence rules. Tool errors are converted to safe model-visible summaries.

## Key function contracts

### `answerAskNest`

- **Parameters:** question, page, bounded history, authenticated user/workspace context.
- **Returns:** structured answer, evidence, optional visualization, token/tool diagnostics.
- **Side effects:** external Azure calls; route persists result/usage.
- **Preconditions:** model config and validated input.
- **Postconditions:** answer schema valid; displayed financial values originate from tool output or a clearly labelled user scenario, otherwise a controlled repair/failure occurs.
- **Complexity:** O(number of tool rounds + tool query costs); external latency dominates.

### `executeAskNestTool`

- **Parameters:** tool name, unknown arguments, scoped context.
- **Returns:** structured result/evidence with bounded records.
- **Failures:** invalid arguments/entity ambiguity/provider unavailable.
- **Security:** no mutation operations and no caller-provided workspace override.

## Configuration

Required for Ask Nest: `AI_WORKLOAD_ENDPOINT`, `AI_WORKLOAD_API_KEY`, `AI_WORKLOAD_MODEL`. Optional pricing, history retention, search gates/config, Massive, and SerpApi settings are documented in `.env.example`.

The platform administrator can configure Ask Nest, the transaction assistant, and Smart Review in [Admin → Agents](agents.md). Saved settings control pause state, capabilities, instructions, deployment, reasoning effort, output limits, and approved demonstrations. Ask Nest defaults to eight lookup rounds and sixteen tool calls. Configuration is revisioned; core grounding and financial-confirmation checks remain enforced in code.

## Error handling

Stable failure categories distinguish configuration, invalid request, rate limit, upstream, incomplete/ungrounded, and persistence problems. Provider details/keys are redacted.

## Performance considerations

- `ask-nest-tools.ts` is ~2,867 lines and can issue several bounded queries per answer.
- External round trips dominate latency and cost.
- Market/news use one-hour durable cache.
- History/diagnostic content is bounded and retained.

## Security considerations

- Keys remain server-side.
- Model never receives database credentials or mutation functions.
- Every SQL query is scoped by context.
- Knowledge search includes workspace/user filter.
- News search must not receive private account/card/transaction terms or values.
- Output is assistance, not financial advice.

## Risks

- Tool proliferation and a large prompt surface.
- User may over-trust a valid but incomplete summary.
- Provider retention is outside repository control.
- New model/deployment can change behavior despite unchanged code.

## Future extension points

- Split tools by domain behind a stable registry.
- Expand privacy/adversarial/golden evaluation.
- Add per-tool latency, empty-result, and grounded-answer dashboards.

## Related Files

- [AI API](../api/ai.md)
- [ADR-005](../architecture/adr/ADR-005-read-only-ai.md)
- [`evals/ask-nest/golden.json`](../../evals/ask-nest/golden.json)

## Dependencies

- Azure OpenAI, Azure SQL, optional search/market/news providers.

## Assumptions

- The configured model supports Responses API, tools, and structured output.

## Known Limitations

- No formal model card, provider retention policy, or offline fallback.

## Future Improvements

- Add a checked-in model/prompt change log and evaluation trend.

## Last Updated

2026-07-28
