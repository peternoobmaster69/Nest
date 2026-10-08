const ACTION_VERBS = String.raw`deduct|subtract|minus|spent|spend|paid|pay|bought|buy|deposit|withdrew|withdraw|refund(?:ed)?|record|log|received|receive|got paid|top(?:ped)? up|credit|debit|charge[ds]?|took|take \S+ (?:out|off)|minus`;
const EDIT_VERBS = `add(?:ed)?|got|create|move|transfer|delete|remove|undo|void|update|edit|change|correct|fix|rename|make (?:it|that)|put`;
const QUESTION_WORDS = new Set([
  "how", "what", "why", "when", "where", "which", "who", "whose", "did", "do", "does",
  "have", "has", "is", "are", "was", "were", "am", "should", "shall", "will", "would",
  "compare", "show", "list", "summarise", "summarize", "explain", "find",
]);
const POLITE_REQUEST = /^\s*(?:(?:can|could|would|will) you|please|pls|help me|i (?:want|need|would like) to|i'd like to|let's|lets)\b/i;

function startsWithQuestion(text: string) {
  const word = /^[a-z]+\b/i.exec(text);
  if (word && QUESTION_WORDS.has(word[0].toLowerCase())) return true;
  return /^(?:tell|give) me\b/i.test(text);
}

/** Only routes Ask Nest input to the drafting UI. It never authorizes a write. */
export function isTransactionRequest(message: string) {
  const text = message.trim();
  if (!text) return false;
  const imperative = new RegExp(String.raw`\b(?:${ACTION_VERBS})\b`, "i").test(text)
    || new RegExp(String.raw`\b(?:${EDIT_VERBS})\b.*(?:\$|\d|transaction|expense|income|payment|entry|salary|allowance|bonus|refund|fare|bill)`, "i").test(text);
  if (!imperative) return false;
  // "Can you add $10…" is a request; "How much did I spend?" and "Did I pay…?" are questions.
  if (POLITE_REQUEST.test(text)) return true;
  if (startsWithQuestion(text)) return false;
  return !/\?\s*$/.test(text) || /\b(?:deduct|record|log)\b/i.test(text);
}

/** Offers "Record this instead" under an answer: the message states an amount and does not read as a question. */
export function couldBeTransaction(message: string) {
  const text = message.trim();
  const hasAmount = /(?:\$|\b(?:sgd|usd|s\$))\s*\d/i.test(text)
    || /\b\d+(?:\.\d{1,2})?\s*(?:dollars|bucks|sgd)\b/i.test(text);
  return hasAmount && !startsWithQuestion(text) && !/\?\s*$/.test(text);
}
