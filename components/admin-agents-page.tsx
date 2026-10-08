"use client";

import "@/app/styles/admin-agents.css";

import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Bot, Brain, Check, CreditCard, FlaskConical, Settings2, Sparkles } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";
import { AGENT_CATALOG, getAgentDefinition, type AgentId } from "@/lib/ai/agent-catalog";
import type { AgentRegistry, AgentDetail } from "@/lib/ai/agent-contracts";
import { AdminNavigation } from "@/components/admin-navigation";
import { AgentSettingsEditor, type AgentSettingsDraft } from "@/components/admin-agents/agent-settings-editor";
import { AgentExamples } from "@/components/admin-agents/agent-examples";
import { AgentEvaluations } from "@/components/admin-agents/agent-evaluations";
import { AgentFineTuning } from "@/components/admin-agents/agent-fine-tuning";
import { Button } from "@/components/ui/button";
import { QueryError } from "@/components/ui/query-state";
import { GenericPageSkeleton } from "@/components/skeletons/GenericPageSkeleton";

const icons = { "ask-nest": Bot, "transaction-assistant": ArrowUpRight, "smart-review": CreditCard };
const panels = [{ id: "configuration", label: "Configuration", icon: Settings2 }, { id: "training", label: "Training examples", icon: Brain }, { id: "evaluation", label: "Evaluations", icon: FlaskConical }, { id: "fine-tuning", label: "Fine-tuning", icon: Sparkles }] as const;
type Panel = typeof panels[number]["id"];

export function AdminAgentsPage() {
  const [selected, setSelected] = useState<AgentId>("ask-nest");
  const [panel, setPanel] = useState<Panel>("configuration");
  const [drafts, setDrafts] = useState<Partial<Record<AgentId, AgentSettingsDraft>>>({});
  const client = useQueryClient();
  const registry = useQuery({ queryKey: queryKeys.adminAgents(), queryFn: () => apiFetch<AgentRegistry>("/api/admin/agents"), staleTime: 15_000 });
  const detail = useQuery({ queryKey: queryKeys.adminAgent(selected), queryFn: () => apiFetch<AgentDetail>(`/api/admin/agents/${selected}`), staleTime: 15_000,
    refetchInterval: (query) => query.state.data?.evaluations.some((run) => run.status === "RUNNING" && Date.now() - Date.parse(run.createdAt) < 180_000) ? 3_000 : false });
  const onChanged = useCallback(async () => { await client.invalidateQueries({ queryKey: queryKeys.adminAgents() }); }, [client]);
  const definition = getAgentDefinition(selected);
  const totalTraining = registry.data?.agents.reduce((sum, agent) => sum + agent.trainingCount, 0) ?? 0;
  const activeCount = registry.data?.agents.filter((agent) => agent.configuration.enabled).length ?? 0;
  return (
    <div className="admin-page agent-page">
      <AdminNavigation current="agents" />
      <header className="agent-page-heading"><div className="agent-heading-icon"><Bot size={28} aria-hidden="true" /></div><div><p className="agent-eyebrow">ADMINISTRATION</p><h1>Agents</h1><p>Give every agent a clear purpose. Shape its behavior, teach it with examples, and measure what improves.</p></div></header>
      {registry.isLoading ? <GenericPageSkeleton /> : registry.error ? <QueryError title="Agents could not be loaded" message={registry.error.message} onRetry={() => registry.refetch()} /> : <>
        <div className="agent-overview"><span><strong>{activeCount}</strong> active {activeCount === 1 ? "agent" : "agents"}</span><span><strong>{totalTraining}</strong> approved training {totalTraining === 1 ? "example" : "examples"}</span><span className={`agent-provider-status${registry.data?.provider.configured ? " is-connected" : ""}`}><span aria-hidden="true" />{registry.data?.provider.configured ? "Azure AI configured" : "Azure AI not configured"}</span></div>
        <div className="agent-catalog" aria-label="Registered agents">{AGENT_CATALOG.map((agent) => {
          const item = registry.data?.agents.find((entry) => entry.configuration.id === agent.id);
          const Icon = icons[agent.id];
          return <Button className={`agent-card${selected === agent.id ? " is-selected" : ""}`} key={agent.id} aria-pressed={selected === agent.id} onClick={() => setSelected(agent.id)}>
            <span className="agent-card-top"><span className="agent-card-icon"><Icon size={21} aria-hidden="true" /></span><span className={`agent-badge${item?.configuration.enabled ? " is-active" : ""}`}>{item?.configuration.enabled ? "Enabled" : "Paused"}</span></span>
            <strong className="agent-card-name">{agent.name}</strong><span className="agent-card-description">{agent.description}</span><span className="agent-card-footer"><span>{item?.configuration.capabilities.length ?? 0} capabilities · {item?.trainingCount ?? 0} {item?.trainingCount === 1 ? "example" : "examples"}</span>{selected === agent.id ? <Check size={17} aria-hidden="true" /> : <ArrowUpRight size={17} aria-hidden="true" />}</span>
          </Button>;
        })}</div>
        <section className="agent-workbench" aria-label={`${definition.name} management`}>
          <div className="agent-workbench-heading"><div><h2>{definition.name}</h2><p>{definition.surface}</p></div><span className="agent-badge">{detail.data?.configuration.deployment || registry.data?.provider.model || "Default model"}</span></div>
          <nav className="agent-panel-nav" aria-label="Agent management sections">{panels.map((entry) => <Button key={entry.id} aria-pressed={panel === entry.id} className={panel === entry.id ? "is-active" : ""} onClick={() => setPanel(entry.id)}><entry.icon size={16} aria-hidden="true" />{entry.label}</Button>)}</nav>
          {detail.isLoading ? <div className="agent-workbench-content"><GenericPageSkeleton /></div> : detail.error ? <QueryError title="Agent details could not be loaded" message={detail.error.message} onRetry={() => detail.refetch()} /> : detail.data ? <div className="agent-workbench-content" key={selected}>
            <div hidden={panel !== "configuration"}><AgentSettingsEditor detail={detail.data} model={registry.data?.provider.model ?? null} draft={drafts[selected]}
              onDraftChange={(draft) => setDrafts((current) => ({ ...current, [selected]: draft }))}
              onSaved={(submitted, revision) => setDrafts((current) => ({ ...current, [selected]: current[selected] === submitted ? undefined : current[selected] ? { ...current[selected], revision } : undefined }))}
              onChanged={onChanged} /></div>
            <div hidden={panel !== "training"}><AgentExamples detail={detail.data} onChanged={onChanged} /></div>
            <div hidden={panel !== "evaluation"}><AgentEvaluations detail={detail.data} configured={Boolean(registry.data?.provider.configured)} onChanged={onChanged} /></div>
            <div hidden={panel !== "fine-tuning"}><AgentFineTuning detail={detail.data} configured={Boolean(registry.data?.provider.configured)} onChanged={onChanged} /></div>
          </div> : null}
        </section>
      </>}
    </div>
  );
}
