import { z } from "zod";
import { AGENT_IDS, getAgentDefinition, type AgentConfiguration } from "./agent-catalog";

export const AgentIdSchema = z.enum(AGENT_IDS);
const RevisionSchema = z.number().int().min(0).max(2_147_483_646);
const DeploymentSchema = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/);

export const AgentSettingsSchema = z.object({
  enabled: z.boolean(),
  instructions: z.string().trim().max(12_000),
  deployment: DeploymentSchema.nullable(),
  reasoningEffort: z.enum(["default", "low", "medium", "high"]),
  maxOutputTokens: z.number().int().min(512).max(16_000),
  maxToolRounds: z.number().int().min(1).max(12),
  maxToolCalls: z.number().int().min(1).max(32),
  trainingExampleLimit: z.number().int().min(0).max(8),
  capabilities: z.array(z.string().min(1).max(64)).max(20),
}).strict();

export const AgentConfigurationUpdateSchema = AgentSettingsSchema.extend({ revision: RevisionSchema }).strict();

export const AgentExampleSchema = z.object({
  title: z.string().trim().min(2).max(120),
  input: z.string().trim().min(2).max(6_000),
  expectedOutput: z.string().trim().min(1).max(12_000),
  contextJson: z.string().trim().max(16_000).default("{}").refine((value) => {
    try { const parsed = JSON.parse(value); return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed); }
    catch { return false; }
  }, "Context must be a JSON object."),
  purpose: z.enum(["TRAINING", "EVALUATION"]),
  status: z.enum(["DRAFT", "APPROVED"]),
  matchMode: z.enum(["CONTAINS", "EXACT", "JSON_SUBSET"]),
}).strict();
export const AgentExampleUpdateSchema = AgentExampleSchema.extend({ revision: RevisionSchema }).strict();
export const AgentRevisionSchema = z.object({ revision: RevisionSchema }).strict();
export const AgentEvaluationRequestSchema = z.object({
  requestId: z.uuid(),
  revision: RevisionSchema,
  exampleIds: z.array(z.string().min(1).max(191)).min(1).max(5),
}).strict();
export const AgentFineTuneRequestSchema = z.object({
  requestId: z.uuid(),
  revision: RevisionSchema,
  baseModel: DeploymentSchema,
  trainingType: z.enum(["Standard", "GlobalStandard", "Developer"]),
  epochs: z.union([z.literal("auto"), z.number().int().min(1).max(20)]).default("auto"),
}).strict();
export const AgentFineTuneActionSchema = z.object({ action: z.enum(["refresh", "cancel"]) }).strict();

export type AgentExampleInput = z.infer<typeof AgentExampleSchema>;
export type AgentExample = AgentExampleInput & { id: string; agentId: string; revision: number; updatedAt: string };
export type AgentEvaluationResult = {
  exampleId: string;
  title: string;
  passed: boolean;
  actualOutput: string;
  expectedOutput: string;
  explanation: string;
  toolsUsed: string[];
  durationMs: number;
};
export type AgentEvaluation = {
  id: string;
  revision: number;
  datasetHash: string;
  status: string;
  passedCount: number;
  totalCount: number;
  results: AgentEvaluationResult[];
  createdAt: string;
};
export type AgentFineTuneJob = {
  id: string;
  providerJobId: string | null;
  baseModel: string;
  trainingType: string;
  status: string;
  fineTunedModel: string | null;
  trainingCount: number;
  validationCount: number;
  revision: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};
export type AgentSummary = {
  configuration: AgentConfiguration;
  trainingCount: number;
  evaluationCount: number;
  draftCount: number;
};
export type AgentRegistry = {
  agents: AgentSummary[];
  provider: { configured: boolean; model: string | null };
};
export type AgentDetail = AgentSummary & {
  examples: AgentExample[];
  evaluations: AgentEvaluation[];
  fineTuningJobs: AgentFineTuneJob[];
  revisions: Array<{ revision: number; settings: z.infer<typeof AgentSettingsSchema>; action: string; createdAt: string }>;
};

export function validateAgentCapabilities(id: string, capabilities: string[]) {
  const allowed = new Set(getAgentDefinition(id).capabilities.map((capability) => capability.id));
  return capabilities.every((capability) => allowed.has(capability)) && new Set(capabilities).size === capabilities.length;
}
