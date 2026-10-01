"use client";

import { useMutation } from "@tanstack/react-query";
import { Check, RotateCcw, Save, ShieldCheck } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { getAgentDefinition, type AgentConfiguration, type AgentSettings } from "@/lib/ai/agent-catalog";
import { AgentSettingsSchema, type AgentDetail } from "@/lib/ai/agent-contracts";
import { AGENT_PROMPT_VERSION } from "@/lib/ai/agent-instructions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/controls";
import { SelectField, TextAreaField, TextField } from "@/components/ui/form-field";
import { useToast } from "@/components/toast-provider";

export type AgentSettingsDraft = { settings: AgentSettings; revision: number };

export function AgentSettingsEditor({ detail, model, draft, onDraftChange, onSaved, onChanged }: {
  detail: AgentDetail; model: string | null; draft?: AgentSettingsDraft;
  onDraftChange: (draft: AgentSettingsDraft | undefined) => void;
  onSaved: (submitted: AgentSettingsDraft, revision: number) => void;
  onChanged: () => Promise<void>;
}) {
  const definition = getAgentDefinition(detail.configuration.id);
  const settings = draft?.settings ?? AgentSettingsSchema.strip().parse(detail.configuration);
  const setSettings = (next: AgentSettings) => onDraftChange({ settings: next, revision: draft?.revision ?? detail.configuration.revision });
  const toast = useToast();
  const change = <K extends keyof AgentSettings>(key: K, value: AgentSettings[K]) => setSettings({ ...settings, [key]: value });
  const save = useMutation({
    mutationFn: (submitted: AgentSettingsDraft) => apiFetch<AgentConfiguration>(`/api/admin/agents/${definition.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...submitted.settings, revision: submitted.revision }) }),
    onSuccess: async (saved, submitted) => { await onChanged(); onSaved(submitted, saved.revision); toast.success("Agent configuration saved. New requests use these settings."); },
  });
  const dirty = JSON.stringify(settings) !== JSON.stringify(AgentSettingsSchema.strip().parse(detail.configuration));
  const stale = draft && draft.revision !== detail.configuration.revision;
  return (
    <form className="agent-settings-form" onSubmit={(event) => { event.preventDefault(); if (draft) save.mutate(draft); }}>
      <div className="agent-panel-heading">
        <div><h3>Configuration</h3><p>Set how this agent works across Nest.</p></div>
        <label className="agent-enabled-control"><Input type="checkbox" role="switch" checked={settings.enabled} onChange={(event) => change("enabled", event.target.checked)} />{settings.enabled ? "Agent enabled" : "Agent paused"}</label>
      </div>
      <TextAreaField label="Instructions" hint="Define priorities, decision rules, local terminology, and the response you expect. Nest adds its core workflow and financial protections to every request." rows={14} maxLength={12_000} value={settings.instructions} onChange={(event) => change("instructions", event.target.value)} />
      <div className="agent-form-footer"><span>Recommended prompt · {AGENT_PROMPT_VERSION}</span><Button variant="ghost" size="sm" disabled={save.isPending || settings.instructions === definition.defaults.instructions} onClick={() => change("instructions", definition.defaults.instructions)}><RotateCcw size={14} aria-hidden="true" />Use recommended instructions</Button></div>
      <div className="agent-fields-grid">
        <TextField label="Model deployment" placeholder={model || "Use the default deployment"} hint="Leave blank to use the shared model. Fine-tuned models need an Azure deployment name." value={settings.deployment ?? ""} maxLength={200} onChange={(event) => change("deployment", event.target.value || null)} />
        <SelectField label="Reasoning effort" hint="The selected deployment must support this setting." value={settings.reasoningEffort} onChange={(event) => change("reasoningEffort", event.target.value as AgentSettings["reasoningEffort"])}>
          <option value="default">Model default</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
        </SelectField>
        <TextField label="Response token allowance" type="number" min={512} max={16_000} step={1} required value={settings.maxOutputTokens} onChange={(event) => change("maxOutputTokens", Number(event.target.value))} />
        <TextField label="Training examples per request" type="number" min={0} max={8} step={1} required hint="Relevant approved examples guide each response. Set 0 to turn this off." value={settings.trainingExampleLimit} onChange={(event) => change("trainingExampleLimit", Number(event.target.value))} />
        {definition.id === "ask-nest" ? <>
          <TextField label="Maximum lookup rounds" type="number" min={1} max={12} step={1} required value={settings.maxToolRounds} onChange={(event) => change("maxToolRounds", Number(event.target.value))} />
          <TextField label="Maximum data lookups" type="number" min={settings.maxToolRounds} max={32} step={1} required value={settings.maxToolCalls} onChange={(event) => change("maxToolCalls", Number(event.target.value))} />
        </> : null}
      </div>
      <fieldset className="agent-capabilities"><legend>Capabilities</legend><p>Choose which capabilities this agent can use.</p>
        <div className="agent-capability-grid">{definition.capabilities.map((capability) => <label className="agent-capability" key={capability.id}>
          <Input type="checkbox" checked={settings.capabilities.includes(capability.id)} onChange={(event) => change("capabilities", event.target.checked ? [...settings.capabilities, capability.id] : settings.capabilities.filter((id) => id !== capability.id))} />
          <span><strong>{capability.name}</strong><small>{capability.description}</small></span>
        </label>)}</div>
      </fieldset>
      <div className="agent-guardrails"><ShieldCheck size={18} aria-hidden="true" /><div><strong>Built-in protections</strong><ul>{definition.guardrails.map((rule) => <li key={rule}><Check size={13} aria-hidden="true" />{rule}</li>)}</ul></div></div>
      {save.error ? <p className="agent-error" role="alert">{save.error.message}</p> : null}
      {stale ? <p className="agent-note">The saved agent changed while you were editing. Your changes are preserved. Reload saved settings to review the latest revision before saving.</p> : null}
      <div className="agent-form-footer"><span>{dirty ? "Unsaved changes" : `Saved configuration · revision ${detail.configuration.revision}`}</span><div className="agent-row-actions">{draft ? <Button variant="ghost" disabled={save.isPending} onClick={() => { onDraftChange(undefined); save.reset(); }}>Reload saved settings</Button> : null}<Button variant="primary" type="submit" loading={save.isPending} disabled={!dirty || Boolean(stale)}><Save size={16} aria-hidden="true" />Save configuration</Button></div></div>
      {detail.revisions.length ? <details className="agent-history"><summary>Configuration history</summary><div className="agent-history-list">{detail.revisions.map((revision) => <div key={revision.revision}>
        <span>Revision {revision.revision}<small>{revision.action.replaceAll("_", " ").toLowerCase()} · {new Date(revision.createdAt).toLocaleString("en-SG")}</small></span>
        {revision.action === "CONFIGURATION" && revision.revision !== detail.configuration.revision ? <Button variant="ghost" size="sm" onClick={() => setSettings(revision.settings)}><RotateCcw size={14} aria-hidden="true" />Load settings</Button> : null}
      </div>)}</div></details> : null}
    </form>
  );
}
