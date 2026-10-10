import { createHash } from "node:crypto";
import type { ResponseInputItem, ResponseFunctionToolCall } from "openai/resources/responses/responses";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiRequestError } from "@/lib/api/contracts";
import { getAiWorkloadClient } from "./config";
import { buildInstructions, ANSWER_JSON_SCHEMA, GeneratedAnswerSchema } from "./ask-nest";
import { getAskNestTools } from "./ask-nest-tools";
import { SMART_REVIEW_INSTRUCTIONS, MODEL_JSON_SCHEMA, SmartReviewModelInputSchema, applySmartReviewInputPolicy, applySmartReviewOutputPolicy } from "./smart-review";
import { transactionAgentInstructions, applyTransactionIntentPolicy } from "./transaction-agent-parser";
import { EMPTY_TRANSACTION_INTENT, TransactionIntentSchema } from "./transaction-agent-contracts";
import { z } from "zod";
import { enabledAgentTools, type AgentId, type AgentConfiguration } from "./agent-catalog";
import { type AgentExample, type AgentEvaluationResult, AgentEvaluationRequestSchema } from "./agent-contracts";
import { agentReasoningOptions, composeAgentInstructions, scoreAgentOutput, selectAgentExamples } from "./agent-policy";
import { decodeAgentExample, getAgentConfiguration } from "./agent-runtime";
import { agentHash, serializeAgentEvaluation } from "./agent-store";

export function agentExamplePrompt(configuration: AgentConfiguration, example: AgentExample) {
  const context = JSON.parse(example.contextJson) as Record<string, unknown>;
  const currency = typeof context.currency === "string" && /^[A-Z]{3}$/.test(context.currency) ? context.currency : "SGD";
  if (configuration.id === "transaction-assistant") {
    return {
      instructions: transactionAgentInstructions(currency),
      input: JSON.stringify({ previousIntent: EMPTY_TRANSACTION_INTENT, assistantWasAskingFor: null, conversation: [],
        selectedTransaction: false, lastSaved: null, accountNames: [], bankNames: [], ...context,
        ...(!configuration.capabilities.includes("account-suggestions") ? { accountNames: [] } : {}), latestMessage: example.input }),
      schema: z.toJSONSchema(TransactionIntentSchema),
      parse: (value: unknown) => applyTransactionIntentPolicy(value, configuration),
      toolResults: {} as Record<string, unknown>,
    };
  }
  if (configuration.id === "smart-review") {
    const input = applySmartReviewInputPolicy(SmartReviewModelInputSchema.parse({ transactions: [{ transactionId: "example", subject: example.input.slice(0, 240) }],
      candidates: [], ...context }), configuration);
    return {
      instructions: SMART_REVIEW_INSTRUCTIONS,
      input: JSON.stringify(input),
      schema: MODEL_JSON_SCHEMA,
      parse: (value: unknown) => applySmartReviewOutputPolicy(value, input, configuration),
      toolResults: {} as Record<string, unknown>,
    };
  }
  return {
    instructions: buildInstructions({ currency, pageTitle: "Evaluation", pagePath: "/", userName: null, memories: [], priorTopics: [], planningHint: "Select the available tools needed to answer the question. Explain unavailable evidence." }),
    input: example.input,
    schema: ANSWER_JSON_SCHEMA,
    parse: (value: unknown) => GeneratedAnswerSchema.parse(value),
    toolResults: context.toolResults && typeof context.toolResults === "object" && !Array.isArray(context.toolResults) ? context.toolResults as Record<string, unknown> : {},
  };
}

