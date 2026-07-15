# Nest Intelligence

> A product and experience proposal for adding useful, calm, and trustworthy AI to Nest with Microsoft Foundry.

**Status:** Ask Nest MVP implemented; controlled rollout and evaluation remain

**Last updated:** 15 July 2026

**Scope:** Personal finance assistance inside the existing Nest experience; not financial advice and not autonomous money movement.

## Recommendation

Nest should add an **intelligence layer**, not an AI destination.

The best first release is the contextual, read-only **Ask Nest** experience. It provides immediate value without giving a model authority to change financial records, and its workspace-scoped tool layer establishes the evidence and evaluation contracts needed by later AI features.

Implementation decision (15 July 2026): use this order:

1. **Ask Nest** — contextual, read-only questions answered with supporting figures and links to the records used.
2. **Smart Review** — suggestions for unallocated credit-card transactions, with one-tap approval and clear reasons.
3. **Money Brief** — at most three timely observations on the dashboard, built from verified calculations.
4. **Document Capture** — assisted import of statements and receipts through a review-before-posting flow.
5. **Budget Scenarios** — translate a user’s intent into a draft scenario, then run the numbers in deterministic code.

Do not begin with a blank chat box. It creates a broad promise before Nest has the evidence, permission, and evaluation systems needed to keep that promise.

## The product boundary

Nest already has strong deterministic foundations: a posting ledger, idempotent mutations, reconciliation, card-alert ingestion, subject-match auto-accounting rules, monthly budget plans, payment reminders, and workspace audit logs. AI should sit above those foundations and help with language, ambiguity, and explanation.

| Let AI help with | Keep deterministic |
| --- | --- |
| Merchant normalization | Balances and totals |
| Categorization suggestions | Statement and payment dates |
| Summarizing verified changes | Reconciliation and duplicate checks |
| Turning plain language into query or scenario parameters | Currency conversion arithmetic |
| Explaining a result in plain language | Permissions, posting, reversals, and idempotency |
| Extracting candidate fields from varied documents | Final import validation and writes |

The model may describe a calculation, but it must never perform the authoritative calculation. Every amount shown to the user must originate from Nest code or a typed, workspace-scoped tool response.

## Experience principles

### 1. Useful before impressive

Every AI element must save time, reduce uncertainty, or help the user make sense of their own data. If a normal filter, calculation, or rule solves the problem more reliably, use that instead.

### 2. Contextual, not ambient

Place assistance beside the task it helps. Use “Suggest allocation” in a transaction row, “Explain this change” near a chart, and “Ask about this page” in the page header. Avoid a floating assistant bubble that follows the user through the app.

### 3. Facts before prose

Show the amount, date range, account, and comparison first. The generated explanation is secondary. Every insight should expose “Why am I seeing this?” and link to the underlying records.

### 4. Suggestions are visibly suggestions

Use the labels **Suggested**, **Strong match**, and **Needs review**. Do not use fake precision such as “93% confident” unless confidence has been calibrated against Nest’s own evaluation data.

### 5. Calm financial language

Use neutral wording: “Dining is SGD 84 higher than your three-month average,” not “You overspent badly.” Avoid guilt, celebration confetti, urgency inflation, and unsolicited predictions about financial distress.

### 6. The user stays in control

AI may draft, explain, and recommend an in-product action. It may not post a transaction, transfer money, close a receivable, change a due date, or apply a budget without an explicit confirmation that shows the exact effect.

### 7. Easy to ignore and easy to undo

AI is opt-in at workspace level, dismissible per surface, and reversible where it creates configuration. A disabled AI feature must leave the rest of Nest fully usable.

## Priority opportunities

| Opportunity | User value | Delivery risk | Recommendation |
| --- | --- | --- | --- |
| Contextual, read-only Ask Nest | High | Medium | Build first; pilot with evaluations |
| Smart Review and rule suggestions | High | Low–medium | Build second on the evidence layer |
| Dashboard Money Brief | High | Low–medium | Build third |
| Statement and receipt capture | High | Medium | Pilot with a small set of formats |
| Natural-language budget scenarios | Medium | Medium | Add after the budget engine is stable |
| Rewards explanations | Medium | Low | Add as contextual explanations only |
| Investment or credit-product recommendations | Unclear | High | Exclude |
| Autonomous posting or money movement | Low trust | Very high | Exclude |

