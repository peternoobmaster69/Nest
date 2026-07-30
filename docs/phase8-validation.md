# Phase 8 UX and accessibility validation

This checklist separates repeatable automated contracts from human validation that must be completed against a production-like build before release. Record the tester, device/browser, date, and issue link for every manual run.

## Task-based journeys

For each journey, verify keyboard and pointer completion, clear loading/error/success feedback, correct workspace/role context at consequential decisions, and no silent data loss.

| Journey | Required observations |
| --- | --- |
| First workspace | Create or join, identify the active workspace, understand owner/editor/viewer permissions, and recover from a failed request. |
| First account and sub-account | Create both, reconcile a balance, cancel and accept the structured money confirmation, then verify the resulting balances. |
| First transaction | Add income and an expense; verify source, destination, amount, date, resulting balance, and immutable reversal copy before posting. |
| Transfer | Move money between sub-accounts; verify both resulting balances and create a compensating reversal. |
| Receivable close | Close same-workspace and cross-workspace receivables; verify permission failures do not leak source-workspace balances. |
| Card payment | Select card/month, deep-link the selection, make a payment, and verify the source and statement results. |
| Gmail connection | Review read-only scope, connect, sync, inspect last-sync status, disconnect, and reconnect. |
| Collaboration | Invite editor/viewer roles; verify viewers receive a useful permission explanation and cannot mutate records. |
| Public sharing | Enable, copy, rotate, and revoke both links; verify old URLs stop working and owner/re-auth requirements are clear. |

## Accessibility and responsive release matrix

- Keyboard only: logical focus order, visible focus, Escape behavior, trigger focus return, and no keyboard trap.
- Zoom/reflow: 200%, 300%, and 400% without two-dimensional page scrolling or obscured controls.
- Motion/contrast: reduced-motion and Windows forced-colors/high-contrast modes.
- Screen readers: VoiceOver + Safari, NVDA + Firefox/Chrome, and TalkBack + Chrome.
- Viewports: 360, 390, 430, 768, 1024, and 1280 CSS pixels, plus phone landscape, in light and dark themes.
- States: loading, empty, partial, error, permission, offline, stale-edit conflict, and success on each critical journey.

## Automated evidence

Run `npm run ux:check`, `npm run ui:check`, `npm run lint`, `npm run typecheck`, and `npm test`. Automated checks are supporting evidence only; they do not mark the manual matrix complete.
