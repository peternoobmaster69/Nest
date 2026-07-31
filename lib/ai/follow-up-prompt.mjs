function asDirectPrompt(value) {
  const text = value.trim().replace(/[?!.]+$/, "").trim();
  if (!text) return value.trim();
  return `${text[0].toLocaleUpperCase()}${text.slice(1)}.`;
}

export function followUpToUserPrompt(value) {
  const suggestion = String(value ?? "").replace(/\s+/g, " ").trim();
  const assistantOffer = /^(?:(?:do you want|would you like) me to|(?:do you want|would you like) to|want me to|shall i|should i|can i|would it help if i)\s+(.+?)\s*[?!.]*$/i.exec(suggestion);
  return assistantOffer ? asDirectPrompt(assistantOffer[1]) : suggestion;
}