export function agentDatasetLine(configuration: AgentConfiguration, example: AgentExample) {
  const prompt = agentExamplePrompt(configuration, example);
  let response: unknown;
  try { response = prompt.parse(JSON.parse(example.expectedOutput)); }
  catch { throw new ApiRequestError(422, `“${example.title}” needs a complete JSON response for fine-tuning. Use the structured output from an evaluation.`); }
  if (configuration.id === "ask-nest" && (Object.keys(prompt.toolResults).length || GeneratedAnswerSchema.parse(response).evidence_ids.length)) {
    throw new ApiRequestError(422, `“${example.title}” uses tool evidence. Keep it for demonstrations and evaluations; this exporter supports only tool-free Ask Nest responses.`);
  }
  return JSON.stringify({ messages: [
    { role: "system", content: composeAgentInstructions(prompt.instructions, configuration) },
    { role: "user", content: prompt.input },
    { role: "assistant", content: JSON.stringify(response) },
  ] });
}

export function buildAgentDataset(configuration: AgentConfiguration, examples: readonly AgentExample[], purpose: "TRAINING" | "EVALUATION") {
  const selected = examples.filter((example) => example.purpose === purpose && example.status === "APPROVED");
  if (!selected.length) throw new ApiRequestError(422, `Approve at least one ${purpose === "TRAINING" ? "training" : "evaluation"} example first.`);
  return `${selected.map((example) => agentDatasetLine(configuration, example)).join("\n")}\n`;
}

export async function loadAgentTrainingSnapshot(id: AgentId, expectedRevision?: number) {
  const configuration = await getAgentConfiguration(id);
  if (expectedRevision !== undefined && configuration.revision !== expectedRevision) throw new ApiRequestError(409, "The agent changed. Refresh before starting a run.");
  const rows = await prisma.aiAgentExample.findMany({ where: { agentId: id, status: "APPROVED" }, orderBy: { id: "asc" }, take: 250 });
  const examples = rows.map(decodeAgentExample);
  const fresh = await getAgentConfiguration(id);
  if (fresh.revision !== configuration.revision) throw new ApiRequestError(409, "The training data changed. Refresh before starting a run.");
  return { configuration, examples, datasetHash: agentHash(examples.map(({ id: exampleId, revision, input, expectedOutput, contextJson, purpose }) => ({ id: exampleId, revision, input, expectedOutput, contextJson, purpose }))) };
}

function scoreEvaluationResponse(example: AgentExample, prompt: ReturnType<typeof agentExamplePrompt>, outputText: string, toolsUsed: string[], started: number): AgentEvaluationResult {
  const actualOutput = JSON.stringify(prompt.parse(JSON.parse(outputText)), null, 2);
  const passed = scoreAgentOutput(actualOutput, example);
  return { exampleId: example.id, title: example.title, passed, actualOutput, expectedOutput: example.expectedOutput,
    explanation: passed ? "The expected-output check passed." : "The response did not satisfy the expected-output check.", toolsUsed, durationMs: Date.now() - started };
}

function appendEvaluationToolResults(
  output: ResponseInputItem[],
  calls: ResponseFunctionToolCall[],
  tools: { name: string }[],
  toolResults: Record<string, unknown>,
  input: ResponseInputItem[],
  toolsUsed: string[],
  maxToolCalls: number,
) {
  if (toolsUsed.length + calls.length > maxToolCalls) throw new Error("Lookup allowance exceeded");
  input.push(...output);
  for (const call of calls) {
    if (!tools.some((tool) => tool.name === call.name)) throw new Error("Disabled tool requested");
    toolsUsed.push(call.name);
    // Evaluations replay supplied fixtures; they never execute production tools or read workspace records.
    const result = Object.hasOwn(toolResults, call.name) ? toolResults[call.name] : { ok: false, error: "No sample data was supplied for this tool." };
    input.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(result) });
  }
}

