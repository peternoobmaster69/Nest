---
title: Application Shell and UI Platform Module
description: Shared React shell, controls, dialogs, query state, responsive behavior, and client-cache contracts.
audience: [frontend-engineers, accessibility-reviewers, ai-assistants]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# Application shell and UI platform

## Purpose

Provide consistent authenticated navigation, accessible interactions, responsive layouts, and tenant-safe client data state.

## Scope

`components/app-shell.tsx`, `components/page-frame.tsx`, `components/ui/`, skeletons, route loading/error files, client query helpers, theme/PWA device integration, and layered CSS.

## Responsibilities

- Render desktop/mobile navigation and workspace context.
- Centralize buttons, form controls, field errors, dialogs, modal close, page headers, and data/query/route states.
- Trap focus, restore focus, handle Escape, lock body scroll, and size dialogs to the visual viewport.
- Use React Query keys that include workspace scope.
- Keep existing data visible on background-refetch failure.
- Lazily load heavy feature UI and preserve layout geometry.
- Emit web-vital observations.
- Provide static-only PWA shell and install prompt.

## Public APIs and important files

| File | Important exports | Consumers/maintenance notes |
| --- | --- | --- |
| `components/app-shell.tsx` | `AppShell` | Shared authenticated shell; avoid feature logic |
| `components/page-frame.tsx` | `PageFrame` | Standard route wrapper |
| `components/ui/dialog.tsx` | `Dialog` family | Owns accessibility/lifecycle; do not recreate per feature |
| `components/ui/button.tsx` | `Button` | Feature actions must use it |
| `lib/privacy-mode.ts`, `lib/use-money-format.ts`, `components/privacy-toggle.tsx` | `usePrivacyMode`, `useMoneyFormat`, `PrivacyToggle` | Privacy mode: a per-device eye toggle in the top bar masks amounts as `••••••`. Format money through `useMoneyFormat` (or `formatCioMoney`); free text and charts use the `privacy-sensitive` class or `app/styles/privacy-mode.css` blur. `public/theme-init.js` applies the stored choice before paint |
| `components/ui/controls.tsx` | `Input`, `Select`, `Textarea` | Native feature controls are architecture violations |
| `components/ui/form-field.tsx` | `FormField` | Label/error contract |
| `components/ui/page-header.tsx` | `PageHeader` | Title/context/action order |
| `components/ui/query-state.tsx` | Query-state helpers | Initial/error/empty behavior |
| `components/ui/route-state.tsx` | Route state helpers | Loading/failure/not-found |
| `components/ui/data-view.tsx` | Data view primitives | Responsive data presentation |
| `components/ui-skeleton.tsx` | Shell/loading primitives | Must remain within reviewed line ceiling |
| `lib/query-keys.ts` | `queryKeys`, invalidation/removal | Tenant-safe cache |
| `lib/api/client.ts` | `apiFetch`, mutation failure mapping | Stable client errors |
| `lib/ui/breakpoints.ts` | canonical breakpoints/media | Avoid route-local breakpoints |

## Internal workflow

Route page → `PageFrame` → `AppShell` → feature controller → `workspaceFetch`/`apiFetch` → React Query cache → focused view/dialog.

Workspace URL changes remove old workspace queries before new data is shown.

## Configuration

- CSS load order begins in `app/globals.css`.
- Tailwind v4 uses PostCSS.
- Font loading uses `next/font`.
- PWA manifest and service worker are runtime-string entry points.

## Error handling

- Route errors use shared recovery states.
- Mutation failures map offline, permission, conflict, precondition, validation, rate-limit, database-unavailable, and unknown cases.
- Toast provider communicates asynchronous outcomes.

## Performance considerations

- Large controllers remain a significant parse/maintenance cost.
- Charts, import tools, app access, and rule editor are lazy.
- Skeletons reserve space to limit CLS.
- UI metrics compare route JS/CSS gzip against a 5% budget.

## Security considerations

- Never render private server data into public/static caches.
- Service worker must not cache `/api` or queue writes.
- Dialog content can contain sensitive finance data; screenshots/logging are outside component responsibility.

## Risks and failure scenarios

- Raw controls bypass accessibility/state conventions.
- Unscoped query keys leak stale workspace values.
- Changing established mobile dialog class names can break tested safe-area behavior.
- Increasing exception ceilings hides architectural regressions.

## Future extension points

- Extract orchestration hooks from large controllers.
- Add browser E2E/accessibility automation.
- Tighten CSP after inline-style removal.

## Related Files

- [`app/globals.css`](../../app/globals.css)
- [`tests/ui-contract.test.mjs`](../../tests/ui-contract.test.mjs)
- [Performance review](../reviews/performance-review.md)

## Dependencies

- React 19, Next.js, React Query, Tailwind CSS, Lucide.

## Assumptions

- Mobile targets include 390px and compact safe-area devices.

## Known Limitations

- Several page controllers exceed 1,000–3,000 lines.
- UI contracts are mainly source-contract tests, not real-browser automation.

## Future Improvements

- See [refactoring opportunities](../reviews/refactoring-opportunities.md).

## Last Updated

2026-07-28
