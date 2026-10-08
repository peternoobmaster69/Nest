import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { buildAskNestPlanningHint, classifyAskNestIntent } from "../lib/ai/ask-nest-intent.mjs";

test("document questions use workspace retrieval regardless of whether the document or action appears first", () => {
  for (const question of [
    "My statements show which fees?", "What do the receipts say about the warranty?", "According to the PDF, when is renewal?",
    "Search the uploaded attachments", "Explain the bank email", "My notes mention a pharmacy payment",
  ]) {
    const result = classifyAskNestIntent(question);
    assert.equal(result.intent, "knowledge_search", question);
    assert.deepEqual(result.recommendedTools, ["search_workspace_knowledge"], question);
    assert.equal(result.needsHybridRetrieval, true, question);
  }
});

test("category questions retain both word orders, semantic groups and normalized accents", () => {
  for (const category of ["commuting", "dining", "groceries", "electricity", "housing", "shopping", "entertainment", "medical", "school", "flights", "insurance", "personal care", "childcare", "pets", "fees", "taxes", "gifts", "donations"]) {
    for (const question of [`Show spending on ${category}`, `${category} spending total`]) {
      assert.equal(classifyAskNestIntent(question).intent, "category_spending", question);
    }
  }
  assert.equal(classifyAskNestIntent("SHOW\n SPÉNDING\tON GROCERIES!").intent, "category_spending");
  assert.equal(classifyAskNestIntent("The taxidermy transporters met").confidence, "LOW");
});

test("monthly adequacy benchmarks request public research and use a projection only when the context calls for it", () => {
  for (const question of ["Is SGD 8,000 a month adequate?", "Is it reasonable to spend 8 000 per month?", "8000 monthly is too high"]) {
    assert.deepEqual(classifyAskNestIntent(question).recommendedTools, ["search_public_financial_sources"], question);
    assert.deepEqual(classifyAskNestIntent(question, "/cio").recommendedTools, ["run_cio_retirement_projection", "search_public_financial_sources"], question);
  }
  assert.deepEqual(classifyAskNestIntent("Is my retirement income reasonable?").recommendedTools, ["run_cio_retirement_projection", "search_public_financial_sources"]);
});

test("projection definitions and comparisons remain conceptual and scoped to the CIO page", () => {
  for (const question of [
    "What does real terms mean?", "Definition of nominal values", "Explain real values compared with nominal terms",
    "Explain nominal terms compared to today's money", "Today's-money vs nominal difference", "Nominal versus real values meaning",
    "What's the difference between real and nominal values?",
  ]) {
    const result = classifyAskNestIntent(question, "/cio");
    assert.equal(result.intent, "cio_projection_terms", question);
    assert.deepEqual(result.recommendedTools, [], question);
    assert.equal(result.needsHybridRetrieval, false);
  }
  assert.deepEqual(classifyAskNestIntent("What does nominal mean?", "/transactions").recommendedTools, ["find_transactions"]);
});

test("new-money advice tolerates intervening words while requiring an allocation target", () => {
  for (const question of ["Where exactly should I now put USD 10000?", "How can we sensibly invest a bonus?", "Where should we park spare cash?"]) {
    assert.equal(classifyAskNestIntent(question).intent, "cio_new_money_plan", question);
  }
  assert.equal(classifyAskNestIntent("Where should we put chairs?").confidence, "LOW");
  for (const question of ["Advisor advice for our portfolio", "How can I improve my investments?", "Our wealth could use better advice", "How far behind is my retirement?"]) {
    assert.equal(classifyAskNestIntent(question).intent, "cio_advice", question);
  }
  assert.equal(classifyAskNestIntent("Advisor guidance for our portfolio").intent, "cio_strategy_recommendations");
});

