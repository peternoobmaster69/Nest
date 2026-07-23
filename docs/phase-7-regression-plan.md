# Phase 7 regression plan

## Automated release gate

Run these from a clean production-like checkout:

1. `npm run check` — architecture limits, lint, types, OpenAPI, unit/integration, security, and UI contracts.
2. `npm run build` — server/client boundaries, dynamic imports, route states, and production compilation.
3. `npm run ui:metrics:check` — route JavaScript and CSS must remain within 5% of `docs/ui-performance-budget.json`.

Any failure blocks release. Update the performance baseline only after reviewing an intentional extraction or dependency change; never update it merely to make a regression pass.

## Mobile popup and form matrix

Test 360×800, 390×844, 430×932, 768×1024, 1024×768, and 1440×900, plus a short coarse-pointer phone landscape viewport. Repeat the critical phone cases in iOS Safari and Android Chrome, in light and dark themes.

For every dialog, open the software keyboard, move between all inputs, enter long text, trigger validation, scroll to the end, rotate once, and close with both the visible close action and Escape where available. Confirm:

- no browser zoom is needed and focusing an input does not trigger unwanted page zoom;
- safe gutters remain visible, fields never overlap or overflow, and controls retain at least a 44px touch target;
- header and action footer remain reachable while only the dialog body scrolls;
- primary action placement is consistent, keyboard content is not hidden, background scrolling is locked, and focus returns to the opener.

The protected high-risk cases are:

- Add Transaction and Edit Transaction: `profile-modal txn-modal txn-entry-modal` is nearly full width on a phone, with a one-column form and non-overlapping amount, account, date, notes, and actions.
- Investment Account add/edit and Investment Entry add/edit: `profile-modal inv-modal` uses the same safe-area width and one-column field behavior.
- Receivable, credit-card, credit-transaction, budget, settings bank-account, auto-rule, profile, collaborator, import, and sign-in dialogs follow the same shell and action order.

## Functional regression journeys

1. Create, edit, filter, transfer, and delete a transaction; verify totals and month cards refresh without a reload.
2. Edit an investment's invested amount and current amount; verify the popup and the underlying investment card show the same new values immediately. Reopen the popup and switch workspaces to confirm no stale cache leaks across cards.
3. Add/edit an investment account and entry, including validation and long labels.
4. Add/edit a bank account through Settings and verify legacy `/accounts` and workspace account links redirect to the canonical anchored screen.
5. Exercise dashboard, rewards, credit transactions, Gmail automation, auto-rule editing, data import, receivables, credit cards, budget plan, profile, and collaboration paths.
6. For each query-backed screen, test initial loading, empty data, route failure/retry, and a background-refetch failure. Existing data must remain visible during the background failure.
7. Simulate offline, 403, 409, and 412 mutation responses. Verify stable, actionable messages and no false success or stale optimistic card value.

## Accessibility and performance checks

- Keyboard through each dialog: initial focus, logical order, focus trap, Escape, and restored trigger focus.
- Check labels, error announcements, disabled/pending actions, color-independent amount/status meaning, reduced motion, and 200% reflow.
- Verify the chart, import tools, app access, and rule editor are absent from the initial route chunk and show reserved loading geometry when fetched.
- Capture LCP, INP, CLS, route JS/CSS gzip, and available heap measurements. Reject more than 5% route-size or interaction regression and investigate any new layout shift.
