import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import path from "node:path";

const root = process.cwd();

test("public landing page offers self-hosted and best-effort hosted paths", async () => {
  const landing = await readFile(path.join(root, "app/page.tsx"), "utf8");

  assert.match(landing, /Host it yourself/);
  assert.match(landing, /https:\/\/github\.com\/peternoobmaster69\/SaveTogether/);
  assert.match(landing, /Use the hosted version/);
  assert.match(landing, /No SLA/);
  assert.match(landing, /cloud spending reaches its ceiling/);
});

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : target;
  }));
  return files.flat();
}

test("shared UI primitives remain available", async () => {
  const required = [
    "components/app-shell.tsx",
    "components/notification-bell.tsx",
    "components/ui/button.tsx",
    "components/ui/dialog.tsx",
    "components/ui/modal-close-button.tsx",
    "components/ui/form-field.tsx",
    "components/ui/page-header.tsx",
    "components/ui/query-state.tsx",
    "components/ui/data-view.tsx",
    "components/toast-provider.tsx",
  ];

  await Promise.all(required.map(async (file) => {
    const source = await readFile(path.join(root, file), "utf8");
    assert.ok(source.length > 0, `${file} should not be empty`);
  }));
});

test("feature UI does not regress to blocking browser confirms or double-click dismissal", async () => {
  const files = (await walk(path.join(root, "components"))).filter((file) => file.endsWith(".tsx"));
  const sources = await Promise.all(files.map(async (file) => [file, await readFile(file, "utf8")]));

  for (const [file, source] of sources) {
    assert.doesNotMatch(source, /(?:window\.)?confirm\s*\(\s*["'`]/, `${path.relative(root, file)} uses a blocking browser confirmation`);
    assert.doesNotMatch(source, /onDoubleClick=/, `${path.relative(root, file)} uses double-click dismissal`);
  }
});

test("authenticated feature routes use the shared shell", async () => {
  const routes = [
    "app/transactions/page.tsx",
    "app/receivables/page.tsx",
    "app/investments/page.tsx",
    "app/credit-cards/page.tsx",
    "app/credit-transactions/page.tsx",
    "app/credit-alerts/page.tsx",
    "app/rewards/page.tsx",
    "app/settings/page.tsx",
    "app/collaborators/page.tsx",
    "app/budgets/plan/page.tsx",
  ];

  for (const route of routes) {
    const source = await readFile(path.join(root, route), "utf8");
    assert.match(source, /<PageFrame\b/, `${route} must render PageFrame`);
  }
});

test("application routes do not duplicate page names with body headers", async () => {
  const files = (await walk(path.join(root, "app"))).filter((file) => file.endsWith(".tsx"));
  const sources = await Promise.all(files.map(async (file) => [file, await readFile(file, "utf8")]));

  for (const [file, source] of sources) {
    assert.doesNotMatch(source, /<PageHeader\b/, `${path.relative(root, file)} renders a redundant body page header`);
  }
});

test("sidebar does not link to the redundant accounts route", async () => {
  const source = await readFile(path.join(root, "components/app-sidebar.tsx"), "utf8");

  assert.doesNotMatch(source, /href=["']\/accounts["']/);
});

test("sidebar does not expose the credit alert diagnostics route", async () => {
  const source = await readFile(path.join(root, "components/app-sidebar.tsx"), "utf8");

  assert.doesNotMatch(source, /href=["']\/credit-alerts["']/);
});

test("dashboard and transactions share the bank selector presentation", async () => {
  const dashboard = await readFile(path.join(root, "components/dashboard-shell.tsx"), "utf8");
  const transactions = await readFile(path.join(root, "components/transactions-page.tsx"), "utf8");
  const dashboardSkeleton = await readFile(path.join(root, "components/skeletons/DashboardSkeleton.tsx"), "utf8");
  const transactionsSkeleton = await readFile(path.join(root, "components/skeletons/TransactionsSkeleton.tsx"), "utf8");
  const styles = await readFile(path.join(root, "app/globals.css"), "utf8");

  assert.equal(dashboard.match(/className="bm-edit-btn tx-bank-action-btn"/g)?.length, 2);
  assert.equal(transactions.match(/className="bm-edit-btn tx-bank-action-btn"/g)?.length, 2);
  assert.match(dashboardSkeleton, /return <BankSelectorSkeleton \/>/);
  assert.match(transactionsSkeleton, /return <BankSelectorSkeleton \/>/);
  assert.match(styles, /@media \(max-width: 767px\) \{\s*\.tx-bank-action-btn \{/);
  assert.doesNotMatch(styles, /\.txn-page \.tx-bank-action-btn/);
  assert.match(
    styles,
    /\.dashboard-overview-bank-actions \.tx-bank-action-btn\s*\{[^}]*width:\s*32px[^}]*height:\s*32px[^}]*min-inline-size:\s*32px[^}]*min-block-size:\s*32px/s,
  );
  assert.doesNotMatch(
    styles,
    /\.dashboard-overview-bank-actions \.tx-bank-action-btn\s*\{[^}]*(?:width|height):\s*44px/s,
  );
});

test("dashboard uses one responsive overview and a clear content hierarchy", async () => {
  const component = await readFile(path.join(root, "components/dashboard-shell.tsx"), "utf8");
  const skeleton = await readFile(path.join(root, "components/skeletons/DashboardSkeleton.tsx"), "utf8");
  const styles = await readFile(path.join(root, "app/globals.css"), "utf8");

  assert.match(component, /className="dashboard-overview-card"/);
  assert.match(component, /Available bank balance/);
  assert.match(component, />Allocated</);
  assert.match(component, />Unallocated</);
  assert.match(component, />Net worth</);
  assert.match(component, /freeAmount === 0 \? " has-zero-unallocated"/);
  assert.match(component, /dashboard-overview-metric dashboard-overview-metric-unallocated/);
  assert.match(styles, /\.dashboard-overview-metrics\.has-zero-unallocated \.dashboard-overview-metric-unallocated\s*\{\s*display:\s*none/);
  assert.match(component, /const DASHBOARD_SUBACCOUNT_SHORTCUT_LIMIT = 10;/);
  assert.match(component, /filteredBudgets\.slice\(0, DASHBOARD_SUBACCOUNT_SHORTCUT_LIMIT\)/);
  assert.match(component, /className="card cash-flow-card dashboard-cash-flow-panel"/);
  assert.match(component, /className="card cc-home-panel dashboard-payments-panel"/);
  assert.match(component, /className="card dashboard-recent-panel"/);
  assert.match(component, /className="dashboard-home-main-stack"[\s\S]*?dashboard-cash-flow-panel[\s\S]*?dashboard-recent-panel[\s\S]*?Credit Card Summary/);
  assert.match(component, /className="dashboard-reconciliation-list"/);
  assert.match(component, /className="tx-reconciliation dashboard-reconciliation"/);
  assert.match(component, /discrepancyAmount} unallocated/);
  assert.match(component, /discrepancyAmount} over-allocated/);
  assert.doesNotMatch(component, /Bank balance to accounts discrepancy detected/);
  assert.doesNotMatch(component, /className="hero-card"/);
  assert.match(skeleton, /export function DashboardOverviewSkeleton\(\)/);
  assert.match(styles, /\.dashboard-home-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1\.65fr\)[^}]*grid-template-areas:\s*"main payments"/s);
  assert.match(styles, /\.dashboard-home-main-stack\s*\{[^}]*grid-area:\s*main[^}]*display:\s*grid[^}]*gap:\s*14px/s);
  assert.match(styles, /@media \(max-width: 1024px\)\s*\{[\s\S]*?grid-template-areas:[\s\S]*?"cash-flow"[\s\S]*?"payments"[\s\S]*?"recent"/);
  assert.match(styles, /@media \(max-width: 1024px\)[\s\S]*?\.dashboard-home-main-stack\s*\{[^}]*display:\s*contents/s);
  assert.match(styles, /\.cash-flow-chart\s*\{[^}]*height:\s*220px/s);
  assert.match(styles, /\.dashboard-payments-panel \.cc-home-list\s*\{[^}]*max-height:\s*none[^}]*overflow-y:\s*visible/s);
});

test("transaction sub-account cards keep compact uniform geometry", async () => {
  const component = await readFile(path.join(root, "components/transactions-page.tsx"), "utf8");
  const source = await readFile(path.join(root, "app/globals.css"), "utf8");

  assert.match(component, /hasDisplayedDiscrepancy \? \([\s\S]*?className="tx-reconciliation"[\s\S]*?\) : null/);
  assert.match(component, /displayedDiscrepancyAmount} unallocated/);
  assert.match(component, /displayedDiscrepancyAmount} over-allocated/);
  assert.match(component, /<dt>Bank<\/dt>[\s\S]*?<dt>Sub-accounts<\/dt>/);
  assert.match(component, /> Edit bank/);
  assert.match(component, /Use sub-account total/);
  assert.doesNotMatch(component, /className="tx-balance-comparison"|⚠️ Mismatch:/);
  assert.match(component, /className="tx-account-card-head"/);
  assert.match(component, /className="tx-account-receivable-btn"/);
  assert.match(component, /className="tx-account-card-icon"/);
  assert.match(source, /\.tx-account-grid\s*\{[^}]*grid-auto-rows:\s*68px[^}]*align-items:\s*stretch/s);
  assert.match(source, /\.tx-account-card\s*\{[^}]*height:\s*68px[^}]*min-height:\s*68px[^}]*max-height:\s*68px[^}]*padding:\s*6px 8px[^}]*overflow:\s*hidden/s);
  assert.match(source, /\.tx-account-receivable-btn\s*\{[^}]*min-inline-size:\s*16px[^}]*min-block-size:\s*16px/s);
  assert.match(source, /\.tx-bank-action-btn\s*\{[^}]*min-inline-size:\s*22px[^}]*min-block-size:\s*22px/s);
  assert.match(source, /\.tx-subaccount-edit-btn\s*\{[^}]*min-inline-size:\s*18px[^}]*min-block-size:\s*18px/s);
  assert.match(source, /\.tx-reconciliation\s*\{[^}]*padding:\s*8px 10px/s);
});