test("market routing combines price and news requests and does not mistake currency codes for tickers", () => {
  for (const question of ["AAPL price and news", "$aapl price and headlines"]) {
    assert.deepEqual(classifyAskNestIntent(question).recommendedTools, ["get_market_history", "search_market_news"], question);
  }
  assert.deepEqual(classifyAskNestIntent("AAPL headlines").recommendedTools, ["search_market_news"]);
  assert.deepEqual(classifyAskNestIntent("AAPL close").recommendedTools, ["get_market_history"]);
  assert.deepEqual(classifyAskNestIntent("quote history for shares").recommendedTools, ["get_market_history"]);
  assert.deepEqual(classifyAskNestIntent("stocks price history").recommendedTools, ["get_market_history"]);
  for (const currency of ["USD", "SGD", "EUR", "GBP", "AUD", "JPY", "ETF"]) {
    assert.notEqual(classifyAskNestIntent(`${currency} price and news`).intent, "market_data_and_news", currency);
  }
  for (const question of ["News for the economy", "Headlines on earnings", "Coverage about markets"]) {
    assert.equal(classifyAskNestIntent(question).intent, "market_news", question);
  }
});

test("recurring-payment language includes regular payment periods and repeated charges", () => {
  for (const question of ["Regular annual payments", "Regular monthly payment", "Regular weekly payments", "Regular payments", "Repeated expenses", "Annual charge"]) {
    assert.equal(classifyAskNestIntent(question).intent, "recurring_spend", question);
  }
});

test("unknown wording falls back to the current page with low confidence", () => {
  const pages = {
    "/credit-transactions": "find_card_transactions", "/credit-cards": "get_card_obligations", "/receivables": "get_receivables",
    "/investments": "get_investment_summary", "/cio": "get_cio_overview", "/budgets/plan": "get_budget_plan", "/transactions": "find_transactions",
  };
  for (const [page, tool] of Object.entries(pages)) {
    const result = classifyAskNestIntent("", page);
    assert.equal(result.intent, "page_context");
    assert.equal(result.confidence, "LOW");
    assert.deepEqual(result.recommendedTools, [tool]);
  }
  assert.deepEqual(classifyAskNestIntent("", "/unknown").recommendedTools, ["get_financial_snapshot"]);
});

test("planning hints state their evidentiary limits and do not request workspace data for definitions", () => {
  const conceptual = buildAskNestPlanningHint("What does nominal mean?", "/cio");
  assert.match(conceptual, /No read tool is recommended/);
  assert.match(conceptual, /without workspace data/);
  assert.match(conceptual, /not evidence/);
  const retrieval = buildAskNestPlanningHint("Find my notes");
  assert.match(retrieval, /Recommended first tool: search_workspace_knowledge/);
  assert.match(retrieval, /appears to require workspace knowledge retrieval/);
  const financial = buildAskNestPlanningHint("Show my financial overview");
  assert.match(financial, /does not appear to require workspace knowledge retrieval/);
  assert.match(financial, /not evidence/);
});

test("application CommonJS imports and ESM evaluations select the same tools and page fallbacks", () => {
  const application = createRequire(import.meta.url)("../lib/ai/ask-nest-intent.mjs");
  const cases = [
    ["AAPL price and news", "/investments"],
    ["$aapl price and headlines", "/investments"],
    ["AAPL headlines", "/investments"],
    ["AAPL close", "/investments"],
    ["Show spending on groceries", "/transactions"],
    ["Find my uploaded statement", "/transactions"],
    ["What does nominal mean?", "/cio"],
    ["", "/credit-transactions"], ["", "/credit-cards"], ["", "/receivables"],
    ["", "/investments"], ["", "/cio"], ["", "/budgets/plan"], ["", "/transactions"], ["", "/unknown"],
  ];
  for (const [question, page] of cases) {
    assert.deepEqual(application.classifyAskNestIntent(question, page), classifyAskNestIntent(question, page));
    assert.equal(application.buildAskNestPlanningHint(question, page), buildAskNestPlanningHint(question, page));
  }
});
