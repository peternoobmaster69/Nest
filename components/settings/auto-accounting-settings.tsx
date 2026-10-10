"use client";

import { useId } from "react";
import dynamic from "next/dynamic";
import { ArrowRight, Play, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/controls";
import { EmptyState } from "@/components/ui-skeleton";
import { SettingsAutoRulesSkeleton } from "@/components/skeletons/SettingsSkeleton";
import { SettingsOperationNotice } from "./operation-notice";
import type { AutoRule } from "./auto-rule-editor-dialog";
import type { useAutoRuleSettings } from "@/hooks/use-auto-rule-settings";

const AutoRuleEditorDialog = dynamic(
  () => import("./auto-rule-editor-dialog").then((module) => module.AutoRuleEditorDialog),
  { ssr: false },
);
type Controller = ReturnType<typeof useAutoRuleSettings>;

function AutoRuleCard({ rule, index, controller }: Readonly<{ rule: AutoRule; index: number; controller: Controller }>) {
  const titleId = useId();
  return (
    <div className={`auto-rule-card ${rule.enabled ? "" : "is-disabled"}`}>
      <div className="auto-rule-summary">
        <Button className="auto-rule-open-button" aria-labelledby={titleId} onClick={() => controller.openRuleEditor(rule)} disabled={controller.isBusy} />
        <span className="auto-rule-number">{index + 1}</span>
        <span className="auto-rule-main">
          <span className="auto-rule-title-row">
            <span id={titleId} className="auto-rule-title">{rule.name || `Rule ${index + 1}`}</span>
            {!rule.enabled ? <span className="auto-rule-muted-pill">Paused</span> : null}
          </span>
          <span className="auto-rule-flow" aria-label="Rule summary">
            <span className="auto-rule-chip auto-rule-chip-filter">{rule.filters[0] || "No keyword"}</span>
            {rule.filters.length > 1 ? <span className="auto-rule-more">+{rule.filters.length - 1}</span> : null}
            <ArrowRight size={16} aria-hidden="true" />
            <span className="auto-rule-chip auto-rule-chip-action">{controller.getRuleActionLabel(rule)}</span>
            <span className="auto-rule-separator">·</span>
            <span className="auto-rule-chip auto-rule-chip-target">{controller.getRuleTargetLabel(rule)}</span>
          </span>
        </span>
        <span className="auto-rule-summary-actions">
          <label className="auto-rule-switch" aria-label={`${rule.name} enabled`}>
            <Input type="checkbox" checked={rule.enabled} disabled={controller.isBusy}
              onChange={(event) => controller.toggleRuleEnabled(rule.id, event.target.checked)} />
            <span />
          </label>
        </span>
      </div>
    </div>
  );
}

function AutoRulesContent({ controller }: Readonly<{ controller: Controller }>) {
  if (controller.autoRules.isLoading) return <SettingsAutoRulesSkeleton />;
  if (controller.autoRules.isError) return <EmptyState icon="⚠️" title="Failed to load auto-accounting rules" description="Refresh the page and try again." />;
  return (
    <div className="auto-rules-shell">
      <div className="auto-rules-stack">
        {controller.ruleDrafts.map((rule, index) => <AutoRuleCard key={rule.id} rule={rule} index={index} controller={controller} />)}
      </div>
      <div className="auto-rule-footer">
        <Button className="btn btn-ghost btn-xs" onClick={controller.addRule} disabled={!controller.workspaceId || controller.isBusy}>
          <Plus size={14} aria-hidden="true" /> Add Rule
        </Button>
      </div>
    </div>
  );
}

function AutoAccountingEditor({ controller, baseCurrency }: Readonly<{ controller: Controller; baseCurrency: string }>) {
  const { editingAutoRule } = controller;
  if (!editingAutoRule) return null;
  return (
    <AutoRuleEditorDialog
      rule={editingAutoRule}
      displayIndex={controller.editingDisplayIndex}
      ruleIndex={controller.editingRuleIndex}
      ruleCount={controller.ruleDrafts.length}
      workspaceId={controller.workspaceId}
      baseCurrency={baseCurrency}
      workspaces={controller.workspaces}
      sameWorkspaceBudgets={controller.sameWorkspaceBudgets}
      sourceAccounts={controller.sourceAccounts}
      sourceBudgets={controller.sourceBudgets}
      defaultDestination={controller.defaultDestination}
      keywordInput={controller.keywordInput}
      actionLabel={controller.getRuleActionLabel(editingAutoRule)}
      targetLabel={controller.getRuleTargetLabel(editingAutoRule)}
      isSaving={controller.isBusy}
      notice={controller.autoRuleNotice}
      requiresReauthentication={controller.autoRuleRequiresReauthentication}
      onUpdate={controller.updateEditingRule}
      onKeywordInputChange={controller.setKeywordInput}
      onAddFilter={controller.addRuleFilter}
      onRemoveFilter={controller.removeRuleFilter}
      onMove={(direction) => controller.moveRule(editingAutoRule.id, direction)}
      onDelete={() => controller.removeRule(editingAutoRule.id)}
      onClose={controller.closeRuleEditor}
      onSave={controller.saveEditingRule}
      getDefaultSourceBudgetId={controller.getDefaultSourceBudgetId}
    />
  );
}

export function AutoAccountingSettings({ controller, baseCurrency }: Readonly<{ controller: Controller; baseCurrency: string }>) {
  const { autoRuleNotice, autoRuleRequiresReauthentication } = controller;
  return (
    <>
      <div className="card settings-card-block">
        <div className="settings-auto-header">
          <div className="settings-auto-copy">
            <div className="settings-section-title">Credit Card Auto Accounting</div>
            <div className="settings-section-copy settings-auto-description">
              Each rule checks if its keyword appears anywhere in the transaction subject (not case-sensitive). Rules are checked in order, and the first one that matches is used.
              Matched transactions are automatically accounted once a day.
            </div>
          </div>
          <div className="settings-auto-actions">
            <Button className="btn btn-ghost btn-xs" onClick={controller.resetRules} disabled={controller.isBusy || !controller.canReset}>
              <RotateCcw size={14} aria-hidden="true" /> Reset
            </Button>
            <Button className="btn btn-ghost btn-xs" onClick={controller.runRules} disabled={!controller.workspaceId || controller.isBusy}>
              <Play size={14} aria-hidden="true" />
              {controller.isRunning ? "Running..." : "Run Now"}
            </Button>
          </div>
        </div>
        {!controller.editingAutoRule ? (
          <SettingsOperationNotice notice={autoRuleNotice} className="settings-auto-notice" requiresReauthentication={autoRuleRequiresReauthentication} />
        ) : null}
        <AutoRulesContent controller={controller} />
      </div>
      <AutoAccountingEditor controller={controller} baseCurrency={baseCurrency} />
    </>
  );
}