test("mobile editable controls do not trigger viewport focus zoom", async () => {
  const source = await readFile(path.join(root, "app/globals.css"), "utf8");

  assert.match(source, /\(hover:\s*none\)\s+and\s+\(pointer:\s*coarse\)/);
  assert.match(
    source,
    /input:not\(\[type="checkbox"\]\)[\s\S]*?\[contenteditable\][\s\S]*?font-size:\s*16px\s*!important/,
  );
});

test("credit transaction records use a compact mobile card layout", async () => {
  const component = await readFile(path.join(root, "components/credit-transactions-page.tsx"), "utf8");
  const source = await readFile(path.join(root, "app/globals.css"), "utf8");

  assert.doesNotMatch(source, /\.cct-table td\s*\{[^}]*height:\s*56\.5px/s);
  assert.match(component, /transactionDateGroups\.map\(\(group\)[\s\S]*?className="cct-date-group-row"/);
  assert.match(component, /className="btn btn-danger cct-modal-delete"/);
  assert.match(component, /defaultReceivableSubaccount\?\.name \?\? "Default Subaccount"/);
  assert.match(component, /balanceDelta === 0 && unaccountedTransactionCount > 0/);
  assert.match(component, /unaccountedTransactionCount === 1 \? "transaction" : "transactions"/);
  assert.match(component, /className: "cct-balance-status cct-balance-status-pending"/);
  assert.match(component, /unaccountedTransactionCount > 0 \? \([\s\S]*?className="cct-toggle"/);
  assert.match(component, /if \(!data \|\| unaccountedTransactionCount > 0 \|\| !showUnaccountedOnly\) return;/);
  assert.doesNotMatch(component, /const deficitAmount = [^;]*totals\.unaccounted/);
  assert.match(component, /aria-label="Statement month"/);
  assert.match(component, /aria-label="Statement year"/);
  assert.doesNotMatch(component, /<span>Month<\/span>|<span>Year<\/span>/);
  assert.match(source, /\.cct-table\.responsive-data-table \.cct-tx-subject\s*\{[^}]*grid-row:\s*1/s);
  assert.match(source, /\.cct-table\.responsive-data-table \.cct-tx-amount\s*\{[^}]*grid-row:\s*1/s);
  assert.match(source, /\.cct-table\.responsive-data-table \.cct-tx-date\s*\{[^}]*display:\s*none/s);
  assert.match(source, /\.cct-table\.responsive-data-table \.cct-tx-card\s*\{[^}]*grid-column:\s*1[^}]*grid-row:\s*2/s);
  assert.match(source, /\.cct-table\.responsive-data-table \.cct-tx-actions\s*\{[^}]*grid-column:\s*2[^}]*grid-row:\s*2/s);
  assert.match(source, /\.cct-table\.responsive-data-table \.cct-action-btn\s*\{[^}]*height:\s*30px[^}]*min-block-size:\s*30px/s);
  assert.match(source, /\.cct-table\.responsive-data-table \.cct-action-edit\s*\{[^}]*position:\s*absolute[^}]*inset:\s*0/s);
  assert.match(source, /\.cct-table\.responsive-data-table \.cct-action-delete\s*\{[^}]*display:\s*none/s);
  assert.match(source, /\.cct-table\.responsive-data-table tbody \.cct-date-group-row\s*\{[^}]*padding:\s*2px 4px 0/s);
  assert.match(source, /\.cct-table\.responsive-data-table \.cct-date-group-row td\s*\{[^}]*font-size:\s*var\(--text-md\)/s);
  assert.match(source, /\.cct-balance-status-pending\s*\{[^}]*background:\s*var\(--warning-bg[^}]*color:\s*var\(--warning/s);
  assert.match(source, /\.cct-table\.responsive-data-table tbody \.cct-transaction-row:not\(\.cct-row-deleting\)\s*\{[^}]*gap:\s*3px 10px[^}]*padding:\s*8px 10px/s);
  assert.match(source, /\.cct-summary-left\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/s);
});

