# Nest UI contract

Authenticated screens use `AppShell` through `PageFrame`. Feature pages should not recreate sidebar, topbar, document-title, or workspace behavior.

Each screen begins with `PageHeader`, using the order: title, context or description, primary action, secondary actions, then filters. On small screens, primary actions remain reachable without horizontal scrolling.

New controls use the primitives in `components/ui`: `Button`, form fields, `Dialog`, query states, and data-view helpers. Feature-specific CSS may arrange these primitives but should not redefine their state behavior.

All confirmations use the promise-based confirmation service. Do not use `window.confirm`, double-click backdrop dismissal, or unlabelled modal containers. Dialogs must trap focus, close with Escape when safe, and restore focus.

All popups use a fixed header, an independently scrolling content region, and a fixed action footer. Form fields and long Notes content must never push the action footer outside the popup viewport. Dismissal controls use `ModalCloseButton`, which renders the standard accessible X icon; do not add text-labelled or Unicode close controls.

Mutations expose a pending state and surface failures through the global toast provider. Empty and query-error states should provide a useful next action where one exists.

Money and dates use `lib/currency.ts` and `lib/presentation.ts`. Amount meaning must be conveyed by sign or label in addition to color.

Dense data uses a desktop table and a mobile card representation, or the responsive table contract. Validate at 390px, 768px, and 1440px in light and dark themes.