## 1. Smart Review

### User problem

Card alerts and imports capture the amount and merchant, but the user still has to decide how each transaction should be accounted for. Nest’s current rules use subject substring filters and are reliable once configured, but creating those rules requires manual pattern recognition.

### Proposed experience

Add a **Review suggestions** mode to Credit Card Transactions. For each unallocated transaction, Nest can suggest:

- a normalized merchant name;
- a source and destination sub-account from valid workspace choices;
- whether the transaction resembles a receivable rather than personal spending;
- an existing deterministic rule that matches the user’s intent;
- a possible duplicate or reversal for review.

Each suggestion contains four things: the proposed action, the evidence, the effect, and the controls.

```text
FAIRPRICE XTRA · SGD 62.40                         Strong match
Suggested: deduct from Groceries → Card repayment
Based on 8 approved FairPrice transactions in this workspace.

[Edit]                                      [Approve]
```

Approval still calls the existing accounting/posting service with its normal authorization, validation, idempotency key, audit record, and reversal behavior. The model never receives a write tool.

### Learning without hidden automation

After several consistent approvals, show a quiet follow-up:

> You have assigned FAIRPRICE to Groceries 5 times. Create a rule for future matches?

The result is an ordinary, inspectable `CreditTxnAutoRule`. AI helps author the rule; the existing deterministic rule engine executes it. A user can preview which recent transactions the proposed filter would have matched before saving it.

### Confidence behavior

- **Strong match:** may be preselected, but is never auto-submitted in the first release.
- **Needs review:** shows alternatives without a default selection.
- **No reliable match:** say so and fall back to the current manual flow.
- Suggestions expire whenever the transaction, budgets, account availability, rule set, or workspace role changes.

## 2. Money Brief

### User problem

The dashboard contains balances, discrepancies, budgets, due cards, recent transactions, and 12 months of cash flow. The user still has to scan those sections to answer “What needs my attention?”

### Proposed experience

Add one compact card below the dashboard heading. It contains no more than three items and is generated on demand or after material data changes—not on every page load.

```text
Money brief                                      Updated 2 min ago

Needs attention   DBS Visa has SGD 1,240 due in 4 days.       View
Notable change    Dining is SGD 84 above its 3-month average.  Review
Good to know      Two open receivables total SGD 310.          Open

How this was made                                      Refresh
```

The server first produces a typed `BriefFacts` object from SQL and domain services. The model may rank and phrase those facts, but it cannot introduce a number or claim not present in that object. Each item includes evidence keys that Nest resolves to a filtered page or record list.

### Editorial rules

- Show an existing reconciliation discrepancy before a discretionary spending observation.
- Show overdue and due-soon obligations before trend commentary.
- Do not repeat information already prominent on the screen unless the brief adds a useful comparison or action.
- Do not forecast insolvency, diagnose spending behavior, or prescribe an investment action.
- If there is nothing meaningful to say, render no card. “You are all caught up” is acceptable only when Nest can prove the relevant checks ran successfully.

## 3. Ask Nest

### User problem

Filters answer questions the product anticipated. Users also ask questions that cross screens, such as:

- “Why was my cash flow lower this month?”
- “How much did we spend on groceries in the last three months?”
- “Which card payments are due before payday?”
- “Show unallocated card transactions from Grab.”
- “What changed since last month’s budget?”

### Proposed experience

Use an **Ask about this page** action in `PageHeader`, plus a keyboard-accessible command entry. Open a right-side sheet on desktop and a full-height bottom sheet on mobile. Seed it with two or three page-specific example questions; do not present an empty, general-purpose chat home.

An answer has a stable structure:

1. **Direct answer** — one or two sentences.
2. **Supporting figures** — values returned by Nest tools, not calculated by the model.
3. **Scope** — workspace, date range, filters, currency, and data freshness.
4. **Evidence** — links such as “12 transactions” or “3 card statements.”
5. **Next action** — open a filtered view or draft a change; never silently apply it.

