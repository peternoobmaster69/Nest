"use client";

import { ArrowRight, ChevronDown, ChevronUp, Plus, Save, Trash2, X } from "lucide-react";

import { useMoneyFormat } from "@/lib/use-money-format";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/controls";
import { Dialog } from "@/components/ui/dialog";
import { ModalCloseButton } from "@/components/ui/modal-close-button";
import { SettingsOperationNotice, type SettingsOperationNoticeData } from "./operation-notice";

export type AutoRule =
  | {
      id: string;
      name: string;
      enabled: boolean;
      action: "DEDUCT_SAME_WORKSPACE";
      filters: string[];
      sourceBudgetId: string;
      destinationAccountId?: string;
      destinationBudgetId: string;
    }
  | {
      id: string;
      name: string;
      enabled: boolean;
      action: "RECEIVABLE_OTHER_WORKSPACE";
      filters: string[];
      sourceWorkspaceId: string;
      sourceAccountId: string;
      sourceBudgetId: string;
    };

type WorkspaceOption = { id: string; name: string };
type AccountOption = { id: string; name: string };
type BudgetOption = { id: string; name: string; receivableReservedCents?: number };

type AutoRuleEditorDialogProps = {
  rule: AutoRule;
  displayIndex: number;
  ruleIndex: number;
  ruleCount: number;
  workspaceId: string | null;
  baseCurrency: string;
  workspaces: WorkspaceOption[];
  sameWorkspaceBudgets: BudgetOption[];
  sourceAccounts: AccountOption[];
  sourceBudgets: BudgetOption[];
  defaultDestination: { sourceBudgetId: string; destinationBudgetId: string };
  keywordInput: string;
  actionLabel: string;
  targetLabel: string;
  isSaving: boolean;
  notice?: SettingsOperationNoticeData | null;
  requiresReauthentication?: boolean;
  onUpdate: (updater: (rule: AutoRule) => AutoRule) => void;
  onKeywordInputChange: (value: string) => void;
  onAddFilter: () => void;
  onRemoveFilter: (index: number) => void;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
  onClose: () => void;
  onSave: () => void;
  getDefaultSourceBudgetId: (sourceWorkspaceId: string, accountId: string) => string;
};

