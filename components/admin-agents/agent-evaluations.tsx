"use client";

import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, Copy, FlaskConical, Play, XCircle } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import type { AgentDetail, AgentEvaluation } from "@/lib/ai/agent-contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/controls";
import { EmptyState } from "@/components/ui/query-state";
import { useToast } from "@/components/toast-provider";

export function AgentEvaluations({ detail, configured, onChanged }: { detail: AgentDetail; configured: boolean; onChanged: () => Promise<void> }) {
  const cases = detail.examples.filter((example) => example.purpose === "EVALUATION" && example.status === "APPROVED");
  const [selected, setSelected] = useState(() => cases.slice(0, 5).map((example) => example.id));
  const request = useRef<{ signature: string; id: string } | null>(null);
  const toast = useToast();
  const selectedIds = cases.filter((example) => selected.includes(example.id)).map((example) => example.id);
  const running = detail.evaluations.some((run) => run.status === "RUNNING");
  const evaluate = useMutation({
    mutationFn: () => {
      const signature = JSON.stringify([detail.configuration.revision, selectedIds]);
      if (request.current?.signature !== signature) request.current = { signature, id: crypto.randomUUID() };
      return apiFetch<AgentEvaluation>(`/api/admin/agents/${detail.configuration.id}/evaluations`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: request.current.id, revision: detail.configuration.revision, exampleIds: selectedIds }) });
    },
    onSuccess: async (result) => { request.current = null; await onChanged(); toast.success(result.status === "COMPLETED" ? `Evaluation complete: ${result.passedCount} of ${result.totalCount} checks passed.` : "Evaluation is running."); },
    onError: async () => { await onChanged(); },
  });
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); toast.success("Response copied."); } catch { toast.error("The response could not be copied. Select and copy the text instead."); } };
  return (
    <div className="agent-panel-body">
      <div className="agent-panel-heading"><div><h3>Evaluate behavior</h3><p>Check the saved configuration against examples the agent has not been taught.</p></div><FlaskConical size={22} aria-hidden="true" /></div>
      <p className="agent-note">Evaluations use your sample context and tool results. They do not read or change live financial records. Each check compares the generated response with the expectation you set.</p>
      {cases.length ? <>
        <fieldset className="agent-evaluation-cases"><legend>Choose up to five cases</legend>{cases.map((example) => <label className="agent-evaluation-case" key={example.id}><Input type="checkbox" checked={selected.includes(example.id)} disabled={evaluate.isPending || (!selected.includes(example.id) && selectedIds.length >= 5)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, example.id] : current.filter((id) => id !== example.id))} /><span><strong>{example.title}</strong><small>{example.matchMode === "CONTAINS" ? "Text check" : example.matchMode === "JSON_SUBSET" ? "JSON field check" : "Exact response check"}</small></span></label>)}</fieldset>
        <div className="agent-form-footer"><span>{evaluate.isPending ? "Running with sample data…" : `${selectedIds.length} ${selectedIds.length === 1 ? "case" : "cases"} selected · provider usage applies`}</span><Button variant="primary" loading={evaluate.isPending} disabled={!configured || !selectedIds.length || running} onClick={() => evaluate.mutate()}><Play size={15} aria-hidden="true" />Run evaluation</Button></div>
      </> : <EmptyState title="Add an evaluation case" description="In Training examples, add a separate example, choose Evaluation, and approve it. Set the expected phrase or JSON fields to check." />}
      {evaluate.error ? <p className="agent-error" role="alert">{evaluate.error.message}</p> : null}
      {!configured ? <p className="agent-note">Connect the Azure AI provider to run evaluations.</p> : null}
      <div className="agent-run-list">{detail.evaluations.map((run) => <details className="agent-run" key={run.id} open={run.id === detail.evaluations[0]?.id}>
        <summary><span>{run.status === "COMPLETED" ? `${run.passedCount} / ${run.totalCount} passed` : run.status === "INTERRUPTED" ? "Run interrupted" : "Evaluation running"}<small>Revision {run.revision} · {new Date(run.createdAt).toLocaleString("en-SG")}{run.revision !== detail.configuration.revision ? " · agent has changed" : ""}</small></span><span className="agent-badge">{run.status === "COMPLETED" ? "Completed" : run.status === "INTERRUPTED" ? "Interrupted" : "In progress"}</span></summary>
        <div className="agent-run-results">{run.results.map((result) => <article key={result.exampleId} className="agent-evaluation-result"><div className="agent-result-heading">{result.passed ? <CheckCircle2 className="is-good" size={18} aria-hidden="true" /> : <XCircle className="is-bad" size={18} aria-hidden="true" />}<strong>{result.title}</strong><span>{(result.durationMs / 1000).toFixed(1)}s</span></div><p>{result.explanation}</p><div className="agent-output-grid"><div><h4>Expected</h4><pre>{result.expectedOutput}</pre></div><div><div className="agent-output-heading"><h4>Actual response</h4>{result.actualOutput ? <Button variant="ghost" size="sm" aria-label={`Copy response for ${result.title}`} onClick={() => copy(result.actualOutput)}><Copy size={13} aria-hidden="true" />Copy</Button> : null}</div><pre>{result.actualOutput || "No completed response."}</pre></div></div>{result.toolsUsed.length ? <p className="agent-note">Sample tools used: {result.toolsUsed.join(", ")}</p> : null}</article>)}</div>
      </details>)}</div>
    </div>
  );
}
