---
title: Agent Administration
description: Registered agents, runtime configuration, curated training, evaluations, and Azure fine-tuning.
audience: [administrators, engineers, ai-assistants]
status: living
source_of_truth: false
last_updated: 2026-10-01
---

# Agent administration

## Access and registration

Open **Admin → Agents** at `/admin/agents` or `/w/{workspaceId}/admin/agents`. The server checks the signed-in email against `ADMIN`; workspace ownership alone does not grant access. Settings and curated examples apply across the application, so use synthetic or anonymized examples suitable for every workspace.

The registry in `lib/ai/agent-catalog.ts` describes the three implemented model-backed agents:

| Agent | Capabilities | Required protections |
| --- | --- | --- |
| Ask Nest | Financial queries, budgets, cards, receivables, investments/CIO, market research, knowledge, preferences | Scoped read tools and financial grounding |
| Transaction assistant | New transaction drafts, corrections, account suggestions | Explicit editor confirmation; validated, idempotent ledger postings |
| Smart Review | Merchant names, accounting and reimbursement suggestions, rule suggestions | Review before accounting; existing duplicate/reversal checks |

Registering another executable agent or a new tool requires code changes. An administrator can configure the registered implementations, but cannot create arbitrary executable tools through this page.

## Configuration

Administrators can pause each agent, edit its instructions, select an Azure deployment, set supported reasoning effort and response limits, choose its capabilities, and control how many demonstrations accompany a request. Ask Nest also exposes tool-round and tool-call limits; its defaults are eight rounds, sixteen calls, and 4,000 output tokens.

Application rules follow administrator instructions and demonstrations in the prompt. Capability checks also run in code: Ask Nest filters tool definitions and dispatches, transaction confirmation rechecks creation/correction permission, and Smart Review removes disallowed recommendations. Pausing stops new requests and transaction confirmations; cancellation and replay of an already-saved receipt remain available. In-flight requests retain their starting configuration.

Settings use optimistic revisions and an audit history. Example creation, editing, or deletion also advances the agent revision. Stale saves return `409`. The browser preserves unsaved settings while switching agents or sections; loading saved settings discards those local edits. Loading an earlier history entry only populates the editor until the administrator saves it.

## Teaching with examples

An example contains a title, user input, expected output, JSON context, purpose (`TRAINING` or `EVALUATION`), approval state, and an expectation check.

- Approved training examples guide requests immediately through bounded, relevance-ranked demonstrations; this does not change model weights.
- Drafts are inactive. Evaluation examples are excluded from demonstrations.
- At most 250 examples are stored per agent. Normalized input plus context is unique, preventing the same case from being assigned to both purposes.
- Per-request demonstrations are limited to eight examples and 16,000 characters in total. Their data is explicitly marked as illustrative rather than current workspace facts.

For transaction examples, context may include `currency`, `previousIntent`, `assistantWasAskingFor`, `conversation`, `selectedTransaction`, `lastSaved`, `accountNames`, and `bankNames`. The latest user message always comes from the example's input. For example:

```json
{"currency":"SGD","accountNames":["Transit","Food"],"bankNames":["Sample Bank"]}
```

For Smart Review, provide the synthetic transactions and available candidate keys:

```json
{
  "transactions": [{"transactionId":"sample","subject":"Bus fare"}],
  "candidates": [{"key":"BUDGET:transit","label":"Sample Bank / Transit"}]
}
```

Ask Nest uses `currency` and `toolResults`, keyed by registered tool name. Supply a complete synthetic result in the same shape as the relevant tool:

```json
{
  "currency": "SGD",
  "toolResults": {
    "get_financial_snapshot": {"ok":false,"error":"No sample records available."}
  }
}
```

Missing fixtures produce an unavailable-data result. The current fixture runner matches by tool name, so repeated calls to one tool reuse its fixture regardless of arguments. Use distinct cases to evaluate different periods or account contexts.

## Evaluations

Choose up to five approved evaluation cases and run them against the saved configuration. Two cases run concurrently with a shared 120-second provider deadline. The runner uses real prompts, schemas, model settings, and capability restrictions, but never executes workspace tools or posts transactions.

Text checks compare normalized answer text; JSON field checks compare a non-empty subset; exact checks compare all JSON fields or exact plain text. Example expectation for a transaction JSON field check:

```json
{"operation":"CREATE","direction":"DEBIT","amount":"10","accountQuery":"Transit"}
```

Results show actual and expected outputs, tools requested, timings, configuration revision, and dataset hash. Copy the complete output when building a structured training example. The check measures only the supplied assertion, not overall quality or end-to-end grounding and accounting behavior. Run the same held-out cases before and after changing instructions or deployments. Live provider calls incur provider usage.

Evaluation submission uses a stable request ID. A retry retrieves the same run. Runs still marked running after three minutes are displayed as interrupted; starting a new run uses a new ID.

## Azure fine-tuning

1. Approve at least ten distinct training examples with complete outputs that pass the agent's response schema. A partial assertion suitable for evaluation is insufficient.
2. Export JSONL for inspection or enter a fine-tuning base model ID, training type, and epoch count, then start training. Nest uploads approved training examples and separately uploads complete evaluation responses as validation data to the configured Azure resource.
3. Refresh or cancel the job from the page. Starting a job incurs Azure charges and depends on that resource's supported models, region, permissions, and quota.
4. After success, deploy the returned fine-tuned model in Azure, enter that **deployment name** under Configuration, and rerun the evaluation cases before relying on it.

Ask Nest JSONL exports currently support responses without tool evidence. Examples containing `toolResults` or evidence identifiers are rejected rather than exported without their financial grounding; they remain usable as demonstrations and evaluation fixtures. Transaction and Smart Review exports include their supplied context.

Provider submissions disable automatic retries. Only one nonterminal fine-tuning job may exist per agent. An ambiguous submission failure is recorded as `UNKNOWN`; refresh attempts to reconcile it using the uploaded training file rather than creating another job. Jobs are tied to the Azure resource used to create them. A model's provider success status never automatically activates it in Nest.

See the [Azure fine-tuning guide](https://learn.microsoft.com/azure/ai-foundry/openai/how-to/fine-tuning?view=foundry-classic) for provider availability and deployment requirements.

## Persistence and deployment

Apply `20261001000000_admin_agents` using `npm run prisma:migrate:deploy`, then regenerate the Prisma client and restart the application. The additive SQL Server migration creates `AiAgentConfig`, `AiAgentRevision`, `AiAgentExample`, `AiAgentEvaluation`, and `AiAgentFineTuneJob`, with indexes and JSON/state/limit constraints. Registry defaults require no seed records.

`AI_WORKLOAD_ENDPOINT`, `AI_WORKLOAD_API_KEY`, and `AI_WORKLOAD_MODEL` remain server-only provider settings. The page returns connection presence and deployment names, never credentials. These are independent of the VS Code extension's `GOVTECH_MODELS_API_KEY`.

## Code and verification

- `lib/ai/agent-{catalog,contracts,policy,runtime,store}.ts`: registry, boundaries, runtime loading, revisions and examples.
- `lib/ai/agent-{training,fine-tuning,admin-api}.ts`: isolated evaluation, export/provider jobs, authorization and rate limits.
- `components/admin-agents/`: configuration, examples, evaluations, and jobs.
- `tests/admin-agents.test.mjs` and `tests/transaction-agent-workflow.test.mjs`: isolated database/provider tests, revision conflicts, training separation, capability enforcement, and retry handling.
- [AI API](../api/ai.md): admin endpoint contracts.
