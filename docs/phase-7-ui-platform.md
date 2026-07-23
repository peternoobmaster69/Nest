# Phase 7 UI platform

Phase 7 replaces page-specific UI plumbing with guarded shared contracts while preserving the shipped mobile experience.

## Platform contracts

- `components/ui/dialog.tsx` owns focus trapping, Escape handling, focus restoration, body scroll locking, visual-viewport sizing, and nested-dialog behavior. `surface="custom"` keeps established feature class names and layout while supplying the shared behavior.
- `Button`, `Input`, `Select`, `Textarea`, and `FormField` are the only action and form entry points outside `components/ui`. ESLint and `npm run ui:check` reject native feature controls.
- Phone dialogs use safe-area-aware inline sizing from the compact dialog contract in `app/styles/utilities.css`. Transaction entry dialogs keep `profile-modal txn-modal txn-entry-modal`; investment add/edit dialogs keep `profile-modal inv-modal`. These class contracts are regression-tested because they carry the near-full-width, single-column, no-overlap behavior.
- Route loading, failure, and not-found screens use `components/ui/route-state.tsx` for consistent retry and recovery actions.

## Structure

The five initial large-route targets now retain data/orchestration in their controllers and move focused rendering into feature components:

- Transactions: month list
- Rewards: overview
- Dashboard: transaction row and lazy cash-flow chart
- Credit Transactions: summary
- Settings: operation notice and lazy import, app-access, and auto-rule workflows

Files still above 400 lines have explicit, non-growing ceilings in `docs/ui-component-exceptions.json`. A new oversized component or growth beyond a ceiling fails the architecture check.

CSS loads in source order through `app/globals.css`: tokens, base, features, components, then utilities. The legacy feature layer remains frozen during route-by-route extraction; checks prevent growth in raw colors, z-indexes, breakpoints, and `!important` usage. Canonical breakpoint values live in `lib/ui/breakpoints.ts`.

## Data and navigation

- `lib/query-keys.ts` provides typed keys and workspace invalidation/removal helpers. Workspace changes remove scoped cached data before refetching, preventing one workspace from displaying another workspace's stale values.
- Query refetch failures keep prior data visible. Mutation errors have stable offline, permission, conflict, stale-precondition, validation, and unknown messages.
- `lib/accounts.ts` is the canonical bank-account shape and query definition. Settings is the canonical management screen; legacy account URLs redirect to `settings?tab=workspaces#bank-accounts`.

## Performance and layout stability

- Charts, data import, app access, and the rule editor load as route-specific chunks.
- `next/font` owns font loading, and lazy placeholders reserve space to limit layout shift.
- `components/web-vitals-reporter.tsx` emits LCP, INP, CLS, and available browser-memory observations through `nest:web-vital` performance entries and events.
- `npm run ui:metrics:baseline` records production route JS/CSS gzip sizes. `npm run ui:metrics:check` rejects a regression above 5% against that baseline.

## Required gates

Run `npm run check`, `npm run build`, and `npm run ui:metrics:check`. The focused mobile and dialog contract is also available through `npm run test:ui` and `node --test tests/phase7-ui-platform.test.mjs`.