export async function runAgentExample(configuration: AgentConfiguration, example: AgentExample, training: AgentExample[], actorUserId: string, signal?: AbortSignal): Promise<AgentEvaluationResult> {
  const started = Date.now();
  const toolsUsed: string[] = [];
  try {
    const prompt = agentExamplePrompt(configuration, example);
    const demonstrations = selectAgentExamples(training, example.input, configuration.trainingExampleLimit);
    const instructions = composeAgentInstructions(prompt.instructions, configuration, demonstrations);
    const allowed = enabledAgentTools(configuration);
    const tools = configuration.id === "ask-nest" ? getAskNestTools(configuration.capabilities.includes("knowledge")).filter((tool) => allowed.has(tool.name)) : [];
    const input: ResponseInputItem[] = [{ role: "user", content: prompt.input }];
    const { client, model } = getAiWorkloadClient(configuration.deployment);
    for (let round = 0; round <= configuration.maxToolRounds; round += 1) {
      const response = await client.responses.create({
        model, ...agentReasoningOptions(configuration), instructions, input, tools,
        tool_choice: tools.length && round < configuration.maxToolRounds && toolsUsed.length < configuration.maxToolCalls ? "auto" : "none",
        parallel_tool_calls: false, max_output_tokens: configuration.maxOutputTokens, store: false, include: ["reasoning.encrypted_content"],
        safety_identifier: createHash("sha256").update(`agent-evaluation:${actorUserId}`).digest("hex").slice(0, 32),
        text: { format: { type: "json_schema", name: "agent_evaluation", strict: true, schema: prompt.schema } },
      }, { signal, maxRetries: 0 });
      if (response.status !== "completed") throw new Error("Incomplete response");
      const calls = response.output.filter((item): item is ResponseFunctionToolCall => item.type === "function_call");
      if (!calls.length) {
        return scoreEvaluationResponse(example, prompt, response.output_text, toolsUsed, started);
      }
      appendEvaluationToolResults(response.output as ResponseInputItem[], calls, tools, prompt.toolResults, input, toolsUsed, configuration.maxToolCalls);
    }
    throw new Error("Lookup rounds exceeded");
  } catch (error) {
    return { exampleId: example.id, title: example.title, passed: false, actualOutput: "", expectedOutput: example.expectedOutput,
      explanation: error instanceof Error && error.name === "AiConfigurationError" ? "The AI provider is not configured." : "The provider did not complete a valid response within the evaluation limits.",
      toolsUsed, durationMs: Date.now() - started };
  }
}

export async function evaluateAgent(id: AgentId, input: z.infer<typeof AgentEvaluationRequestSchema>, actorUserId: string) {
  const requestHash = agentHash({ id, ...input, actorUserId });
  const existing = await prisma.aiAgentEvaluation.findUnique({ where: { id: input.requestId } });
  if (existing) {
    if (existing.agentId !== id || existing.requestHash !== requestHash) throw new ApiRequestError(409, "This request ID belongs to another evaluation.");
    return serializeAgentEvaluation(existing);
  }
  const snapshot = await loadAgentTrainingSnapshot(id, input.revision);
  const examples = snapshot.examples.filter((example) => example.purpose === "EVALUATION" && input.exampleIds.includes(example.id));
  if (examples.length !== new Set(input.exampleIds).size) throw new ApiRequestError(422, "Choose approved evaluation cases belonging to this agent.");
  const training = snapshot.examples.filter((example) => example.purpose === "TRAINING");
  try {
    await prisma.aiAgentEvaluation.create({ data: { id: input.requestId, agentId: id, revision: input.revision, datasetHash: snapshot.datasetHash,
      requestHash, status: "RUNNING", totalCount: examples.length, resultsJson: "[]", actorUserId } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return evaluateAgent(id, input, actorUserId);
    throw error;
  }
  const results: AgentEvaluationResult[] = [];
  const signal = AbortSignal.timeout(120_000);
  for (let index = 0; index < examples.length; index += 2) {
    results.push(...await Promise.all(examples.slice(index, index + 2).map((example) => runAgentExample(snapshot.configuration, example, training, actorUserId, signal))));
    await prisma.aiAgentEvaluation.update({ where: { id: input.requestId }, data: { resultsJson: JSON.stringify(results), passedCount: results.filter((result) => result.passed).length } });
  }
  return serializeAgentEvaluation(await prisma.aiAgentEvaluation.update({ where: { id: input.requestId }, data: { status: "COMPLETED" } }));
}
