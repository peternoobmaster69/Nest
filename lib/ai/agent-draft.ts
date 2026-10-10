import type { AgentSettings } from "./agent-catalog";

export type AgentSettingsDraft = { settings: AgentSettings; revision: number };

export function reconcileSavedAgentDraft(draft: AgentSettingsDraft | undefined, submitted: AgentSettingsDraft, revision: number) {
  if (!draft || draft === submitted) return undefined;
  return { ...draft, revision };
}
