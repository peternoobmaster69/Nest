# Transaction assistant

Ask Nest records or corrects one ordinary transaction at a time, in the same thread as questions. There are no mode tabs:

- A message that reads like a command ("deduct $10", "spent $12 on lunch", "change yesterday’s lunch to $12") starts a draft card inline in the thread. Anything else gets a read-only answer.
- While a draft is open, a strip above the message box shows its summary with **Cancel**, and the message box replies to the draft. Short replies like "2", "transit" or "yesterday" work there. Suggested follow-ups under answers still ask read-only questions.
- If routing guessed wrong, the draft offers **This was a question**, which cancels it and asks instead. Answers to messages with amounts offer **Record this instead**.
- The open draft ID is kept in `sessionStorage` so an unfinished draft comes back when Ask Nest reopens. Finished drafts are not restored. The existing Azure AI workload interprets the request; server code resolves accounts, builds the review, and saves only after the user presses **Confirm**.

## Conversations to support

The model only extracts a structured intent. Server code resolves every account and transaction, and a review can only be saved with the Confirm button.

| User says | Assistant behavior |
| --- | --- |
| “Deduct $10” | Lists every active sub-account with its bank and balance, and asks which one. Sub-accounts used for similar descriptions or used recently are listed first and marked **Suggested**. |
| “Deduct $10 from transport for bus fare” when only Transit exists | “There’s no sub-account called “transport”. Did you mean “Transit”?” Suggestions never select an account on their own. **None of these** lists every sub-account. |
| “mrt”, “ntuc”, “makan”, “grocerys”, “entertainmnt” | Suggests the matching category (Transit, Groceries, Food) or the closely spelled name. |
| “Transit”, “1”, or “yes” after one suggestion | Selects that displayed option, then asks for missing fields or shows a review. This never saves. |
| “12.50”, “yesterday”, “deduct”, “bus fare”, or “skip” after a question | Answers only the question just asked, without a model call. “Skip” uses the sub-account name as the description. A reply like “actually $12 for lunch” goes to the model instead. |
| “Spent $12.50 on lunch at the hawker yesterday” | Reviews a debit dated yesterday. The assistant still asks which sub-account, with Food suggested. |
| “Add $100 to Savings”, “Got my salary, $3,000” | Reviews a credit. Asks for a description if one is missing. |
| “I received a $20 refund in Food” | Proposes a new credit, not an edit to the original expense. |
| “Change yesterday’s lunch from $10 to $12” | Searches ordinary transactions. One exact match goes straight to a review that shows the original. Several matches are listed. If the date or amount doesn’t match, close matches are listed under “I couldn’t find an exact match”. |
| “Fix my last transaction” | Lists the 10 most recent ordinary transactions to choose from. |
| “Make that $12” straight after saving | Corrects the transaction that was just saved, showing the original next to the change. |
| “Actually $15” or “use Food instead” while drafting | Revises the draft and invalidates the previous review. A correction can move between sub-accounts of the same bank account. |
| Pencil buttons, the Deduct/Add toggle, or **Change** on the review | Edits that field directly, without a model call, and rebuilds the review. Invalid values keep the previous review and explain why. |
| “Transit” when two banks have that sub-account | Shows both banks and asks which one. |
| “Deduct $10 from Transit and add $50 to Savings” | Handles the first request, says it will do the second next, and shows **Continue with…** after saving. |
| “Move $50 from Food to Transit”, “Delete the bus fare” | Explains that transfers and deletions are done on the Transactions page. |
| “Cancel”, “Never mind”, or **Cancel draft** | Cancels the draft and leaves the ledger unchanged. |
| “Yes” or “Confirm” at the final review | Keeps the review pending. Only the Confirm button submits a financial write. |
| A balance changes before Confirm | Nothing is saved. The assistant shows the updated review and asks for confirmation again. “Refresh” does the same on request. |
| The AI service is unavailable | Simple one-line commands like “Deduct $10 from Transit for bus fare” are still parsed locally and reviewed. Other requests get a clear message and nothing changes. |

