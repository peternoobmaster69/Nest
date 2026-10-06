"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { BookOpen, Pencil, Plus, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import type { AgentDetail, AgentExample, AgentExampleInput } from "@/lib/ai/agent-contracts";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { SelectField, TextAreaField, TextField } from "@/components/ui/form-field";
import { EmptyState } from "@/components/ui/query-state";
import { AdminPagination, useAdminPagination } from "@/components/admin-pagination";
import { useToast } from "@/components/toast-provider";

const emptyExample = (): AgentExampleInput => ({ title: "", input: "", expectedOutput: "", contextJson: "{}", purpose: "TRAINING", status: "DRAFT", matchMode: "CONTAINS" });

export function AgentExamples({ detail, onChanged }: Readonly<{ detail: AgentDetail; onChanged: () => Promise<void> }>) {
  const [editing, setEditing] = useState<AgentExample | "new" | null>(null);
  const [form, setForm] = useState<AgentExampleInput>(emptyExample);
  const [deleting, setDeleting] = useState<AgentExample | null>(null);
  const [filter, setFilter] = useState("ALL");
  const toast = useToast();
  const base = `/api/admin/agents/${detail.configuration.id}/examples`;
  const filtered = detail.examples.filter((example) => filter === "ALL" || example.purpose === filter);
  const pagination = useAdminPagination(filtered.length);
  const change = <K extends keyof AgentExampleInput>(key: K, value: AgentExampleInput[K]) => setForm((current) => ({ ...current, [key]: value }));
  const save = useMutation({
    mutationFn: () => {
      const existing = editing && editing !== "new" ? editing : null;
      return apiFetch(existing ? `${base}/${existing.id}` : base, { method: existing ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, ...(existing ? { revision: existing.revision } : {}) }) });
    },
    onSuccess: async () => { setEditing(null); await onChanged(); toast.success("Example saved."); },
  });
  const remove = useMutation({
    mutationFn: () => apiFetch(`${base}/${deleting!.id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: deleting!.revision }) }),
    onSuccess: async () => { setDeleting(null); await onChanged(); toast.success("Example deleted."); },
  });
  const open = (example?: AgentExample) => { save.reset(); setForm(example ? { title: example.title, input: example.input, expectedOutput: example.expectedOutput, contextJson: example.contextJson, purpose: example.purpose, status: example.status, matchMode: example.matchMode } : emptyExample()); setEditing(example ?? "new"); };
  return (
    <div className="agent-panel-body">
      <div className="agent-panel-heading"><div><h3>Training examples</h3><p>Teach the agent with approved examples. Keep evaluation cases separate to measure improvement.</p></div><Button variant="primary" size="sm" onClick={() => open()}><Plus size={16} aria-hidden="true" />Add example</Button></div>
      <p className="agent-note">Approved training examples guide new responses immediately. Drafts are inactive. Evaluation cases are never included in the agent&apos;s demonstrations.</p>
      {detail.examples.length ? <>
        <div className="agent-example-filter"><SelectField label="Show examples" value={filter} onChange={(event) => { setFilter(event.target.value); pagination.setPage(1); }}><option value="ALL">All examples</option><option value="TRAINING">Training</option><option value="EVALUATION">Evaluation</option></SelectField></div>
        <div className="agent-example-list">{filtered.slice(pagination.startIndex, pagination.endIndex).map((example) => <article className="agent-example" key={example.id}>
          <div className="agent-example-copy"><div className="agent-example-title"><strong>{example.title}</strong><span className={`agent-badge ${example.status === "APPROVED" ? "is-active" : ""}`}>{example.status === "APPROVED" ? "Approved" : "Draft"}</span><span className="agent-badge">{example.purpose === "TRAINING" ? "Training" : "Evaluation"}</span></div><p>{example.input}</p></div>
          <div className="agent-row-actions"><Button variant="ghost" size="sm" iconOnly aria-label={`Edit ${example.title}`} onClick={() => open(example)}><Pencil size={16} /></Button><Button variant="ghost" size="sm" iconOnly aria-label={`Delete ${example.title}`} onClick={() => { remove.reset(); setDeleting(example); }}><Trash2 size={16} /></Button></div>
        </article>)}</div>
        {!filtered.length ? <p className="agent-note">No examples match this filter.</p> : null}
        <AdminPagination label="Examples" totalItems={filtered.length} page={pagination.page} onPageChange={pagination.setPage} />
      </> : <EmptyState icon={<BookOpen size={28} />} title="Start with a good example" description="Add a realistic request and the response you want. Use synthetic or anonymized data suitable for all workspaces." action={<Button variant="outline" onClick={() => open()}>Add the first example</Button>} />}
      <Dialog open={Boolean(editing)} onClose={() => setEditing(null)} title={editing === "new" ? "Add an example" : "Edit example"} size="lg" closeDisabled={save.isPending} footer={<><Button variant="secondary" disabled={save.isPending} onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" type="submit" form="agent-example-form" loading={save.isPending}>Save example</Button></>}>
        <form id="agent-example-form" className="agent-example-form" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
          <TextField label="Title" required maxLength={120} value={form.title} onChange={(event) => change("title", event.target.value)} placeholder="Recognize a transport expense" />
          <div className="agent-fields-grid"><SelectField label="Use for" value={form.purpose} onChange={(event) => change("purpose", event.target.value as AgentExampleInput["purpose"])}><option value="TRAINING">Training</option><option value="EVALUATION">Evaluation</option></SelectField><SelectField label="Status" value={form.status} onChange={(event) => change("status", event.target.value as AgentExampleInput["status"])}><option value="DRAFT">Draft</option><option value="APPROVED">Approved</option></SelectField></div>
          <TextAreaField label="User request" required rows={3} maxLength={6_000} value={form.input} onChange={(event) => change("input", event.target.value)} />
          <TextAreaField label="Expected response" required rows={6} maxLength={12_000} hint="For fine-tuning, supply the complete JSON response. Evaluation cases can check a phrase or selected JSON fields." value={form.expectedOutput} onChange={(event) => change("expectedOutput", event.target.value)} />
          <SelectField label="Evaluation check" value={form.matchMode} onChange={(event) => change("matchMode", event.target.value as AgentExampleInput["matchMode"])}><option value="CONTAINS">Answer contains this text</option><option value="JSON_SUBSET">Response matches these JSON fields</option><option value="EXACT">Response matches exactly</option></SelectField>
          <details className="agent-context-details"><summary>Sample context and tool data</summary><p className="agent-note">Use a JSON object. Ask Nest accepts toolResults; transaction examples accept accountNames and bankNames; Smart Review accepts candidates. Evaluations use only this sample data.</p><TextAreaField label="Context JSON" rows={6} className="agent-code-input" maxLength={16_000} required value={form.contextJson} onChange={(event) => change("contextJson", event.target.value)} /></details>
          <p className="agent-note">Examples apply across Nest. Do not include private workspace records or credentials.</p>
          {save.error ? <p className="agent-error" role="alert">{save.error.message}</p> : null}
        </form>
      </Dialog>
      <Dialog open={Boolean(deleting)} onClose={() => setDeleting(null)} title="Delete example" size="sm" closeDisabled={remove.isPending} footer={<><Button variant="secondary" onClick={() => setDeleting(null)} disabled={remove.isPending}>Keep example</Button><Button variant="destructive" loading={remove.isPending} onClick={() => remove.mutate()}>Delete example</Button></>}><p>Delete “{deleting?.title}”? It will no longer guide responses or appear in future datasets.</p>{remove.error ? <p className="agent-error" role="alert">{remove.error.message}</p> : null}</Dialog>
    </div>
  );
}
