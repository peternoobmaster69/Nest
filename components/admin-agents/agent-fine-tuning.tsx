"use client";

import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Download, ExternalLink, RefreshCw, Sparkles } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import type { AgentDetail, AgentFineTuneJob } from "@/lib/ai/agent-contracts";
import { Button } from "@/components/ui/button";
import { SelectField, TextField } from "@/components/ui/form-field";
import { useToast } from "@/components/toast-provider";

const finalStatuses = ["SUCCEEDED", "FAILED", "CANCELLED"];

export function AgentFineTuning({ detail, configured, onChanged }: Readonly<{ detail: AgentDetail; configured: boolean; onChanged: () => Promise<void> }>) {
  const [baseModel, setBaseModel] = useState("");
  const [trainingType, setTrainingType] = useState("Standard");
  const [epochs, setEpochs] = useState("auto");
  const [downloading, setDownloading] = useState(false);
  const request = useRef<{ signature: string; id: string } | null>(null);
  const toast = useToast();
  const base = `/api/admin/agents/${detail.configuration.id}`;
  const active = detail.fineTuningJobs.some((job) => !finalStatuses.includes(job.status));
  const start = useMutation({
    mutationFn: () => {
      const signature = JSON.stringify([detail.configuration.revision, baseModel, trainingType, epochs]);
      if (request.current?.signature !== signature) request.current = { signature, id: crypto.randomUUID() };
      return apiFetch<AgentFineTuneJob>(`${base}/fine-tuning`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId: request.current.id, revision: detail.configuration.revision, baseModel, trainingType, epochs: epochs === "auto" ? "auto" : Number(epochs) }) });
    },
    onSuccess: async (job) => { request.current = null; await onChanged(); if (job.status === "FAILED" || job.status === "UNKNOWN") toast.error(job.error || "Review the training job status."); else toast.success("Training job submitted to Azure."); },
    onError: async () => { await onChanged(); },
  });
  const update = useMutation({
    mutationFn: ({ jobId, action }: { jobId: string; action: "refresh" | "cancel" }) => apiFetch<AgentFineTuneJob>(`${base}/fine-tuning/${jobId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) }),
    onSuccess: async () => { await onChanged(); },
  });
  const download = async () => {
    setDownloading(true);
    try {
      const response = await fetch(`${base}/dataset`, { cache: "no-store" });
      if (!response.ok) { const result = await response.json(); throw new Error(result.error || "Dataset export failed."); }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a"); link.href = url; link.download = `${detail.configuration.id}-training.jsonl`; link.click(); URL.revokeObjectURL(url);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Dataset export failed."); }
    finally { setDownloading(false); }
  };
  return (
    <div className="agent-panel-body">
      <div className="agent-panel-heading"><div><h3>Model fine-tuning</h3><p>Train a custom model with Azure, then connect its deployment to this agent.</p></div><Button variant="outline" size="sm" disabled={!detail.trainingCount} loading={downloading} onClick={download}><Download size={15} aria-hidden="true" />Export JSONL</Button></div>
      <div className="agent-training-readiness"><Sparkles size={22} aria-hidden="true" /><div><strong>{detail.trainingCount} approved training examples</strong><p>{detail.trainingCount < 10 ? `Add ${10 - detail.trainingCount} more to reach the minimum of 10. Begin with a diverse set of high-quality examples.` : "Use complete structured responses and compare results against your evaluation cases."}</p></div></div>
      {detail.configuration.id === "ask-nest" ? <p className="agent-note">Ask Nest exports support responses without tool evidence. Examples with financial tool results remain available for demonstrations and evaluations.</p> : null}
      <form className="agent-training-form" onSubmit={(event) => { event.preventDefault(); start.mutate(); }}>
        <div className="agent-fields-grid"><TextField label="Base model to train" placeholder="gpt-4.1-2025-04-14" hint="Use a fine-tuning base model ID supported by your Azure resource, rather than a deployment name." required maxLength={200} value={baseModel} onChange={(event) => setBaseModel(event.target.value)} />
          <SelectField label="Training type" value={trainingType} onChange={(event) => setTrainingType(event.target.value)}><option value="Standard">Standard · resource region</option><option value="GlobalStandard">Global Standard · global capacity</option><option value="Developer">Developer · experimental capacity</option></SelectField>
          <SelectField label="Training epochs" value={epochs} onChange={(event) => setEpochs(event.target.value)}><option value="auto">Let Azure choose</option>{[1, 2, 3, 5, 10, 20].map((value) => <option value={value} key={value}>{value}</option>)}</SelectField>
        </div>
        <p className="agent-note">Starting a job uploads approved training examples to your configured Azure resource and incurs provider charges. Complete evaluation responses are uploaded separately for validation. Availability depends on the resource&apos;s model, region, permissions, and quota.</p>
        <div className="agent-form-footer"><a href="https://learn.microsoft.com/azure/ai-foundry/openai/how-to/fine-tuning?view=foundry-classic" target="_blank" rel="noreferrer">Azure fine-tuning guide <ExternalLink size={13} aria-hidden="true" /></a><Button variant="primary" type="submit" loading={start.isPending} disabled={!configured || detail.trainingCount < 10 || active}>Start fine-tuning</Button></div>
      </form>
      {active ? <p className="agent-note">Refresh or finish the existing job before starting another.</p> : null}
      {!configured ? <p className="agent-note">Connect the Azure AI provider before starting training.</p> : null}
      {start.error || update.error ? <p className="agent-error" role="alert">{(start.error || update.error)?.message}</p> : null}
      <div className="agent-run-list">{detail.fineTuningJobs.map((job) => <article className="agent-training-job" key={job.id}><div className="agent-panel-heading"><div><h4>{job.baseModel}</h4><p>{job.trainingCount} training · {job.validationCount} validation · revision {job.revision}</p></div><span className={`agent-badge${job.status === "SUCCEEDED" ? " is-active" : ""}`}>{job.status.toLowerCase().replaceAll("_", " ")}</span></div>
        {job.providerJobId ? <p className="agent-job-id">{job.providerJobId}</p> : null}{job.error ? <p className="agent-error">{job.error}</p> : null}
        {job.fineTunedModel ? <div className="agent-trained-model"><strong>Trained model</strong><code>{job.fineTunedModel}</code><p>Deploy this model in Azure, then enter its deployment name under Configuration.</p><a href="https://ai.azure.com" target="_blank" rel="noreferrer">Open Microsoft Foundry <ExternalLink size={13} aria-hidden="true" /></a></div> : null}
        <div className="agent-form-footer"><span>{new Date(job.createdAt).toLocaleString("en-SG")}</span>{!finalStatuses.includes(job.status) ? <div className="agent-row-actions"><Button variant="outline" size="sm" loading={update.isPending && update.variables?.jobId === job.id} onClick={() => update.mutate({ jobId: job.id, action: "refresh" })}><RefreshCw size={14} aria-hidden="true" />Refresh status</Button>{job.providerJobId ? <Button variant="ghost" size="sm" disabled={update.isPending} onClick={() => update.mutate({ jobId: job.id, action: "cancel" })}>Cancel training</Button> : null}</div> : null}</div>
      </article>)}</div>
    </div>
  );
}