Missing create dates default visibly to the current Singapore day. Corrections keep the existing date unless it is changed. Reviews show the description, amount, direction, date, bank account, sub-account, and balance impact. Overdrawn balances, future dates, dates more than a year ago, and potential duplicates are highlighted. Duplicate warnings use amount, date, direction, and sub-account, so legitimate repeat purchases can still be saved after review.

Transfers, card payments, receivables, deletion, splits, recurring entries, and currency conversion are outside this version, and the assistant directs users to the right page. It does not create missing accounts. Description, amount, direction, date, and sub-account can be corrected, and existing notes and details are preserved. Transaction searches return at most 10 choices. Account lists are searchable and support up to 500 active sub-accounts.

## API and authorization

`POST /api/ai/transactions` requires EDITOR access, same-origin requests, and a bounded JSON body. The workspace comes from authenticated workspace context. Strict request schemas reject workspace overrides and financial fields supplied with confirmation.

| Action | Fields |
| --- | --- |
| `start` | `message` (1–600 characters), optional `previousDraftId` of the user’s saved draft, used for “make that $12” |
| `message` | `draftId`, `revision`, `message` |
| `select` | `draftId`, `revision`, `selection: {kind: "budget" \| "transaction", id}` from displayed choices |
| `edit` | `draftId`, `revision`, `field` (`amount`, `subject`, `date`, `direction`, or `budget`), optional `value` (up to 120 characters). `budget` reopens the sub-account list. |
| `confirm` / `cancel` | `draftId`, `revision` |

Views include `pending`, the field the assistant is asking about, and, after saving, `nextRequest`, a further request from the same message.

`GET /api/ai/transactions?draftId=…` restores only the current user's draft in the current workspace. Responses are private and not cached. Drafting is limited to 40 requests per 10 minutes. Inline edits never call the model and have a separate limit of 120 per 10 minutes. Confirmation and cancellation don’t count against either limit.

## Confirmation and integrity

- Drafts are persisted with a revision, user, workspace, and 30-minute expiry. Conversation text alone cannot authorize a write.
- An edit invalidates the old review before calling the model. Concurrent edits use conditional revision updates.
- Confirmation locks the draft and uses the existing serializable posting service. It rechecks the currency, active account ownership, names, balances, and exact source transaction snapshot before writing.
- Creation updates the ledger and sub-account balance atomically. Corrections reuse the reversal-and-replacement implementation, retaining source notes/details and correction history.
- If a balance changed, confirmation rolls back and returns a refreshed review with a new revision. The old revision can no longer be confirmed.
- Confirmation uses a stable key per draft. Repeated confirmations and retries after a lost response return the same saved receipt.
- Cancelled, expired, stale, cross-user, and cross-workspace drafts cannot be saved. Changes in the source transaction require a fresh correction.
- Draft IDs alone are stored in browser session storage. The existing retention cron removes draft conversations 30 days after expiry; ledger audit records remain.

The provider receives bounded conversation text, the extracted intent, and the names of the workspace’s sub-accounts and banks. It receives no balances, credentials, or write tools. Model-suggested account names are only used to order choices, and are discarded unless they exactly match an existing sub-account. Structured extraction follows the [OpenAI structured output API](https://developers.openai.com/api/docs/guides/structured-outputs). The model cannot supply arbitrary IDs for confirmation, and its generated prose is never interpreted as an approved mutation.

## Deployment and validation

Deploy the additive migration `20260930000000_transaction_agent_drafts` and regenerate Prisma before enabling this build. Existing `AI_WORKLOAD_ENDPOINT`, `AI_WORKLOAD_API_KEY`, and `AI_WORKLOAD_MODEL` settings are reused. No new provider is required.

Tests: `tests/transaction-agent.test.mjs` covers near-name and category suggestions, history ordering, routing between questions and commands, short-answer handling, the offline parser, inline edits, amounts, dates, currency, and review calculation. `tests/transaction-agent-workflow.test.mjs` runs the real coordinator and the posting and correction service against an isolated transactional store. It covers multi-turn drafts, choice validation, approval, replay, cancellation, expiry, scope, provider failure and fallback, stale-balance refresh, target search, correcting what was just saved, inline edits, and follow-up requests. These tests don’t write to the configured database.