export function AutoRuleEditorDialog({
  rule,
  displayIndex,
  ruleIndex,
  ruleCount,
  workspaceId,
  baseCurrency,
  workspaces,
  sameWorkspaceBudgets,
  sourceAccounts,
  sourceBudgets,
  defaultDestination,
  keywordInput,
  actionLabel,
  targetLabel,
  isSaving,
  notice = null,
  requiresReauthentication = false,
  onUpdate,
  onKeywordInputChange,
  onAddFilter,
  onRemoveFilter,
  onMove,
  onDelete,
  onClose,
  onSave,
  getDefaultSourceBudgetId,
}: Readonly<AutoRuleEditorDialogProps>) {
  const { format: formatMoney } = useMoneyFormat(baseCurrency);
  return (
    <Dialog open onClose={onClose} closeDisabled={isSaving} title="Edit auto-accounting rule" surface="custom" overlayClassName="auto-rule-modal-overlay">
      <dialog open className="auto-rule-modal" aria-modal="true" aria-labelledby="auto-rule-modal-title">
        <div className="auto-rule-modal-header">
          <div className="auto-rule-modal-title-wrap">
            <span className="auto-rule-number">{displayIndex}</span>
            <div>
              <h3 id="auto-rule-modal-title">Edit Auto Accounting Rule</h3>
              <p>{rule.name || `Rule ${displayIndex}`}</p>
            </div>
          </div>
          <ModalCloseButton onClick={onClose} label="Close Edit Auto Accounting Rule" disabled={isSaving} />
        </div>

        <div className="auto-rule-modal-body">
          <SettingsOperationNotice notice={notice} requiresReauthentication={requiresReauthentication} className="settings-auto-notice" />
          <div className="auto-rule-editor-hero">
            <div className="auto-rule-hero-step">
              <span>Subject</span>
              <strong>{rule.filters[0] || "Add keyword"}</strong>
            </div>
            <ArrowRight className="auto-rule-hero-arrow" size={22} aria-hidden="true" />
            <div className="auto-rule-hero-step">
              <span>Action</span>
              <strong>{actionLabel}</strong>
            </div>
            <ArrowRight className="auto-rule-hero-arrow" size={22} aria-hidden="true" />
            <div className="auto-rule-hero-step">
              <span>Posting</span>
              <strong>{targetLabel}</strong>
            </div>
          </div>

          <div className="auto-rule-editor-grid">
            <section className="auto-rule-edit-section">
              <label className="auto-rule-section-label" htmlFor="auto-rule-name">Rule Name</label>
              <Input
                id="auto-rule-name"
                className="input"
                type="text"
                value={rule.name}
                disabled={isSaving}
                onChange={(event) => {
                  const name = event.target.value;
                  onUpdate((current) => ({ ...current, name }));
                }}
              />
            </section>

            <section className="auto-rule-edit-section">
              <div className="auto-rule-section-label">Status</div>
              <label htmlFor="auto-rule-enabled" className="auto-rule-enable-row">
                <span>Rule is active</span>
                <span className="auto-rule-switch">
                  <Input id="auto-rule-enabled"
                    type="checkbox"
                    checked={rule.enabled}
                    disabled={isSaving}
                    onChange={(event) => {
                      const enabled = event.target.checked;
                      onUpdate((current) => ({ ...current, enabled }));
                    }}
                  />
                  <span />
                </span>
              </label>
            </section>

            <section className="auto-rule-edit-section auto-rule-span">
              <label className="auto-rule-section-label" htmlFor="auto-rule-action">Action</label>
              <div className="auto-rule-action-row">
                <span className="auto-rule-action-cue">
                  <ArrowRight size={17} aria-hidden="true" />
                  When matched
                  <ArrowRight size={17} aria-hidden="true" />
                </span>
                <Select
                  id="auto-rule-action"
                  className="input"
                  value={rule.action}
                  disabled={isSaving}
                  onChange={(event) => {
                    const action = event.target.value;
                    onUpdate((current) =>
                      action === "DEDUCT_SAME_WORKSPACE"
                        ? {
                            id: current.id,
                            name: current.name,
                            enabled: current.enabled,
                            action: "DEDUCT_SAME_WORKSPACE",
                            filters: current.filters,
                            sourceBudgetId: defaultDestination.sourceBudgetId,
                            destinationBudgetId: defaultDestination.destinationBudgetId,
                          }
                        : {
                            id: current.id,
                            name: current.name,
                            enabled: current.enabled,
                            action: "RECEIVABLE_OTHER_WORKSPACE",
                            filters: current.filters,
                            sourceWorkspaceId: workspaces.find((workspace) => workspace.id !== workspaceId)?.id ?? "",
                            sourceAccountId: "",
                            sourceBudgetId: "",
                          },
                    );
                  }}
                >
                  <option value="DEDUCT_SAME_WORKSPACE">Transfer between same-workspace sub accounts</option>
                  <option value="RECEIVABLE_OTHER_WORKSPACE">Create receivable from another workspace</option>
                </Select>
              </div>
            </section>

            <section className="auto-rule-edit-section auto-rule-span">
              <div className="auto-rule-section-divider"><span>Subject Filters</span></div>
              <div className="auto-rule-keyword-box">
                <div className="auto-rule-keywords">
                  {rule.filters.map((filter, index) => (
                    <span key={`${filter}-${index}`} className="auto-rule-keyword">
                      {filter}
                      <Button type="button" onClick={() => onRemoveFilter(index)} aria-label={`Remove ${filter}`} disabled={isSaving}>
                        <X size={14} aria-hidden="true" />
                      </Button>
                    </span>
                  ))}
                </div>
                <div className="auto-rule-add-keyword">
                  <Input
                    className="input"
                    type="text"
                    value={keywordInput}
                    disabled={isSaving}
                    aria-label="Subject keyword"
                    onChange={(event) => onKeywordInputChange(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return;
                      event.preventDefault();
                      onAddFilter();
                    }}
                    placeholder="Add keyword..."
                  />
                  <Button className="btn btn-ghost" type="button" onClick={onAddFilter} disabled={isSaving}>
                    <Plus size={15} aria-hidden="true" />
                    Add
                  </Button>
                </div>
                <div className="auto-rule-helper">Any line can match · case-insensitive</div>
              </div>
            </section>

            {rule.action === "DEDUCT_SAME_WORKSPACE" ? (
              <section className="auto-rule-edit-section auto-rule-span">
                <div className="auto-rule-section-divider"><span>Source and Destination</span></div>
                <div className="auto-rule-field-grid">
                  <label>
                    <span>Source Sub Account</span>
                    <Select
                      className="input"
                      value={rule.sourceBudgetId}
                      disabled={isSaving}
                      onChange={(event) => {
                        const sourceBudgetId = event.target.value;
                        onUpdate((current) => current.action === "DEDUCT_SAME_WORKSPACE"
                          ? { ...current, sourceBudgetId }
                          : current);
                      }}
                    >
                      <option value="">Select source sub account</option>
                      {sameWorkspaceBudgets.map((budget) => <option key={budget.id} value={budget.id}>{budget.name}</option>)}
                    </Select>
                  </label>
                  <label>
                    <span>Destination Sub Account</span>
                    <Select
                      className="input"
                      value={rule.destinationBudgetId}
                      disabled={isSaving}
                      onChange={(event) => {
                        const destinationBudgetId = event.target.value;
                        onUpdate((current) => current.action === "DEDUCT_SAME_WORKSPACE"
                          ? { ...current, destinationBudgetId }
                          : current);
                      }}
                    >
                      <option value="">Select sub account</option>
                      {sameWorkspaceBudgets.map((budget) => <option key={budget.id} value={budget.id}>{budget.name}</option>)}
                    </Select>
                  </label>
                </div>
              </section>
            ) : (
              <section className="auto-rule-edit-section auto-rule-span">
                <div className="auto-rule-section-divider"><span>Source</span></div>
                <div className="auto-rule-field-grid auto-rule-field-grid-three">
                  <label>
                    <span>Workspace</span>
                    <Select
                      className="input"
                      value={rule.sourceWorkspaceId}
                      disabled={isSaving}
                      onChange={(event) => {
                        const sourceWorkspaceId = event.target.value;
                        onUpdate((current) => current.action === "RECEIVABLE_OTHER_WORKSPACE"
                          ? { ...current, sourceWorkspaceId, sourceAccountId: "", sourceBudgetId: "" }
                          : current);
                      }}
                    >
                      <option value="">Select workspace</option>
                      {workspaces.filter((workspace) => workspace.id !== workspaceId).map((workspace) => (
                        <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
                      ))}
                    </Select>
                  </label>
                  <label>
                    <span>Bank Account</span>
                    <Select
                      className="input"
                      value={rule.sourceAccountId}
                      disabled={isSaving}
                      onChange={(event) => {
                        const accountId = event.target.value;
                        onUpdate((current) => current.action === "RECEIVABLE_OTHER_WORKSPACE"
                          ? {
                              ...current,
                              sourceAccountId: accountId,
                              sourceBudgetId: getDefaultSourceBudgetId(current.sourceWorkspaceId, accountId),
                            }
                          : current);
                      }}
                    >
                      <option value="">Select bank account</option>
                      {sourceAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                    </Select>
                  </label>
                  <label>
                    <span>Sub Account</span>
                    <Select
                      className="input"
                      value={rule.sourceBudgetId}
                      disabled={isSaving}
                      onChange={(event) => {
                        const sourceBudgetId = event.target.value;
                        onUpdate((current) => current.action === "RECEIVABLE_OTHER_WORKSPACE"
                          ? { ...current, sourceBudgetId }
                          : current);
                      }}
                    >
                      <option value="">Select sub account</option>
                      {sourceBudgets.map((budget) => (
                        <option key={budget.id} value={budget.id}>
                          {budget.name}
                          {budget.receivableReservedCents ? ` (${formatMoney(budget.receivableReservedCents, baseCurrency)})` : ""}
                        </option>
                      ))}
                    </Select>
                  </label>
                </div>
                <div className="auto-rule-helper">Open receivables earmarked against the selected source sub account are shown in brackets.</div>
              </section>
            )}
          </div>
        </div>

        <div className="auto-rule-modal-footer">
          <div className="auto-rule-order-actions">
            <Button className="btn btn-ghost" type="button" onClick={() => onMove(-1)} disabled={ruleIndex <= 0 || isSaving}>
              <ChevronUp size={15} aria-hidden="true" />
              Move up
            </Button>
            <Button className="btn btn-ghost" type="button" onClick={() => onMove(1)} disabled={ruleIndex < 0 || ruleIndex >= ruleCount - 1 || isSaving}>
              <ChevronDown size={15} aria-hidden="true" />
              Move down
            </Button>
            <Button className="btn btn-ghost" type="button" onClick={onDelete} disabled={isSaving}>
              <Trash2 size={15} aria-hidden="true" />
              Delete rule
            </Button>
          </div>
          <div className="auto-rule-modal-actions">
            <Button className="btn btn-ghost" type="button" onClick={onClose} disabled={isSaving}>Cancel</Button>
            <Button className="btn btn-primary" type="button" onClick={onSave} disabled={!workspaceId || isSaving}>
              <Save size={15} aria-hidden="true" />
              {isSaving ? "Saving..." : "Save Rule"}
            </Button>
          </div>
        </div>
      </dialog>
    </Dialog>
  );
}
