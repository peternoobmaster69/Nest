import { prisma } from "@/lib/prisma";
import { AGENT_IDS, type AgentConfiguration, type AgentId } from "./agent-catalog";
import { AgentSettingsSchema } from "./agent-contracts";
import { DEFAULT_AGENT_INSTRUCTIONS, LEGACY_AGENT_INSTRUCTIONS } from "./agent-instructions";
import { decodeAgentConfiguration } from "./agent-runtime";
import { saveAgentConfiguration } from "./agent-store";

type UpgradeResult = { id: string; status: "default" | "current" | "custom" | "pending" | "updated" | "conflict"; revision: number };

async function applyInstructionUpgrade(id: AgentId, current: AgentConfiguration, actorUserId: string): Promise<UpgradeResult> {
  try {
    const updated = await saveAgentConfiguration(id, { ...AgentSettingsSchema.strip().parse(current), instructions: DEFAULT_AGENT_INSTRUCTIONS[id], revision: current.revision }, actorUserId);
    return { id, status: "updated", revision: updated.revision };
  } catch (error) {
    if (error instanceof Error && "status" in error && error.status === 409) {
      return { id, status: "conflict", revision: current.revision };
    }
    throw error;
  }
}

/** Upgrade only untouched stock instructions, preserving settings and recording an ordinary audited revision. */
export async function upgradeLegacyAgentInstructions(actorUserId: string, apply = false) {
  const rows = await prisma.aiAgentConfig.findMany({ where: { id: { in: [...AGENT_IDS] } } });
  const results: UpgradeResult[] = [];
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
    results.push(await applyInstructionUpgrade(id, current, actorUserId));
  }
  return results;
}
