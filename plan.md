# Native Mobile Experience Plan

Last updated: 2026-07-13

## Objective

Make Nest feel like a coherent native mobile finance application while preserving the existing tablet and desktop experience. Changes should prioritize stable navigation, thumb reach, safe-area handling, state preservation, responsive performance, and safe financial interactions.

## Phase 1 — Mobile application shell

Status: Complete

- [x] Add a phone-only bottom navigation with Home, Transactions, Cards, Budget, and More.
- [x] Respect workspace navigation visibility settings when showing primary and secondary destinations.
- [x] Replace mobile breadcrumbs and hamburger-first navigation with a compact title-focused app bar.
- [x] Add a compact More panel for Receivables, Rewards, Investments, Workspaces, Settings, and card-management destinations.
- [x] Highlight the active destination, including secondary routes represented by More.
- [x] Add safe-area padding so content, navigation, toasts, and fixed actions do not overlap the bottom bar.
- [x] Close the More panel on outside tap, Escape, or navigation.
- [x] Keep the existing sidebar and topbar behavior unchanged above the phone breakpoint.
- [x] Add UI-contract regression tests and verify lint, TypeScript, and production build.

## Phase 2 — Core mobile workflows

Status: Planned

- [ ] Standardize one mobile placement for primary create actions.
- [ ] Convert long create/edit workflows into full-screen mobile flows with fixed action bars.
- [ ] Preserve page scroll, selected month, account, card, and filters when navigating back.
- [ ] Add consistent pressed, loading, success, and optimistic mutation feedback.
- [ ] Review every dense toolbar and replace unnecessary horizontal scrolling with compact selectors or filter panels.
- [ ] Restrict swipe gestures to safe and reversible actions.

## Phase 3 — Installability and device integration

Status: Planned

- [ ] Add production Android and iOS icon sets, including maskable and Apple touch icons.
- [ ] Add install guidance and standalone-display refinements.
- [ ] Add a service worker and cache the application shell plus safe read-only recent data.
- [ ] Never silently queue financial mutations while offline.
- [ ] Add passkey/WebAuthn authentication where supported.
- [ ] Add optional web push for payment reminders, receivable dates, invitations, and background-task completion.

## Phase 4 — Mobile quality audit

Status: Planned

- [ ] Validate at 390px, 430px, and common phone landscape dimensions.
- [ ] Audit 44–48px touch targets, focus order, screen-reader names, keyboard behavior, and reduced motion.
- [ ] Remove remaining layout shifts and accidental nested scrolling.
- [ ] Measure mobile route transitions, interaction latency, and bundle impact.

## Execution log

- 2026-07-13: Created the roadmap and started Phase 1 mobile-shell implementation.
- 2026-07-13: Implemented the phone-only bottom navigation, compact mobile app bar, workspace-aware More panel, focus containment, and safe-area collision offsets. Verification remains in progress.
- 2026-07-13: Completed Phase 1 verification: TypeScript passed, ESLint passed, all 15 UI-contract tests passed, production build completed, and `git diff --check` reported no whitespace errors.
