import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { defaultAgentConfiguration, type AgentId, type AgentConfiguration } from "./agent-catalog";
import { AgentSettingsSchema, AgentExampleSchema, type AgentExample } from "./agent-contracts";
import { selectAgentExamples } from "./agent-policy";

export function decodeAgentConfiguration(row: {
  id: string; enabled: boolean; instructions: string; deployment: string | null; reasoningEffort: string;
  maxOutputTokens: number; maxToolRounds: number; maxToolCalls: number; trainingExampleLimit: number;
  capabilitiesJson: string; revision: number; updatedAt: Date;
}): AgentConfiguration {
  const settings = AgentSettingsSchema.parse({
    enabled: row.enabled, instructions: row.instructions, deployment: row.deployment, reasoningEffort: row.reasoningEffort,
    maxOutputTokens: row.maxOutputTokens, maxToolRounds: row.maxToolRounds, maxToolCalls: row.maxToolCalls,
    trainingExampleLimit: row.trainingExampleLimit, capabilities: JSON.parse(row.capabilitiesJson),
  });
  return { ...settings, id: row.id as AgentId, revision: row.revision, updatedAt: row.updatedAt.toISOString() };
}

export function decodeAgentExample(row: {
  id: string; agentId: string; title: string; input: string; expectedOutput: string; contextJson: string;
  purpose: string; status: string; matchMode: string; revision: number; updatedAt: Date;
}): AgentExample {
  const data = AgentExampleSchema.parse({ title: row.title, input: row.input, expectedOutput: row.expectedOutput,
    contextJson: row.contextJson, purpose: row.purpose, status: row.status, matchMode: row.matchMode });
  return { ...data, id: row.id, agentId: row.agentId, revision: row.revision, updatedAt: row.updatedAt.toISOString() };
}

export async function getAgentConfiguration(id: AgentId): Promise<AgentConfiguration> {
  try {
    const row = await prisma.aiAgentConfig.findUnique({ where: { id } });
    return row ? decodeAgentConfiguration(row) : defaultAgentConfiguration(id);
  } catch (error) {
    // During an additive rollout the old application remains usable until the migration runs.
    // Other database failures must propagate; they must never bypass a saved pause or restriction.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021") return defaultAgentConfiguration(id);
    throw error;
  }
}

export async function getAgentTrainingExamples(configuration: AgentConfiguration, question: string) {
  if (!configuration.trainingExampleLimit || !configuration.revision) return [];
  const rows = await prisma.aiAgentExample.findMany({
    where: { agentId: configuration.id, purpose: "TRAINING", status: "APPROVED" },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take: 250,
  });
  return selectAgentExamples(rows.map(decodeAgentExample), question, configuration.trainingExampleLimit);
}