test("payment due card saves from its compact date tag", async () => {
  const component = await readFile(path.join(root, "components/credit-transactions-page.tsx"), "utf8");
  const source = await readFile(path.join(root, "app/globals.css"), "utf8");

  assert.match(component, /className="cct-due-picker"[\s\S]*?onChange=\{\(e\) => saveSharedPaymentDue\(e\.target\.value\)\}/);
  assert.match(component, /picker\.parentElement\?\.scrollIntoView\(\{ block: "nearest", inline: "nearest" \}\)/);
  assert.match(component, /className="btn btn-primary cct-payment-btn"[\s\S]*?\{makePayment\.isPending \? "Paying…" : "Pay"\}/);
  assert.doesNotMatch(component, /Save Due Date|cct-due-input|cct-due-save-btn/);
  assert.match(source, /\.cct-due-date-trigger\s*\{[^}]*position:\s*relative[^}]*min-height:\s*28px/s);
  assert.match(source, /\.cct-due-date-control\s*\{[^}]*position:\s*relative[^}]*safe-area-inset-top[^}]*safe-area-inset-bottom/s);
  assert.match(source, /\.cct-due-picker\s*\{[^}]*position:\s*absolute[^}]*bottom:\s*0[^}]*left:\s*50%[^}]*opacity:\s*0[^}]*clip-path:\s*inset\(50%\)/s);
  assert.match(source, /@media \(hover: none\) and \(pointer: coarse\)\s*\{\s*\.cct-due-picker\s*\{[^}]*inset:\s*0[^}]*width:\s*100%[^}]*height:\s*100%[^}]*pointer-events:\s*auto[^}]*clip-path:\s*none/s);
  assert.match(source, /\.cct-due-date-control\s*\{[^}]*max-width:\s*100%[^}]*isolation:\s*isolate/s);
  assert.match(source, /@media \(hover: none\) and \(pointer: coarse\)\s*\{\s*\.cct-due-picker\s*\{[^}]*min-width:\s*0[^}]*max-width:\s*100%/s);
  assert.match(source, /\.cct-payment-btn\s*\{[^}]*position:\s*relative[^}]*z-index:\s*2[^}]*height:\s*26px[^}]*padding:\s*0 9px/s);
});

test("credit transaction form keeps statement month and year on one row", async () => {
  const component = await readFile(path.join(root, "components/credit-transactions-page.tsx"), "utf8");
  const source = await readFile(path.join(root, "app/globals.css"), "utf8");

  assert.match(component, /className="cct-statement-period"[\s\S]*?Statement Month[\s\S]*?Statement Year/);
  assert.match(source, /\.cct-statement-period\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*minmax\(0, 1\.2fr\) minmax\(120px, 0\.8fr\)/s);
  assert.match(source, /@media\s*\(max-width:\s*768px\)[\s\S]*?\.cct-statement-period\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1\.2fr\) minmax\(96px, 0\.8fr\)/s);
});

