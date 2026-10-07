import { trimEndCharacters } from "../string-boundaries.mjs";

const ACTION_VERBS = new Set([
  "analyze", "assess", "calculate", "check", "compare", "create", "estimate", "evaluate",
  "explain", "extract", "find", "identify", "list", "map", "model", "outline", "project",
  "rank", "review", "show", "summarize", "test", "track", "verify",
]);
const ASSISTANT_OFFERS = [
  "do you want me to", "would you like me to", "do you want to", "would you like to",
  "want me to", "shall i", "should i", "can i", "would it help if i",
];

function sentence(value) {
  const text = trimEndCharacters(value.replaceAll("?", "").trim(), "!.").trim();
  if (!text) return "Review the available details.";
  const bounded = text.length > 178 ? text.slice(0, 178).trimEnd() : text;
  return `${bounded[0].toLocaleUpperCase()}${bounded.slice(1)}.`;
}

function lowerFirst(value) {
  return value ? `${value[0].toLocaleLowerCase()}${value.slice(1)}` : value;
}

function afterPrefix(suggestion, prefixes) {
  const normalized = suggestion.toLocaleLowerCase();
  const prefix = prefixes.find((candidate) => normalized.startsWith(`${candidate} `));
  return prefix ? suggestion.slice(prefix.length + 1) : null;
}

function comparisonPrompt(suggestion) {
  const comparison = afterPrefix(suggestion, ["how does", "how do", "how did"]);
  if (comparison === null) return null;
  const separator = comparison.toLocaleLowerCase().indexOf(" compare ");
  if (separator <= 0 || separator + 9 >= comparison.length) return null;
  return sentence(`Compare ${lowerFirst(comparison.slice(0, separator))} ${comparison.slice(separator + 9)}`);
}

export function followUpToUserPrompt(value) {
  const suggestion = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!suggestion) return "Review the available details.";

  const assistantOffer = afterPrefix(suggestion, ASSISTANT_OFFERS);
  if (assistantOffer !== null) return sentence(assistantOffer);

  const request = afterPrefix(suggestion, ["can you", "could you", "would you", "will you"]);
  if (request !== null) return sentence(request);

  const comparison = comparisonPrompt(suggestion);
  if (comparison !== null) return comparison;

  const what = afterPrefix(suggestion, ["what is", "what are", "what was", "what were"]);
  if (what !== null) return sentence(`Show ${lowerFirst(what)}`);

  const whyAuxiliary = afterPrefix(suggestion, ["why did", "why does", "why do", "why is", "why are", "why was", "why were", "why has", "why have"]);
  if (whyAuxiliary !== null) return sentence(`Explain the reason for ${lowerFirst(whyAuxiliary)}`);

  const whAction = /^(why|how|where|when|which|who) (.+)$/i.exec(suggestion);
  if (whAction) {
    const verb = whAction[1].toLocaleLowerCase() === "why" ? "Explain" : "Show";
    return sentence(`${verb} ${whAction[1].toLocaleLowerCase()} ${whAction[2]}`);
  }

  const canI = /^(can|could|will|would|do|did|have|am) i (.+)$/i.exec(suggestion);
  if (canI) return sentence(`Assess whether I ${canI[1].toLocaleLowerCase()} ${canI[2]}`);

  const firstWord = /^([a-z]+)\b/i.exec(suggestion)?.[1].toLocaleLowerCase();
  if (ACTION_VERBS.has(firstWord) || /^break down\b/i.test(suggestion)) return sentence(suggestion);
  return sentence(`Review ${lowerFirst(suggestion)}`);
}

export function normalizeFollowUpActions(values) {
  return [...new Set((values ?? []).map(followUpToUserPrompt))].slice(0, 3);
}
