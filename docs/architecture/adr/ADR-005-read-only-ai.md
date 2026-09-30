---
title: "ADR-005: Read-Only Grounded AI"
description: Decision to constrain Ask Nest and Smart Review to bounded read/evidence workflows without mutation tools.
audience: [engineers, product-reviewers, security-reviewers, ai-assistants]
status: accepted
source_of_truth: true
last_updated: 2026-07-28
---

# ADR-005: Read-only grounded AI

## Purpose

Prevent model capability changes from silently becoming autonomous finance actions.

## Scope

Ask Nest, Smart Review, market/news/search retrieval, history, memory, and evaluation.

## Context

Models can produce useful summaries and suggestions but can also hallucinate values, choose the wrong tenant/entity, or expose private query context to public providers.

## Problem

Users need assistance without delegating financial writes or treating model prose as accounting truth.

## Constraints

- Structured data in Azure SQL is authoritative.
- Third-party content is untrusted.
- Tool calls must be bounded and workspace-scoped.
- Financial recommendations must not become buy/sell/hold advice.

## Options considered

- Model with mutation tools: rejected by current contracts.
- Model-only answer from prompt context: rejected for financial totals.
- Deterministic intent plus read tools, evidence, structured output, and grounding: implemented.

## Decision

Expose only bounded read tools. Derive values from scoped queries, require structured answers, ground displayed currency in tool output, and return evidence. Smart Review produces suggestions; existing accounting routes perform approved writes after freshness/fingerprint checks.

## Consequences

September 2026 extension: the [transaction assistant](../../modules/transaction-agent.md) extracts structured drafts without mutation tools. Users approve a concrete review with a dedicated confirmation button. A deterministic EDITOR-only endpoint revalidates the persisted draft and posts through the existing ledger service. This extends the Smart Review pattern to ordinary transaction creation and correction; model messages and tool calls still cannot execute financial writes.

- Users must explicitly approve actions in normal UI workflows.
- Prompt/tool changes require golden evaluation and contract tests.
- Model outages degrade the feature, not finance integrity.
- Search/news/market inputs have separate privacy and advice boundaries.

## Risks

- A grounded response can still explain an incomplete dataset.
- Model/provider logs are outside repository control.
- Oversized tool surface increases latency and maintenance cost.

## Alternatives

Local models or retrieval architectures beyond the current optional Azure AI Search path are unknown from source code.

## Future Improvements

- Expand adversarial/privacy evaluation and per-tool quality metrics.
- Split the large tool implementation into domain-specific read services.

## Related Files

- [`lib/ai/ask-nest.ts`](../../../lib/ai/ask-nest.ts)
- [`lib/ai/ask-nest-tools.ts`](../../../lib/ai/ask-nest-tools.ts)
- [`evals/ask-nest/golden.json`](../../../evals/ask-nest/golden.json)
- [`tests/ask-nest-contract.test.mjs`](../../../tests/ask-nest-contract.test.mjs)

## Dependencies

- Azure OpenAI, optional search/market/news providers, and SQL reads.

## Assumptions

- AI output is explanatory assistance, not an authoritative financial record.

## Known Limitations

- The repository does not contain a formal model risk-management policy.

## Last Updated

2026-07-28