test("month dropdown identifies outstanding payment due dates", async () => {
  const component = await readFile(path.join(root, "components/credit-transactions-page.tsx"), "utf8");
  const route = await readFile(path.join(root, "app/api/credit-transactions/payment-due/route.ts"), "utf8");
  const styles = await readFile(path.join(root, "app/globals.css"), "utf8");

  assert.match(component, /fetchJson<PaymentDueMonthsResponse>\(`\/api\/credit-transactions\/payment-due\?\$\{/);
  assert.match(component, /return getDaysUntil\(paymentDueDate\) <= 5 \? "is-due-soon" : "is-due-later";/);
  assert.match(component, /className="cct-mobile-period-picker cct-mobile-month-picker" ref=\{mobileMonthPickerRef\}/);
  assert.match(component, /className=\{`cct-mobile-period-trigger\$\{selectedMonthPaymentDueTone[\s\S]*?aria-expanded=\{isMobileMonthPickerOpen\}/);
  assert.match(component, /aria-label=\{paymentDueDate \? `\$\{month\}, payment due` : month\}/);
  assert.match(component, /className=\{`cct-mobile-period-option\$\{paymentDueTone[\s\S]*?\$\{isSelected \? " is-selected" : ""\}`\}/);
  assert.match(component, /className=\{`cct-mobile-period-due-dot \$\{paymentDueTone\}`\}/);
  assert.match(component, /className="cct-mobile-period-picker cct-mobile-year-picker" ref=\{mobileYearPickerRef\}/);
  assert.match(component, /aria-expanded=\{isMobileYearPickerOpen\}[\s\S]*?statementYearOptions\.map\(\(year\)/);
  assert.doesNotMatch(component, /cct-month-select|cct-month-option-due/);
  assert.match(route, /by: \["creditCardId", "statementMonth"\][\s\S]*?_sum: \{ amountCents: true \}/);
  assert.match(route, /amountCents: \{ gt: 0 \}[\s\S]*?_min: \{ paymentDueDate: true \}/);
  assert.match(route, /if \(balance <= 0 \|\| !dueDate\) continue;/);
  assert.match(styles, /\.cct-mobile-period-trigger\.is-due-soon\s*\{[^}]*var\(--warning\)[^}]*var\(--warning-bg\)/s);
  assert.match(styles, /\.cct-mobile-period-trigger\.is-due-later\s*\{[^}]*var\(--success\)[^}]*var\(--success-bg\)/s);
  assert.match(styles, /\.cct-mobile-period-due-dot\.is-due-soon\s*\{[^}]*background:\s*var\(--warning\)/s);
  assert.match(styles, /\.cct-mobile-period-due-dot\.is-due-later\s*\{[^}]*background:\s*var\(--success\)/s);
  assert.match(styles, /\.cct-mobile-period-dropdown\s*\{[^}]*max-height:\s*min\(55dvh, 440px\)[^}]*overflow-y:\s*auto/s);
  assert.match(styles, /\.cct-mobile-year-dropdown\s*\{[^}]*right:\s*0[^}]*width:\s*min\(180px/s);
});

test("all modal families use the centered viewport contract", async () => {
  const source = await readFile(path.join(root, "app/globals.css"), "utf8");
  const contract = source.slice(source.indexOf("MODAL VIEWPORT CONTRACT"));

  for (const selector of [
    ".modal-overlay",
    ".profile-modal-overlay",
    ".cc-modal-overlay",
    ".cct-modal-overlay",
    ".st-modal-overlay",
    ".auto-rule-modal-overlay",
  ]) {
    assert.match(contract, new RegExp(selector.replace(".", "\\.")));
  }

  assert.match(contract, /place-items:\s*center\s*!important/);
  assert.match(contract, /padding-left:\s*max\(16px, env\(safe-area-inset-left, 0px\)\)\s*!important/);
  assert.match(contract, /height:\s*auto\s*!important/);
  assert.match(contract, /border-radius:\s*var\(--modal-radius\)\s*!important/);
});

