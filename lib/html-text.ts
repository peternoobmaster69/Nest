import { Parser } from "htmlparser2";

const HIDDEN_TAGS = new Set(["script", "style", "noscript", "svg", "template"]);
const SECTION_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "caption", "th", "td"]);
const LINE_BREAK_TAGS = new Set([...SECTION_TAGS, "div", "br", "tr", "section", "article"]);
const inlineText = (value: string) => value.replace(/\s+/g, " ").trim();

/** Extract plain text with one entity-decoding pass; never use the result as HTML. */
export function extractHtmlText(html: string) {
  const text: string[] = [];
  const sections: string[] = [];
  let title = "";
  let depth = 0;
  let hiddenDepth: number | null = null;
  let section: { depth: number; name: string; parts: string[] } | null = null;

  const append = (value: string) => {
    text.push(value);
    section?.parts.push(value);
  };
  const parser = new Parser({
    onopentag(name) {
      depth += 1;
      if (hiddenDepth !== null) return;
      if (HIDDEN_TAGS.has(name)) {
        hiddenDepth = depth;
        return;
      }
      if (!section && (SECTION_TAGS.has(name) || name === "title")) {
        section = { depth, name, parts: [] };
      }
      if (LINE_BREAK_TAGS.has(name)) append("\n");
    },
    ontext(value) {
      if (hiddenDepth === null) append(value);
    },
    onclosetag(name) {
      if (hiddenDepth !== null) {
        if (depth === hiddenDepth) hiddenDepth = null;
      } else {
        if (name !== "br" && LINE_BREAK_TAGS.has(name)) append("\n");
        if (section?.depth === depth) {
          const value = inlineText(section.parts.join(""));
          if (section.name === "title") title ||= value;
          else if (value) sections.push(value);
          section = null;
        }
      }
      depth -= 1;
    },
  }, { decodeEntities: true });
  parser.end(html);
  return {
    title,
    sections,
    text: text.join("").replace(/[^\S\n]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim(),
  };
}

export function htmlToText(html: string) {
  return extractHtmlText(html).text;
}