Conversation history is session-only by default. Persistent memory is out of scope until users have explicit controls to inspect and delete what is remembered.

### Tool design

Start with a small read-only toolbox instead of exposing the entire application API:

- `get_financial_snapshot(date_range)`
- `compare_spending(period_a, period_b, account_ids?, budget_ids?)`
- `find_transactions(query, date_range, account_ids?, budget_ids?, limit)`
- `find_card_transactions(query, date_range, card_ids?, allocation_status, limit)`
- `get_card_obligations(before_date?)`
- `get_receivables(status?, due_before?)`
- `get_budget_plan(year, month)`
- `explain_reconciliation(account_id)`

Every tool derives `workspaceId` and user identity from the authenticated server context. The model is never allowed to supply or override a workspace ID. Results are bounded, typed, and permission-filtered.

Do not give the agent mutation tools in the first release. If a later answer can draft a change, the response should contain a typed `draftAction` that the Next.js server validates and presents in Nest’s standard confirmation dialog before using the existing domain service.

## 4. Document Capture

### User problem

Nest currently supports Gmail card alerts and a Maybank CSV path. Other institutions, PDF statements, screenshots, and receipts still require manual entry or format-specific parsers.

### Proposed experience

Use Azure Document Intelligence for stable layouts and evaluate Azure Content Understanding for more varied statement formats. The output is always a **candidate import**, never a posting.

The review screen should show the original page beside extracted rows, highlight low-confidence fields, detect duplicates through Nest code, and require confirmation before import. Users can correct merchant, amount, date, card, and currency inline. Corrections may improve a format-specific extractor or evaluation set, but must not be used for training without explicit consent.

Treat all document text as untrusted data. Hidden instructions in PDFs, emails, or images must never become agent instructions; use prompt-injection defenses and keep extraction separate from any action-capable workflow.

## 5. Budget Scenarios

### User problem

A user may know the outcome they want—“free up SGD 250 per month” or “prepare for a SGD 1,800 trip in December”—without knowing how to translate it into budget-plan fields.

### Proposed experience

Allow plain language to produce a draft set of scenario parameters. Nest’s budget engine then calculates the monthly amount, remaining income, affected envelopes, and target date. The model may summarize trade-offs but must not alter the calculation.

Show the scenario beside the current plan, with changed rows emphasized and a clear **Apply to draft** action. Final monthly confirmation remains the existing explicit workflow.

## Microsoft Foundry service map

| Capability | Role in Nest | Design choice |
| --- | --- | --- |
| **Foundry Models / Azure OpenAI** | Classification, merchant normalization, constrained summaries, and natural-language interpretation | Use strict structured output and a pinned deployment; choose the smallest model that passes Nest evaluations |
| **Azure OpenAI Responses API** | Let Ask Nest choose among local, read-only finance tools | Keep the instructions and tool loop in the Next.js application; no managed agent resource is required for the MVP |
| **Foundry Agent Service** | Optional managed orchestration later | Consider only if the product needs managed publishing or Foundry-native tools beyond Nest's local toolbox |
| **Azure Document Intelligence** | Extract text, tables, fields, and confidence from statements or receipts | Prefer for predictable document processing; always show a human review step |
| **Azure Content Understanding** | Evaluate extraction from diverse, complex financial documents | Optional later pilot; do not make it an MVP dependency |
| **Azure AI Search** | Retrieve workspace notes or imported document passages with citations | Use only for unstructured content; query ledger facts from Azure SQL tools rather than vectorizing the ledger |
| **Azure Language PII** | Detect or redact sensitive free text before approved logging/evaluation workflows | Defense in depth, not permission to collect more data |
| **Prompt Shields / guardrails** | Detect hostile user or document instructions | Apply to question answering and document-grounded flows |
| **Foundry evaluation, tracing, and monitoring** | Measure groundedness, tool choice, task completion, latency, and regressions | Required before broad release; sanitize telemetry and sample sparingly |
| **Model router** | Potentially reduce cost and latency after quality is established | Do not use initially; a pinned model makes early behavior and evaluations easier to reproduce |

## Proposed architecture