test("small-screen modals use the available width without stretching short forms", async () => {
  const source = await readFile(path.join(root, "app/globals.css"), "utf8");
  const contract = source.slice(source.indexOf("MODAL VIEWPORT CONTRACT"));

  assert.match(contract, /@media\s*\(max-width:\s*820px\)/);
  assert.match(contract, /body\s+:is\([\s\S]*?\.modal-container[\s\S]*?\.auto-rule-modal[\s\S]*?\)\[class\]\s*\{[\s\S]*?width:\s*calc\(100vw - 10px\)\s*!important[\s\S]*?max-width:\s*calc\(100vw - 10px\)\s*!important/);
  assert.match(contract, /body\s+:is\([\s\S]*?\.modal-container[\s\S]*?\.inv-modal[\s\S]*?\)\[class\]\s*\{[\s\S]*?height:\s*auto\s*!important[\s\S]*?max-height:\s*calc\(100dvh - 10px\)\s*!important/);
  assert.doesNotMatch(contract, /height:\s*100dvh\s*!important/);
  assert.match(contract, /@media\s*\(max-width:\s*820px\)[\s\S]*?padding-right:\s*5px\s*!important[\s\S]*?padding-left:\s*5px\s*!important/);
  assert.match(contract, /padding-bottom:\s*max\(16px, env\(safe-area-inset-bottom, 0px\)\)\s*!important/);
  assert.match(contract, /\.tx-month-popover\s*\{[^}]*width:\s*calc\(100vw - 10px\)/s);
});

test("modal close controls use the shared icon button", async () => {
  const files = (await walk(path.join(root, "components"))).filter((file) => file.endsWith(".tsx"));
  const sources = await Promise.all(files.map(async (file) => [file, await readFile(file, "utf8")]));
  const legacyCloseClass = /className=["'](?:profile-modal-close|cc-close-btn|cct-close-btn|st-close-btn|tx-popover-close)["']/;

  for (const [file, source] of sources) {
    assert.doesNotMatch(source, legacyCloseClass, `${path.relative(root, file)} uses a legacy popup close control`);
  }

  const closeButton = await readFile(path.join(root, "components/ui/modal-close-button.tsx"), "utf8");
  assert.match(closeButton, /className={`modal-close/);
  assert.match(closeButton, /<X\s+size=\{18\}\s+aria-hidden="true"\s*\/>/);
  assert.match(closeButton, /aria-label={label}/);
});

test("modal action bars remain outside independently scrolling content", async () => {
  const source = await readFile(path.join(root, "app/globals.css"), "utf8");
  const contract = source.slice(source.indexOf("MODAL VIEWPORT CONTRACT"));

  assert.match(contract, /\.modal-form-shell,[\s\S]*?\.cc-modal-form,[\s\S]*?\.cct-modal-form,[\s\S]*?\.st-modal-form\s*\{[\s\S]*?flex-direction:\s*column\s*!important[\s\S]*?overflow:\s*hidden\s*!important/);
  assert.match(contract, /\.cc-modal-scroll,[\s\S]*?\.cct-form-grid,[\s\S]*?\.st-modal-form\s*>\s*\.st-form-grid[\s\S]*?overflow-y:\s*auto/);
  assert.match(contract, /\.modal-footer,[\s\S]*?\.txn-modal-actions,[\s\S]*?\.st-modal-actions,[\s\S]*?\.auto-rule-modal-footer[\s\S]*?position:\s*static\s*!important[\s\S]*?flex:\s*0\s+0\s+auto\s*!important/);

  const transactions = await readFile(path.join(root, "components/transactions-page.tsx"), "utf8");
  const receivables = await readFile(path.join(root, "components/receivables-page.tsx"), "utf8");
  assert.match(transactions, /<form className="modal-form-shell" onSubmit={onSubmitEdit}>[\s\S]*?<div className="profile-modal-body txn-modal-body txn-modal-form">[\s\S]*?<MarkdownEditor[\s\S]*?<div className="txn-modal-actions"/);
  assert.match(receivables, /<form className="modal-form-shell" onSubmit={onSubmit}>[\s\S]*?<div className="profile-modal-body recv-modal-body">[\s\S]*?<MarkdownEditor[\s\S]*?<div className="txn-modal-actions"/);
});

test("credit transaction card selection uses a compact mobile-only dropdown", async () => {
  const component = await readFile(path.join(root, "components/credit-transactions-page.tsx"), "utf8");
  const styles = await readFile(path.join(root, "app/globals.css"), "utf8");

  assert.match(component, /className="cct-mobile-card-trigger"[\s\S]*?aria-haspopup="listbox"/);
  assert.match(component, /className="cct-mobile-card-dropdown"/);
  assert.match(component, /card\.bankName \|\| "Card"} ••{card\.last4Digit}/);
  assert.doesNotMatch(component, /cct-mobile-card-label|title="Select card"|mobileSheet/);
  assert.match(styles, /\.cct-mobile-card-picker\s*\{[^}]*display:\s*none/s);
  assert.match(styles, /\.cct-mobile-card-trigger\s*\{[^}]*min-height:\s*48px/s);
  assert.match(styles, /\.cct-mobile-card-dropdown\s*\{[^}]*position:\s*absolute[^}]*max-height:\s*min\(55dvh, 360px\)/s);
  assert.match(styles, /\.cct-mobile-card-option\s*\{[^}]*min-height:\s*48px/s);
  assert.match(styles, /\.cct-card-selector\s*\{[^}]*display:\s*flex/s);
  assert.match(styles, /@media\s*\(max-width:\s*768px\)[\s\S]*?\.cct-mobile-card-picker\s*\{[^}]*display:\s*block[\s\S]*?\.cct-card-selector\s*\{[^}]*display:\s*none/s);
  assert.doesNotMatch(styles, /modal-overlay-mobile-sheet|modal-mobile-sheet/);
});

test("tablet and desktop card rails use stable explicit navigation", async () => {
  const component = await readFile(path.join(root, "components/credit-transactions-page.tsx"), "utf8");
  const styles = await readFile(path.join(root, "app/globals.css"), "utf8");

  assert.match(component, /aria-label="Show previous cards"/);
  assert.match(component, /aria-label="Show more cards"/);
  assert.match(component, /container\.scrollBy\([\s\S]*?behavior:\s*getMotionSafeScrollBehavior\(\)/);
  assert.doesNotMatch(component, /isSelectedCardOutOfView|isCardBarScrolled|updateSelectedCardVisibility/);
  assert.doesNotMatch(styles, /\.cct-card-selector\.is-scrolled/);
  assert.match(styles, /\.cct-card-rail-button\s*\{[^}]*min-width:\s*36px/s);
  assert.match(styles, /\.cct-card-rail-button:disabled\s*\{[^}]*visibility:\s*hidden/s);
});

test("phone layouts use the native-style mobile application shell", async () => {
  const shell = await readFile(path.join(root, "components/app-shell.tsx"), "utf8");
  const mobileAccount = await readFile(path.join(root, "components/mobile-account-panel.tsx"), "utf8");
  const styles = await readFile(path.join(root, "app/globals.css"), "utf8");
  const layout = await readFile(path.join(root, "app/layout.tsx"), "utf8");
  const moreNavigationStart = shell.indexOf('<nav className="mobile-more-links"');
  const moreNavigationEnd = shell.indexOf("</nav>", moreNavigationStart);
  const moreNavigation = shell.slice(moreNavigationStart, moreNavigationEnd);
  const bottomNavigation = shell.slice(shell.indexOf('<nav className="mobile-bottom-nav"'));

  assert.match(shell, /className="mobile-topbar-title"/);
  assert.match(shell, /className="mobile-bottom-nav" aria-label="Primary mobile navigation"/);
  assert.match(shell, />Home<|<span>Home<\/span>/);
  assert.match(shell, />Transactions<|<span>Transactions<\/span>/);
  assert.match(shell, />Cards<|<span>Cards<\/span>/);
  assert.match(bottomNavigation, /href="\/investments"[\s\S]*?<span>Investments<\/span>/);
  assert.doesNotMatch(bottomNavigation, /href="\/budgets\/plan"/);
  assert.match(moreNavigation, /href="\/budgets\/plan"[\s\S]*?<strong>Budget<\/strong>/);
  assert.doesNotMatch(moreNavigation, /href="\/investments"/);
  assert.match(shell, /aria-haspopup="dialog"[\s\S]*?<span>More<\/span>/);
  assert.match(shell, /className="mobile-bottom-nav-workspace"[\s\S]*?Current workspace:/);
  assert.match(styles, /\.mobile-bottom-nav-workspace\s*\{[^}]*position:\s*absolute[^}]*height:\s*var\(--mobile-nav-safe-bottom\)/s);
  assert.match(shell, /className="mobile-more-account"[\s\S]*?Profile, appearance, and workspace/);
  assert.match(shell, /setMobileMoreView\("account"\)/);
  assert.match(shell, /<MobileAccountPanel[\s\S]*?onClose=\{closeMobileNavigation\}/);
  assert.doesNotMatch(shell, /profileMenuRequest|mobileAccountRequest/);
  assert.match(mobileAccount, /className="mobile-account-profile-form"/);
  assert.doesNotMatch(mobileAccount, /profile-modal-overlay|account-profile-modal/);
  assert.match(shell, /document\.documentElement\.dataset\.mobileMoreOpen/);
  assert.match(styles, /\.mobile-bottom-nav,[\s\S]*?\.mobile-more-menu\s*\{[\s\S]*?display:\s*none/);
  assert.match(styles, /@media\s*\(max-width:\s*768px\)[\s\S]*?\.topbar \.hamburger\s*\{[^}]*display:\s*none\s*!important[\s\S]*?\.mobile-bottom-nav\s*\{[^}]*position:\s*fixed[^}]*display:\s*flex/s);
  assert.match(layout, /viewportFit:\s*"cover"/);
  assert.match(styles, /--mobile-nav-safe-bottom:\s*max\(24px, env\(safe-area-inset-bottom, 0px\)\)/);
  assert.match(styles, /\.mobile-bottom-nav\s*\{[^}]*min-height:\s*var\(--mobile-nav-height\)[^}]*padding:[^;]*var\(--mobile-nav-safe-bottom\)/s);
  assert.match(styles, /\.body\s*\{[^}]*padding:\s*14px 12px calc\(16px \+ var\(--mobile-nav-height\)\)/s);
});

test("long application pages expose an accessible scroll-to-top control", async () => {
  const [shell, styles] = await Promise.all([
    readFile(path.join(root, "components/app-shell.tsx"), "utf8"),
    readFile(path.join(root, "app/globals.css"), "utf8"),
  ]);

  assert.match(shell, /scrollContainer\.scrollHeight > scrollContainer\.clientHeight \* 1\.5/);
  assert.match(shell, /scrollContainer\.scrollTop > revealOffset/);
  assert.match(shell, /bodyScrollRef\.current\?\.scrollTo\(\{ top: 0, behavior: getMotionSafeScrollBehavior\(\) \}\)/);
  assert.match(shell, /aria-label="Scroll to top"/);
  assert.match(shell, /tabIndex=\{showScrollToTop \? 0 : -1\}/);
  assert.match(styles, /\.scroll-to-top-button\s*\{[^}]*position:\s*fixed[^}]*width:\s*44px[^}]*height:\s*44px/s);
  assert.match(styles, /@media \(max-width: 768px\), \(max-width: 960px\) and \(max-height: 500px\) and \(pointer: coarse\)[\s\S]*?\.scroll-to-top-button\s*\{[^}]*bottom:\s*calc\(var\(--mobile-nav-height\) \+ 12px\)[^}]*left:/s);
  assert.match(styles, /html\[data-modal-scroll-lock="true"\] \.scroll-to-top-button/);
});

test("settings uses the shared typography and layout contract", async () => {
  const settings = await readFile(path.join(root, "components/settings-page.tsx"), "utf8");
  const styles = await readFile(path.join(root, "app/globals.css"), "utf8");
  const layout = await readFile(path.join(root, "app/layout.tsx"), "utf8");
  const appAccess = await readFile(path.join(root, "components/settings-app-access.tsx"), "utf8");
  const settingsStart = styles.indexOf(".settings-card-block");
  const settingsEnd = styles.indexOf(".gmail-sync-progress {", settingsStart);
  const settingsContract = styles.slice(settingsStart, settingsEnd);

  assert.doesNotMatch(settings, /DeviceSettingsPanel|This Device/);
  assert.match(settings, /<SettingsAppAccess\s*\/>/);
  assert.match(appAccess, />Install Nest</);
  assert.match(appAccess, />Notifications</);
  assert.match(appAccess, /scheduled reminders for credit card payments that are due, plus workspace invitations/);
  assert.doesNotMatch(appAccess, /payment, receivable, invitation, and background-task alerts/);
  assert.match(appAccess, />Passkeys</);
  assert.match(settings, /className="st-header settings-accounts-header"/);
  assert.match(styles, /--font-display:\s*"DM Sans", sans-serif/);
  assert.match(styles, /--font-body:\s*"DM Sans", sans-serif/);
  assert.match(styles, /button,\s*\ninput,\s*\nselect,\s*\ntextarea\s*\{\s*\n\s*font:\s*inherit/);
  assert.doesNotMatch(layout, /Fraunces/);
  assert.match(styles, /\.st-container\s*\{[^}]*width:\s*min\(100%, 1080px\)[^}]*gap:\s*16px/s);
  assert.match(settingsContract, /\.settings-section-title\s*\{[^}]*font-size:\s*var\(--text-xl\)/s);
  assert.match(settingsContract, /@media\s*\(max-width:\s*768px\)[\s\S]*?\.settings-card-block \.btn\s*\{[^}]*width:\s*100%[^}]*min-height:\s*44px/s);
  assert.match(settingsContract, /\.settings-public-url-row\s*\{[^}]*grid-template-columns:\s*1fr/s);
});

test("settings keeps a compact continuous layout", async () => {
  const [settings, styles] = await Promise.all([
    readFile(path.join(root, "components/settings-page.tsx"), "utf8"),
    readFile(path.join(root, "app/globals.css"), "utf8"),
  ]);

  assert.match(settings, /Access &amp; connections/);
  assert.match(settings, /Workspace preferences/);
  assert.match(settings, /Automation/);
  assert.match(settings, /Data tools/);
  assert.match(settings, /Bank accounts/);
  assert.doesNotMatch(settings, /role="tablist"|activeSettingsTab|settings-tab/);
  assert.doesNotMatch(styles, /\.settings-tab/);
  assert.match(styles, /@media \(max-width: 768px\)[\s\S]*?\.settings-card-block \{\s*padding: 14px/s);
  assert.match(styles, /\.st-container \.st-grid[\s\S]*?gap: 10px/s);
});

test("Gmail sync uses one responsive status surface", async () => {
  const [settings, styles, summary] = await Promise.all([
    readFile(path.join(root, "components/settings-page.tsx"), "utf8"),
    readFile(path.join(root, "app/globals.css"), "utf8"),
    readFile(path.join(root, "lib/gmail-sync-summary.ts"), "utf8"),
  ]);

  assert.match(settings, /const isGmailSyncActive = Boolean/);
  assert.match(settings, /\{isGmailSyncActive && gmailSyncProgress \?/);
  assert.match(settings, /\{!isGmailSyncActive && gmailNotice \?/);
  assert.doesNotMatch(settings, /gmailMessage \? <div className="settings-message settings-message-spaced"/);
  assert.match(settings, /className="gmail-sync-progress-header"/);
  assert.match(settings, /className=\{`gmail-sync-notice is-\$\{gmailNotice\.tone\}`\}/);
  assert.match(styles, /\.gmail-sync-progress-header\s*\{[^}]*grid-template-columns:\s*auto minmax\(0, 1fr\) auto/s);
  assert.match(styles, /@media \(max-width: 768px\)[\s\S]*?\.gmail-sync-notice-copy\s*\{[^}]*display:\s*grid/s);
  assert.match(summary, /Inbox is up to date\. No new card alert emails were found\./);
  assert.doesNotMatch(summary, /Synced \$\{data\.scannedMessages\} emails/);
  assert.match(settings, /!\/\\b0 failed\\b\/i\.test\(normalized\)/);
});

test("transaction groups use compact two-row cards and a searchable picker", async () => {
  const transactions = await readFile(path.join(root, "components/transactions-page.tsx"), "utf8");
  const styles = await readFile(path.join(root, "app/globals.css"), "utf8");

  assert.match(transactions, /className="tx-group-card-copy"[\s\S]*?<strong>\{group\.name\}<\/strong>/);
  assert.doesNotMatch(transactions, /\{group\.transactionCount\}/);
  assert.match(transactions, /className="tx-group-count"[\s\S]*?×\{visibleTransactionGroups\.length\}/);
  assert.match(transactions, /className="tx-group-picker-popover"[\s\S]*?placeholder="Search groups…"/);
  assert.match(transactions, /className="tx-group-cards" ref=\{transactionGroupCardsRef\}/);
  assert.match(transactions, /data-group-id=\{group\.id\}/);
  assert.match(transactions, /onClick=\{\(\) => selectTransactionGroupFromPicker\(group\.id\)\}/);
  assert.match(transactions, /formatTransactionGroupDateRange\([\s\S]*?group\.firstTransactionDate,[\s\S]*?group\.lastTransactionDate/);
  assert.match(transactions, /const searchableValue = normalizeTransactionGroupSearchValue\(`\$\{group\.name\} \$\{dateRange\}`\)/);
  assert.match(transactions, /className="tx-group-picker-option-range" title=\{transactionDateRange\}/);
  assert.match(styles, /\.tx-group-count\s*\{[^}]*position:\s*absolute[^}]*right:\s*-7px[^}]*bottom:\s*-3px/s);
  assert.match(styles, /\.tx-group-picker-trigger\s*\{[^}]*min-inline-size:\s*28px[^}]*min-block-size:\s*28px[^}]*padding:\s*0/s);
  assert.match(styles, /\.tx-group-picker-trigger::before\s*\{[^}]*inset:\s*-8px/s);
  assert.match(styles, /\.tx-group-picker-popover\s*\{[^}]*max-height:\s*min\(55dvh, 420px\)[^}]*overflow:\s*hidden/s);
  assert.match(styles, /\.tx-group-picker-options\s*\{[^}]*max-height:\s*min\(45dvh, 340px\)[^}]*overflow-y:\s*auto/s);
  assert.match(styles, /\.tx-group-card\s*\{[^}]*grid-template-columns:\s*auto max-content 22px[^}]*grid-template-rows:\s*auto auto[^}]*width:\s*max-content[^}]*flex:\s*0 0 auto/s);
  assert.match(styles, /\.tx-group-card-icon\s*\{[^}]*grid-row:\s*1 \/ 3/s);
  assert.match(styles, /\.tx-group-card-copy\s*\{[^}]*grid-row:\s*1/s);
  assert.match(styles, /\.tx-group-card-total\s*\{[^}]*grid-row:\s*2/s);
  assert.match(styles, /\.tx-group-card-copy strong\s*\{[^}]*overflow:\s*visible[^}]*text-overflow:\s*clip/s);
  assert.match(styles, /\.tx-group-card-edit\s*\{[^}]*position:\s*static[^}]*grid-row:\s*1 \/ 3[^}]*min-block-size:\s*22px[^}]*transform:\s*none/s);
});

test("mobile quality uses the Phase 4 accessibility and performance contract", async () => {
  const styles = await readFile(path.join(root, "app/globals.css"), "utf8");
  const shell = await readFile(path.join(root, "components/app-shell.tsx"), "utf8");
  const transactions = await readFile(path.join(root, "components/transactions-page.tsx"), "utf8");
  const creditTransactions = await readFile(path.join(root, "components/credit-transactions-page.tsx"), "utf8");
  const modalManager = await readFile(path.join(root, "components/modal-viewport-manager.tsx"), "utf8");
  const navigationLoader = await readFile(path.join(root, "components/navigation-loader.tsx"), "utf8");
  const investments = await readFile(path.join(root, "components/investments-page.tsx"), "utf8");
  const motion = await readFile(path.join(root, "lib/motion.ts"), "utf8");
  const layout = await readFile(path.join(root, "app/layout.tsx"), "utf8");
  const settings = await readFile(path.join(root, "components/settings-page.tsx"), "utf8");

  assert.match(styles, /--touch-target-min:\s*44px/);
  assert.match(styles, /@media\s*\(max-width:\s*768px\),\s*\(max-width:\s*960px\) and \(max-height:\s*500px\) and \(pointer:\s*coarse\)[\s\S]*?\.mobile-bottom-nav\s*\{[^}]*display:\s*flex/s);
  assert.match(styles, /@media\s*\(max-width:\s*960px\) and \(max-height:\s*500px\) and \(pointer:\s*coarse\)[\s\S]*?\.mobile-more-links\s*\{[^}]*grid-template-columns:\s*repeat\(2/);
  assert.match(styles, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?animation-duration:\s*0\.01ms\s*!important/);
  assert.match(styles, /\.body\s*\{[^}]*min-height:\s*0[^}]*overscroll-behavior-y:\s*contain/s);
  assert.match(shell, /className="skip-link" href="#main-content"/);
  assert.match(shell, /id="main-content" tabIndex=\{-1\}/);
  assert.match(shell, /aria-controls="mobile-more-menu"/);
  assert.match(transactions, /className="budget-mini budget-mini-compact tx-account-card"[\s\S]*?role="button"[\s\S]*?aria-pressed=/);
  assert.match(modalManager, /legacyModal\.setAttribute\("aria-labelledby", heading\.id\)/);
  assert.match(navigationLoader, /performance\.measure\(ROUTE_MEASURE/);
  assert.match(navigationLoader, /nest:route-performance/);
  assert.doesNotMatch(navigationLoader, /navigation-loader-spinner/);
  assert.doesNotMatch(styles, /\.navigation-loader-spinner/);
  assert.doesNotMatch(navigationLoader, /Math\.random|setTimeout\([^)]*600/);
  assert.doesNotMatch(investments, /mobile-primary-create/);
  assert.doesNotMatch(investments, /Investment accounts|tracked accounts?/);
  assert.match(investments, /className="card inv-portfolio-card"/);
  assert.match(investments, /className="card inv-view-toggle"/);
  assert.doesNotMatch(investments, /style=\{\{ padding: "24px" \}\}/);
  assert.match(styles, /\.card\.inv-portfolio-card\s*\{[^}]*padding:\s*18px 20px/s);
  assert.match(styles, /@media\s*\(max-width:\s*720px\)[\s\S]*?\.inv-page\s*\{[^}]*gap:\s*8px[\s\S]*?\.card\.inv-portfolio-card,[\s\S]*?padding:\s*12px/s);
  assert.match(styles, /\.card\.inv-account-card\s*\{[^}]*padding:\s*10px 10px 8px/s);
  assert.match(investments, /className="inv-account-create-row"[\s\S]*?className="btn btn-ghost btn-sm inv-add-account-btn"/);
  assert.match(investments, /const currentValueDifference = \(b\.latest\?\.currentValueCents \?\? 0\) - \(a\.latest\?\.currentValueCents \?\? 0\)/);
  assert.match(investments, /compact:\s*`[^`]*\$\{year\.slice\(-2\)\}`/);
  assert.match(investments, /data-compact-label=\{inceptionBadge\.compact\}/);
  assert.doesNotMatch(investments, /inv-inception-label-(?:full|short)/);
  assert.match(investments, /className=\{`inv-account-liquidity-status \$\{account\.isLiquid \? "is-liquid" : "is-locked"\}`\}/);
  assert.match(investments, /account\.isLiquid[\s\S]*?\? <Droplet[\s\S]*?: <Lock/);
  assert.doesNotMatch(investments, /inv-liquid-chip/);
  assert.match(styles, /@media\s*\(max-width:\s*720px\)[\s\S]*?\.inv-account-actions\s*\{[^}]*gap:\s*4px/s);
  assert.match(styles, /\.inv-inception-chip::after\s*\{[^}]*content:\s*attr\(data-compact-label\)[^}]*font-size:\s*11px/s);
  assert.match(styles, /\.inv-edit-icon\s*\{[^}]*min-inline-size:\s*22px[^}]*min-block-size:\s*22px/s);
  assert.match(styles, /\.inv-edit-icon::before\s*\{[^}]*inset:\s*-11px/s);
  assert.match(styles, /\.inv-account-title-row\s*\{[^}]*padding-right:\s*28px/s);
  assert.match(styles, /\.inv-account-subtitle\s*\{[^}]*display:\s*block[^}]*width:\s*100%/s);
  assert.match(styles, /\.inv-liquidity-toggle\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)[^}]*height:\s*44px/s);
  assert.match(styles, /\.inv-liquidity-toggle \.inv-liquidity-toggle-btn\s*\{[^}]*height:\s*36px[^}]*min-block-size:\s*36px/s);
  assert.doesNotMatch(styles, /\.inv-liquid-chip\s*\{/);
  assert.match(motion, /prefers-reduced-motion:\s*reduce/);
  assert.doesNotMatch(`${transactions}\n${creditTransactions}`, /behavior:\s*"smooth"/);
  assert.match(layout, /<SpeedInsights\s*\/>/);
  assert.match(settings, /credit-txn-auto-rules-config/);
  assert.doesNotMatch(settings, /from "@\/lib\/credit-txn-auto-rules"/);
});

