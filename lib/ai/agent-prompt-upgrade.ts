import { prisma } from "@/lib/prisma";
import { AGENT_IDS } from "./agent-catalog";
import { AgentSettingsSchema } from "./agent-contracts";
import { DEFAULT_AGENT_INSTRUCTIONS, LEGACY_AGENT_INSTRUCTIONS } from "./agent-instructions";
import { decodeAgentConfiguration } from "./agent-runtime";
import { saveAgentConfiguration } from "./agent-store";

/** Upgrade only untouched stock instructions, preserving settings and recording an ordinary audited revision. */
export async function upgradeLegacyAgentInstructions(actorUserId: string, apply = false) {
  const rows = await prisma.aiAgentConfig.findMany({ where: { id: { in: [...AGENT_IDS] } } });
  const results: Array<{ id: string; status: "default" | "current" | "custom" | "pending" | "updated" | "conflict"; revision: number }> = [];
  for (const id of AGENT_IDS) {
    const row = rows.find(candidate => candidate.id === id);
    if (!row) { results.push({ id, status: "default", revision: 0 }); continue; }
    const current = decodeAgentConfiguration(row);
    const original = current.instructions.trim();
    if (original !== LEGACY_AGENT_INSTRUCTIONS[id]) {
      results.push({ id, status: original === DEFAULT_AGENT_INSTRUCTIONS[id] ? "current" : "custom", revision: current.revision });
      continue;
    }
    if (!apply) { results.push({ id, status: "pending", revision: current.revision }); continue; }
    try {
      const updated = await saveAgentConfiguration(id, { ...AgentSettingsSchema.strip().parse(current), instructions: DEFAULT_AGENT_INSTRUCTIONS[id], revision: current.revision }, actorUserId);
      results.push({ id, status: "updated", revision: updated.revision });
    } catch (error) {
      if (error instanceof Error && "status" in error && error.status === 409) results.push({ id, status: "conflict", revision: current.revision });
      else throw error;
    }
  }
  return results;
}