```text
Nest UI
  │
  ▼
Next.js /api/ai/* (server only)
  │  authenticate user · resolve active workspace · enforce role · rate limit
  ▼
AI orchestration layer
  ├── deterministic context builders ──► Azure SQL/domain services
  ├── model adapter ────────────────────► Foundry model deployment
  ├── read-only tool adapter ───────────► Nest domain queries (Ask Nest)
  └── document adapter ─────────────────► Document Intelligence
  │
  ▼
Schema validation · evidence validation · policy checks · audit metadata
  │
  ▼
Suggestion or explanation in the UI
  │
  └── explicit user confirmation ───────► existing posting/domain service
```

### Start simple

Ask Nest, Smart Review, and Money Brief do not need a managed agent. Use the Azure OpenAI Responses API with narrow inputs, local function tools, and strict JSON Schema. Consider Agent Service later only if managed publishing or Foundry-native platform tools provide a concrete product benefit.

### Provider boundary

Create one internal interface so product code does not depend directly on a specific SDK:

```ts
type NestAi = {
  suggestTransaction(input: TransactionSuggestionInput): Promise<TransactionSuggestion>;
  composeBrief(input: BriefFacts): Promise<MoneyBrief>;
  ask(input: AskNestInput): Promise<AskNestAnswer>;
};
```

The adapter owns Foundry authentication, timeouts, retries, token budgets, deployment names, safety annotations, and telemetry. Tests can replace it with a deterministic fake.

### Output contract

Generated UI must come from validated structured output, not model-authored HTML or Markdown. A brief item should resemble:

```json
{
  "kind": "upcoming_obligation",
  "headline": "DBS Visa is due in 4 days",
  "body": "SGD 1,240 remains outstanding.",
  "evidenceKeys": ["card-obligation:card_123:2026-07"],
  "action": { "type": "open_card_statement", "cardId": "card_123" }
}
```

Nest must reject output when an evidence key or record ID was not in the input, the schema is invalid, the input fingerprint is stale, or the proposed action is not allowlisted. User-visible copy should fall back gracefully; financial data should never fall back to an unvalidated free-text response.

### Minimal persistence

Add an `AiSuggestion` record only when persistence is necessary for review and audit. Suggested fields:

- workspace and subject identifiers;
- suggestion type and validated JSON payload;
- evidence JSON and input fingerprint;
- confidence band, model deployment, and prompt version;
- status: pending, approved, edited, rejected, expired;
- creator/decision actor and timestamps;
- expiry time and sanitized failure code.

Add workspace AI preferences for enabled features, document processing, brief cadence, and retention. Do not store raw prompts, completions, document text, or conversation history by default.

## Privacy, security, and financial safety

AI should not ship before the relevant access-control and data-protection work in `plan.md` is complete. In particular, Nest needs a reliable OWNER/EDITOR/VIEWER permission matrix, encrypted long-lived Gmail credentials, secure production configuration, durable background jobs, and sanitized observability.

The implementation rules are:

- Call Foundry only from server code. Never expose model credentials or project endpoints to the browser.
- Use Microsoft Entra managed identity and least-privilege RBAC instead of long-lived API keys where supported.
- Never send PAN, CVV, authentication tokens, cookies, Gmail tokens, or raw credential material to a model. Send card last four only when the task genuinely needs it.
- Minimize inputs to the requested workspace, date range, and fields. Notes and raw email bodies are excluded by default.
- Keep every SQL query and agent tool workspace-scoped in code. Never rely on a prompt instruction for tenant isolation.
- Keep agents read-only. All writes go through validated Nest services after explicit user confirmation.
- Use `Cache-Control: no-store` on AI endpoints and exclude AI responses from the service worker cache.
- Redact or hash sensitive values in traces. Store prompt/completion bodies only in an explicit, time-limited diagnostic mode with owner approval.
- Configure data residency and deployment type deliberately. Verify regional availability, quota, retention, and preview status before choosing a model or tool.
- Apply prompt-injection protection to user questions and retrieved documents. Treat tool output, emails, notes, and documents as data, not instructions.
- Show the data scope and freshness in every answer. Never imply access to accounts or institutions Nest has not connected.
- Do not provide tax, legal, investment, lending, or credit-product advice. Explain the user’s recorded data and let them model scenarios.
- Record AI-assisted approvals in the workspace audit trail without storing unnecessary model input.
- Provide a workspace-level kill switch and a user-facing way to clear AI suggestions and session history.