test("core mobile workflows use the Phase 2 interaction contract", async () => {
  const styles = await readFile(path.join(root, "app/globals.css"), "utf8");
  const providers = await readFile(path.join(root, "app/providers.tsx"), "utf8");
  const workflowManager = await readFile(path.join(root, "components/mobile-workflow-manager.tsx"), "utf8");
  const sessionState = await readFile(path.join(root, "lib/use-session-state.ts"), "utf8");
  const creditTransactions = await readFile(path.join(root, "components/credit-transactions-page.tsx"), "utf8");

  assert.match(styles, /\.mobile-primary-create\s*\{[\s\S]*?position:\s*fixed\s*!important[\s\S]*?bottom:\s*calc\(70px \+ var\(--mobile-nav-safe-bottom\)\)[\s\S]*?width:\s*48px\s*!important[\s\S]*?min-height:\s*48px\s*!important/);
  assert.match(styles, /body\s+:is\([\s\S]*?\.modal-container[\s\S]*?\.inv-modal[\s\S]*?\)\[class\]\s*\{[\s\S]*?width:\s*calc\(100vw - 10px\)\s*!important[\s\S]*?height:\s*auto\s*!important[\s\S]*?max-height:\s*calc\(100dvh - 10px\)\s*!important/);
  assert.match(styles, /\.btn:active:not\(:disabled\)[\s\S]*?transform:\s*scale\(0\.97\)/);
  assert.match(styles, /\.mutation-feedback\.is-success/);
  assert.match(providers, /<MobileWorkflowManager\s*\/>/);
  assert.match(workflowManager, /window\.history\.scrollRestoration\s*=\s*"manual"/);
  assert.match(sessionState, /window\.sessionStorage\.setItem/);
  assert.match(creditTransactions, /className="cct-mobile-period-selectors"/);
  assert.match(creditTransactions, /className="btn btn-primary mobile-primary-create"/);
  assert.match(creditTransactions, /<Plus size=\{18\} aria-hidden="true"\s*\/>[\s\S]*?mobile-primary-create-label/);
});
