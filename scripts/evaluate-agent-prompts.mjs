import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { defaultAgentConfiguration, enabledAgentTools } from "../lib/ai/agent-catalog.ts";
import { agentExamplePrompt } from "../lib/ai/agent-training.ts";
import { composeAgentInstructions, scoreAgentOutput } from "../lib/ai/agent-policy.ts";
import { EMPTY_TRANSACTION_INTENT } from "../lib/ai/transaction-agent-contracts.ts";
import { buildInstructions } from "../lib/ai/ask-nest.ts";
import { buildAskNestPlanningHint } from "../lib/ai/ask-nest-intent.mjs";
import { getAskNestTools } from "../lib/ai/ask-nest-tools.ts";
import { getAiWorkloadClient } from "../lib/ai/config.ts";

const args = process.argv.slice(2);
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const cases = JSON.parse(await readFile(new URL("../evals/agents/prompts.json", import.meta.url), "utf8"));
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const subset = (actual, expected) => scoreAgentOutput(JSON.stringify(actual), { expectedOutput: JSON.stringify(expected), matchMode: "JSON_SUBSET" });
const makeRequest = item => {
  const configuration = defaultAgentConfiguration(item.agentId);
  const context = { ...item.context };
  if (context.previousIntent) context.previousIntent = { ...EMPTY_TRANSACTION_INTENT, ...context.previousIntent };
  const example = { id: item.id, agentId: item.agentId, title: item.id, input: item.input, contextJson: JSON.stringify(context), expectedOutput: JSON.stringify(item.expected || { answer: "" }), purpose: "EVALUATION", status: "APPROVED", matchMode: "JSON_SUBSET", revision: 0, updatedAt: new Date().toISOString() };
  const prompt = agentExamplePrompt(configuration, example);
  const pagePath = context.pagePath || "/";
  if (item.agentId === "ask-nest") prompt.instructions = buildInstructions({ currency: "SGD", pageTitle: "Evaluation", pagePath, userName: null, memories: [], priorTopics: [], planningHint: buildAskNestPlanningHint(item.input, pagePath) });
  const allowed = enabledAgentTools(configuration);
  return { id: item.id, agentId: item.agentId, instructions: composeAgentInstructions(prompt.instructions, configuration), input: prompt.input, schema: prompt.schema,
    tools: item.agentId === "ask-nest" ? getAskNestTools(false).filter(tool => allowed.has(tool.name)) : [],
    initialToolChoice: "auto",
    maxOutputTokens: configuration.maxOutputTokens };
};
const score = (item, output, calls) => ({
  expectedFields: !item.expected || subset(output, item.expected),
  requiredValues: (item.nonEmptyFields || []).every(field => typeof output[field] === "string" && output[field].trim().length > 0),
  expectedTools: (item.tools || []).every(expected => calls.some(call => call.name === expected.name && (!expected.arguments || subset(call.arguments, expected.arguments)))),
  noExtraTools: !item.noTools || !calls.length,
  answerContent: (item.answerPatterns || []).every(pattern => new RegExp(pattern, "i").test(output.answer || "")),
  noForbiddenContent: (item.forbiddenPatterns || []).every(pattern => !new RegExp(pattern, "i").test(output.answer || "")),
  completeReview: item.agentId !== "smart-review" || output.suggestions?.length === item.context.transactions.length,
});
function toolChoice(request, round) {
  if (!request.tools.length || round === 4) return "none";
  return round === 0 ? request.initialToolChoice : "auto";
}

