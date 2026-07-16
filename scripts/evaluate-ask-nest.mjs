import { readFile } from "node:fs/promises";
import { classifyAskNestIntent } from "../lib/ai/ask-nest-intent.mjs";

const cases = JSON.parse(await readFile(new URL("../evals/ask-nest/golden.json", import.meta.url), "utf8"));
const results = cases.map((testCase) => {
  const actual = classifyAskNestIntent(testCase.question, testCase.pagePath);
  return {
    id: testCase.id,
    toolPassed: actual.recommendedTools.includes(testCase.expectedTool),
    retrievalPassed: actual.needsHybridRetrieval === testCase.retrieval,
    expectedTool: testCase.expectedTool,
    actualTool: actual.recommendedTools[0],
    expectedRetrieval: testCase.retrieval,
    actualRetrieval: actual.needsHybridRetrieval,
  };
});

const count = results.length;
const toolPassed = results.filter((result) => result.toolPassed).length;
const retrievalPassed = results.filter((result) => result.retrievalPassed).length;
const expectedRetrieval = results.filter((result) => result.expectedRetrieval);
const predictedRetrieval = results.filter((result) => result.actualRetrieval);
const truePositiveRetrieval = results.filter((result) => result.expectedRetrieval && result.actualRetrieval).length;
const precision = predictedRetrieval.length ? truePositiveRetrieval / predictedRetrieval.length : 0;
const recall = expectedRetrieval.length ? truePositiveRetrieval / expectedRetrieval.length : 0;
const summary = {
  cases: count,
  toolAccuracy: toolPassed / count,
  retrievalAccuracy: retrievalPassed / count,
  retrievalPrecision: precision,
  retrievalRecall: recall,
  gatePassed: count >= 40 && toolPassed / count >= 0.9 && precision >= 0.85 && recall >= 0.8,
  failures: results.filter((result) => !result.toolPassed || !result.retrievalPassed),
};

console.log(JSON.stringify(summary, null, 2));
if (!summary.gatePassed) process.exitCode = 1;