Microsoft states that prompts, completions, embeddings, and training data sent to Azure Direct Models are not made available to other customers or model providers and are not used to train foundation models without permission. That platform guarantee does not replace Nest’s own consent, minimization, retention, and authorization responsibilities.

## Visual and interaction design

AI should look native to Nest, not like a separate neon product.

- Reuse existing cards, typography, spacing, `PageHeader`, `Dialog`, `Button`, toast, query-state, and mobile data-view contracts.
- Use one quiet icon such as `Sparkles` only as a secondary identifier. Avoid purple gradients, glowing borders, animated orbs, mascots, and “magic” language.
- Label generated material with **Suggested** or **AI-assisted** in small secondary text. The primary hierarchy remains the user’s money and the proposed action.
- Reserve warning and danger colors for financial state, not model confidence. Use text and icons in addition to color.
- Prefer skeletons that preserve layout. If generation takes more than a moment, keep the rest of the page interactive and offer cancel/retry.
- Stream Ask Nest text only after the supporting tool calls are complete; do not stream speculative numbers that may change.
- Respect reduced motion, keyboard navigation, focus return, screen-reader announcements, 200–400% zoom, and the existing 390/768/1440px responsive contract.
- Always design loading, empty, unavailable, permission-denied, rate-limited, stale, low-confidence, and provider-outage states.

Suggested microcopy:

| Avoid | Prefer |
| --- | --- |
| “AI magic found savings!” | “A possible change to review” |
| “I think you overspent” | “Dining is SGD 84 above its 3-month average” |
| “Automatically fixed” | “Suggestion approved and posted” |
| “Ask me anything” | “Ask about this page” |
| “93% confident” | “Strong match · based on 8 prior approvals” |

## Delivery plan

### Phase 0 — Ask Nest read-only MVP

- Add the authenticated, workspace-scoped API and local read-only tool layer.
- Validate every generated answer with strict structured output, grounded currency checks, bounded evidence links, and stateless Azure Responses calls.
- Add the responsive Ask Nest sheet with contextual prompts, session-only history, loading, retry, rate-limit, and provider-outage states.
- Keep mutation tools, external web access, persistent memory, and model-authored calculations out of scope.

**Gate:** production build and tenant-isolation contracts pass; every amount originates in a tool result; credentials stay server-side; the provider failure path leaves the rest of Nest usable.

### Phase 1 — Ask Nest controlled pilot

- Release to selected workspaces behind an owner-controlled feature flag.
- Build a redacted golden set for tool choice, filters, numeric integrity, refusal behavior, and cross-workspace attacks.
- Add sanitized latency, token, tool-call, failure, and usefulness signals plus a server-side kill switch.

**Gate:** groundedness and authorization evaluations pass; p95 latency and cost are acceptable; no sensitive trace leakage; users can disable the surface cleanly.

### Phase 2 — Smart Review shadow mode and pilot

- Run transaction suggestions in shadow mode before showing them.
- Release to selected workspaces with approval required for every suggestion.
- Capture approve, edit, reject, reason, latency, and provider failure signals; offer “Create rule” only after repeated approvals.

**Gate:** no AI-originated write path; strong-match suggestions reach at least 95% precision on the evaluation set; edits trend downward; provider failure leaves the normal accounting flow intact.

### Phase 3 — Money Brief

- Implement the deterministic fact builder and evidence registry.
- Start with on-demand refresh; add scheduled generation only after durable jobs are ready.
- Limit the brief to three items and measure dismissals as well as clicks.

**Gate:** every factual statement resolves to evidence; unsupported numerical claims are a release blocker; the card disappears cleanly when no useful insight exists.

### Phase 4 — Documents and scenarios

- Pilot statement extraction with one or two representative institutions and a side-by-side review UI.
- Add scenario drafting to the monthly budget plan using deterministic calculations.
- Expand only when correction rates and operating cost are acceptable.