assert.equal(new Set(cases.map(item => item.id)).size, cases.length, "Case IDs must be unique");
for (const item of cases) {
  assert.ok(item.expected || item.answerPatterns?.length, `${item.id} needs a substantive assertion`);
  for (const pattern of [...item.answerPatterns || [], ...item.forbiddenPatterns || []]) {
    assert.doesNotThrow(() => new RegExp(pattern, "i"), `${item.id} contains an invalid answer pattern`);
  }
}
const requests = option("--from") ? JSON.parse(await readFile(option("--from"), "utf8")) : cases.map(makeRequest);
assert.deepEqual(requests.map(item => item.id), cases.map(item => item.id), "Snapshot and case IDs must match");
if (option("--snapshot")) await writeFile(option("--snapshot"), JSON.stringify(requests, null, 2));
if (option("--rescore")) {
  const report = JSON.parse(await readFile(option("--rescore"), "utf8"));
  assert.deepEqual(report.results.map(result => result.id), cases.map(item => item.id), "Report and case IDs must match");
  for (const result of report.results) {
    if (!result.output) continue;
    result.checks = score(cases.find(item => item.id === result.id), result.output, result.calls);
    result.passed = Object.values(result.checks).every(Boolean);
  }
  report.datasetHash = hash(cases);
  report.passed = report.results.filter(result => result.passed).length;
  report.rescoredAt = new Date().toISOString();
  if (option("--output")) await writeFile(option("--output"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({model:report.model,passed:report.passed,total:report.total,providerCalls:0,rescored:true}));
} else if (!args.includes("--live")) {
  console.log(JSON.stringify({ cases: cases.length, agents: [...new Set(cases.map(item => item.agentId))], providerCalls: 0, valid: true }));
} else {
  const { client, model } = getAiWorkloadClient();
  const run = async (request, index) => {
    const item = cases[index];
    const started = Date.now();
    const input = [{ role: "user", content: request.input }];
    const calls = [];
    const signal = AbortSignal.timeout(90_000);
    let tokens = 0;
    try {
      for (let round = 0; round <= 4; round++) {
        const response = await client.responses.create({ model, instructions: request.instructions, input, tools: request.tools,
          tool_choice: toolChoice(request, round),
          parallel_tool_calls: false, max_output_tokens: request.maxOutputTokens, store: false, include: ["reasoning.encrypted_content"],
          text: {format: {type: "json_schema", name: "agent_prompt_evaluation", strict: true, schema: request.schema}} }, { maxRetries: 0, signal });
        tokens += response.usage?.total_tokens || 0;
        if (response.status !== "completed") throw new Error("Incomplete provider response");
        const toolCalls = response.output.filter(output => output.type === "function_call");
        if (!toolCalls.length) {
          const output = JSON.parse(response.output_text);
          const checks = score(item, output, calls);
          return { id: item.id, agentId: item.agentId, passed: Object.values(checks).every(Boolean), checks, output, calls, tokens, durationMs: Date.now() - started, promptHash: hash(request.instructions) };
        }
        input.push(...response.output);
        for (const call of toolCalls) {
          if (!request.tools.some(tool => tool.name === call.name) || calls.length >= 8) throw new Error("Unexpected tool or evaluation limit");
          calls.push({name:call.name, arguments:JSON.parse(call.arguments)});
          // Synthetic fixtures only. This runner never executes workspace tools or writes records.
          const fixture = item.context.toolResults?.[call.name] || {ok:false,error:"No sample evidence is available for this tool."};
          input.push({type:"function_call_output",call_id:call.call_id,output:JSON.stringify(fixture)});
        }
      }
      throw new Error("Evaluation rounds exhausted");
    } catch (error) { return { id:item.id,agentId:item.agentId,passed:false,error:error.name,status:error.status || null,calls,tokens,durationMs:Date.now()-started,promptHash:hash(request.instructions) }; }
  };
  const results = [];
  for (let index = 0; index < requests.length; index += 2) {
    const batch = await Promise.all(requests.slice(index,index+2).map((request,offset) => run(request,index+offset)));
    results.push(...batch);
    console.log(JSON.stringify({completed:results.length,total:requests.length,batch:batch.map(({id,passed,error,status})=>({id,passed,error,status}))}));
    if (batch.every(result => result.error && [401,403,404].includes(result.status))) break;
  }
  const report = { model, createdAt:new Date().toISOString(), datasetHash:hash(cases), passed:results.filter(result=>result.passed).length,total:cases.length,completed:results.length,tokens:results.reduce((sum,result)=>sum+result.tokens,0),results };
  if(option("--output")) await writeFile(option("--output"),JSON.stringify(report,null,2));
  console.log(JSON.stringify({model,passed:report.passed,total:report.total,completed:report.completed,tokens:report.tokens}));
  if(report.passed !== cases.length) process.exitCode=1;
}
