const ACTION_VERB = /^(?:analyze|assess|break down|calculate|check|compare|create|estimate|evaluate|explain|extract|find|identify|list|map|model|outline|project|rank|review|show|summarize|test|track|verify)\b/i;

function sentence(value) {
  const text = value.replace(/\?/g, "").trim().replace(/[!.]+$/, "").trim();
  if (!text) return "Review the available details.";
  const bounded = text.length > 178 ? text.slice(0, 178).trimEnd() : text;
  return `${bounded[0].toLocaleUpperCase()}${bounded.slice(1)}.`;
}

function lowerFirst(value) {
  return value ? `${value[0].toLocaleLowerCase()}${value.slice(1)}` : value;
}

export function followUpToUserPrompt(value) {
  const suggestion = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!suggestion) return "Review the available details.";

  const assistantOffer = /^(?:(?:do you want|would you like) me to|(?:do you want|would you like) to|want me to|shall i|should i|can i|would it help if i)\s+(.+?)\s*[?!.]*$/i.exec(suggestion);
  if (assistantOffer) return sentence(assistantOffer[1]);

  const request = /^(?:can|could|would|will) you\s+(.+?)\s*[?!.]*$/i.exec(suggestion);
  if (request) return sentence(request[1]);

  const comparison = /^how (?:does|do|did)\s+(.+?)\s+compare\s+(.+?)\s*[?!.]*$/i.exec(suggestion);
  if (comparison) return sentence(`Compare ${lowerFirst(comparison[1])} ${comparison[2]}`);

  const what = /^what (?:is|are|was|were)\s+(.+?)\s*[?!.]*$/i.exec(suggestion);
  if (what) return sentence(`Show ${lowerFirst(what[1])}`);

  const whyAuxiliary = /^why (?:did|does|do|is|are|was|were|has|have)\s+(.+?)\s*[?!.]*$/i.exec(suggestion);
  if (whyAuxiliary) return sentence(`Explain the reason for ${lowerFirst(whyAuxiliary[1])}`);

  const whAction = /^(why|how|where|when|which|who)\s+(.+?)\s*[?!.]*$/i.exec(suggestion);
  if (whAction) {
    const verb = whAction[1].toLocaleLowerCase() === "why" ? "Explain" : "Show";
    return sentence(`${verb} ${whAction[1].toLocaleLowerCase()} ${whAction[2]}`);
  }

  const shouldI = /^should i\s+(.+?)\s*[?!.]*$/i.exec(suggestion);
  if (shouldI) return sentence(`Assess whether to ${lowerFirst(shouldI[1])}`);

  const canI = /^(can|could|will|would|do|did|have|am) i\s+(.+?)\s*[?!.]*$/i.exec(suggestion);
  if (canI) return sentence(`Assess whether I ${canI[1].toLocaleLowerCase()} ${canI[2]}`);

  if (ACTION_VERB.test(suggestion)) return sentence(suggestion);
  return sentence(`Review ${lowerFirst(suggestion)}`);
}

export function normalizeFollowUpActions(values) {
  return [...new Set((values ?? []).map(followUpToUserPrompt))].slice(0, 3);
}
