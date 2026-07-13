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

Status: Complete

- [x] Standardize one mobile placement for primary create actions.
- [x] Convert long create/edit workflows into full-screen mobile flows with fixed action bars.
- [x] Preserve page scroll, selected month, account, card, and filters when navigating back.
- [x] Add consistent pressed, loading, success, and optimistic mutation feedback.
- [x] Review every dense toolbar and replace unnecessary horizontal scrolling with compact selectors or filter panels.
- [x] Restrict swipe gestures to safe and reversible actions.

## Phase 3 — Installability and device integration

Status: Complete

- [x] Add production Android and iOS icon sets, including maskable and Apple touch icons.
- [x] Add install guidance and standalone-display refinements.
- [x] Add a service worker and cache the application shell plus safe read-only recent data.
- [x] Never silently queue financial mutations while offline.
- [x] Add passkey/WebAuthn authentication where supported.
- [x] Add optional web push for payment reminders, receivable dates, invitations, and background-task completion.

## Phase 4 — Mobile quality audit

Status: In Progress

- [ ] Complete the live visual pass at 390px, 430px, 844×390, and 932×430. Automated responsive contracts are complete; an interactive browser session is still required.
- [x] Audit 44–48px touch targets, focus order, screen-reader names, keyboard behavior, and reduced motion.
- [x] Remove remaining layout shifts and accidental nested scrolling.
- [x] Measure mobile route transitions, interaction latency, and bundle impact.

## Execution log

- 2026-07-13: Created the roadmap and started Phase 1 mobile-shell implementation.
- 2026-07-13: Implemented the phone-only bottom navigation, compact mobile app bar, workspace-aware More panel, focus containment, and safe-area collision offsets. Verification remains in progress.
- 2026-07-13: Completed Phase 1 verification: TypeScript passed, ESLint passed, all 15 UI-contract tests passed, production build completed, and `git diff --check` reported no whitespace errors.
- 2026-07-13: Implemented Phase 2 shared workflow state, browser-back scroll restoration, global mutation progress feedback, standardized phone create actions, and full-screen phone form flows with safe fixed action bars.
- 2026-07-13: Replaced the dense mobile card-transaction period rail with compact month/year selectors and constrained horizontal touch interactions to reversible selection rails.
- 2026-07-13: Completed Phase 2 verification: TypeScript passed, ESLint passed, all 24 tests passed, the Next.js production build completed, and `git diff --check` reported no whitespace errors. The Prisma prebuild download was separately blocked by the local self-signed certificate chain.
- 2026-07-13: Implemented Phase 3 install assets, maskable and Apple icons, install guidance, standalone refinements, an offline application shell, and recent read-only cache fallbacks.
- 2026-07-13: Added explicit offline mutation rejection with no background financial queue, discoverable passkeys with one-time WebAuthn challenges and replay counters, and NextAuth passkey sign-in.
- 2026-07-13: Added opt-in VAPID web push subscriptions for payment reminders, receivable dates, invitations, and background-task completion, plus deployment setup documentation.
- 2026-07-13: Completed Phase 3 verification: Prisma schema validation passed, TypeScript passed, ESLint passed, all 28 tests passed, the 80-route Next.js production build completed, and `git diff --check` reported no whitespace errors.
- 2026-07-13: Started Phase 4 with a source and interaction-contract audit. Added 44px coarse-pointer targets, a keyboard skip link, keyboard-operable transaction account filters, reliable legacy-dialog labels, motion-safe scrolling, and a global reduced-motion contract.
- 2026-07-13: Extended the native mobile shell and full-screen workflow rules to coarse-pointer phone landscape up to 960×500, including landscape safe-area padding and a two-column More layout. Stabilized the main scroll container and removed the route loader's artificial post-navigation delay.
- 2026-07-13: Added real client-route performance measures, Vercel Speed Insights, and a bundle regression boundary that keeps the Settings client away from the server validation module. After the passkey-management refinement, Settings measured 246.3 KiB raw / 70.5 KiB gzip, down from 509.4 KiB raw / 131.5 KiB gzip; Transactions measured 67.8 KiB gzip and Card Transactions 62.0 KiB gzip.
- 2026-07-13: Made passkey names required and recognizable, with device/browser suggestions, rename controls for existing credentials, synced/device-bound status, and added/last-used references. Server-side rename and registration validation remain scoped to the signed-in user.
- 2026-07-13: Phase 4 automated verification passed: TypeScript, ESLint, all 31 tests, and the 80-route Next.js production build. The live 390px/430px/phone-landscape visual pass remains open because no interactive browser session was available; the normal npm build wrapper also encountered a Windows lock on the already-generated Prisma DLL, while the direct Next.js build passed.