## Measurement and evaluation

Foundry evaluation and Application Insights tracing should support, not replace, product analytics and domain tests.

Track:

- **Suggestion precision:** approved without edit, by confidence band and merchant family.
- **Correction distance:** which fields users change and how often.
- **Time saved:** median time to account for ten transactions versus the existing flow.
- **Groundedness:** every generated claim maps to supplied evidence.
- **Tool accuracy:** correct tool, filters, date range, and interpretation.
- **Numeric integrity:** rendered values exactly match deterministic tool output.
- **User trust:** dismiss, hide, disable, and “not useful” rates—not only clicks.
- **Reliability:** p50/p95 latency, timeout rate, fallback rate, and provider errors.
- **Cost:** tokens and tool calls per completed user task, with per-workspace limits.
- **Fairness and robustness:** equivalent accuracy across currencies, short/long merchant names, languages used by Nest customers, sparse histories, and new workspaces.

Maintain versioned golden datasets for transaction suggestions, briefs, questions, adversarial prompts, cross-workspace attacks, stale evidence, document injection, and provider failure. Run them for every prompt, model, tool-schema, or context-builder change. Promote a new model deployment only after it meets or beats the pinned baseline.

Production rollout should use feature flags, a small workspace cohort, sampled sanitized traces, quality alerts, and an immediate server-side kill switch. Preview Foundry capabilities must not become critical-path dependencies without a documented fallback.

## Decisions to make before broader rollout

1. Which Azure geography and deployment type satisfy Nest’s data-residency and latency requirements?
2. Is AI enabled by the workspace owner, by each member, or both? Recommended default: owner enables data processing; each user controls personal surfaces such as briefs.
3. How long may pending suggestions and sanitized diagnostic traces be retained? Recommended default: suggestions expire after 30 days; prompt bodies are not retained.
4. Which user corrections may enter evaluation datasets, and how will consent and deletion work?
5. Which model and smaller fallback pass the first Nest-specific evaluation set at an acceptable cost?
6. Which institutions and statement formats justify the first document-capture pilot?

## Explicitly out of scope

- A site-wide chatbot or anthropomorphic financial companion.
- Background agents that make unsupervised changes.
- Automatic transfers, card payments, receivable closure, budget application, or investment trades.
- Credit scoring, loan eligibility, insurance pricing, or recommendations for financial products.
- Tax, legal, or investment advice.
- Scraping external financial accounts without a user-authorized integration.
- Vectorizing the entire transaction ledger without a demonstrated retrieval need.
- Persistent personal memory without inspect, edit, export, and delete controls.
- Fine-tuning on private Nest data as an initial strategy.

## Official references

- [What is Microsoft Foundry?](https://learn.microsoft.com/en-us/azure/foundry/what-is-foundry)
- [Microsoft Foundry Agent Service overview](https://learn.microsoft.com/en-us/azure/foundry/agents/overview)
- [Agent tool catalog](https://learn.microsoft.com/en-us/azure/foundry/agents/concepts/tool-catalog)
- [Connect OpenAPI tools to Foundry agents](https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/tools/openapi)
- [Structured outputs with Azure OpenAI](https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/structured-outputs)
- [Azure Document Intelligence](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/)
- [Azure Content Understanding for documents](https://learn.microsoft.com/en-us/azure/ai-services/content-understanding/document/overview)
- [Connect Azure AI Search to Foundry agents](https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/tools/ai-search)
- [Observability in generative AI](https://learn.microsoft.com/en-us/azure/foundry/concepts/observability)
- [Prompt Shields](https://learn.microsoft.com/en-us/azure/foundry/openai/concepts/content-filter-prompt-shields)
- [PII detection and redaction](https://learn.microsoft.com/en-us/azure/ai-services/language-service/personally-identifiable-information/quickstart)
- [Data, privacy, and security for Azure Direct Models](https://learn.microsoft.com/en-us/azure/foundry/responsible-ai/openai/data-privacy)

## Final product test

Before shipping any AI feature, ask:

> If the AI label disappeared, would this still be a clear, valuable, trustworthy improvement to managing money in Nest?

If the answer is no, do not ship it.
