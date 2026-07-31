import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { extractNormalizedFinancialValues } from "@/lib/ai/serpapi-news";

const MAX_SOURCE_BYTES = 750_000;
const MAX_EXCERPT_CHARACTERS = 18_000;
const MAX_REDIRECTS = 3;

export type PublicFinancialSourceFailureCode =
  | "INVALID_URL"
  | "SOURCE_NOT_ALLOWED"
  | "PRIVATE_ADDRESS_REJECTED"
  | "UNSUPPORTED_CONTENT"
  | "SOURCE_TOO_LARGE"
  | "NO_READABLE_CONTENT"
  | "UNAVAILABLE";

export class PublicFinancialSourceError extends Error {
  code: PublicFinancialSourceFailureCode;

  constructor(code: PublicFinancialSourceFailureCode, message: string) {
    super(message);
    this.name = "PublicFinancialSourceError";
    this.code = code;
  }
}

export type PublicFinancialSourceResult = {
  title: string;
  url: string;
  domain: string;
  contentType: string;
  excerpt: string;
  normalizedFinancialValues: string[];
  retrievedAt: Date;
};

const AUTHORITATIVE_DOMAINS = [
  "bis.org",
  "ecb.europa.eu",
  "europa.eu",
  "federalreserve.gov",
  "imf.org",
  "oecd.org",
  "sec.gov",
  "sgx.com",
  "worldbank.org",
] as const;

function normalizedHostname(value: string) {
  return value.toLocaleLowerCase().replace(/^www\./, "").replace(/\.$/, "");
}

export function isAuthoritativeFinancialHostname(value: string) {
  const hostname = normalizedHostname(value);
  return hostname === "gov.sg" || hostname.endsWith(".gov.sg") ||
    hostname.endsWith(".gov") || hostname.endsWith(".gov.uk") ||
    hostname.endsWith(".gov.au") || hostname.endsWith(".go.jp") ||
    hostname.endsWith(".edu") || hostname.endsWith(".edu.sg") ||
    hostname.endsWith(".ac.uk") ||
    AUTHORITATIVE_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

function parseAllowedUrl(rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new PublicFinancialSourceError("INVALID_URL", "The public source URL is invalid.");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new PublicFinancialSourceError("INVALID_URL", "Public financial sources must use HTTPS and cannot contain credentials.");
  }
  if (!isAuthoritativeFinancialHostname(url.hostname)) {
    throw new PublicFinancialSourceError(
      "SOURCE_NOT_ALLOWED",
      "This reader is limited to government, regulator, exchange, academic, and multilateral financial sources.",
    );
  }
  url.hash = "";
  return url;
}

function isPrivateIpv4(address: string) {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return true;
  const [a, b] = octets;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19));
}

function isPrivateAddress(address: string) {
  const normalized = address.toLocaleLowerCase();
  if (normalized.startsWith("::ffff:")) return isPrivateIpv4(normalized.slice("::ffff:".length));
  if (isIP(normalized) === 4) return isPrivateIpv4(normalized);
  if (isIP(normalized) === 6) {
    return normalized === "::" || normalized === "::1" || /^f[cd]/.test(normalized) || /^fe[89ab]/.test(normalized);
  }
  return true;
}

async function assertPublicDns(url: URL) {
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(url.hostname, { all: true, verbatim: true });
  } catch {
    throw new PublicFinancialSourceError("UNAVAILABLE", "The authoritative source hostname could not be resolved.");
  }
  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new PublicFinancialSourceError("PRIVATE_ADDRESS_REJECTED", "The source resolved to a private or reserved network address.");
  }
}

async function readBoundedBody(response: Response) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let result = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_SOURCE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new PublicFinancialSourceError("SOURCE_TOO_LARGE", "The public source is too large to read safely.");
    }
    result += decoder.decode(value, { stream: true });
  }
  return result + decoder.decode();
}

function decodeHtmlEntities(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    hellip: "…",
    ldquo: "“",
    lsquo: "‘",
    lt: "<",
    nbsp: " ",
    quot: '"',
    rdquo: "”",
    rsquo: "’",
    ndash: "–",
    mdash: "—",
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, key: string) => {
    if (key.startsWith("#")) {
      const hexadecimal = key[1]?.toLocaleLowerCase() === "x";
      const codePoint = Number.parseInt(key.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      return Number.isFinite(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : entity;
    }
    return named[key.toLocaleLowerCase()] ?? entity;
  });
}

function plainHtmlText(value: string) {
  return decodeHtmlEntities(
    value
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(?:script|style|noscript|svg)\b[\s\S]*?<\/(?:script|style|noscript|svg)>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  ).replace(/[\t\f\v ]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

function extractHtmlDocument(html: string) {
  const lines: string[] = [];
  const seen = new Set<string>();
  const push = (value: string) => {
    const text = plainHtmlText(value).replace(/\s+/g, " ").trim();
    if (text.length < 2 || seen.has(text)) return;
    seen.add(text);
    lines.push(text);
  };

  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (titleMatch) push(titleMatch[1]);
  for (const match of html.matchAll(/<(h[1-6]|p|li|caption|th|td)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    push(match[2]);
    if (lines.join("\n").length >= MAX_EXCERPT_CHARACTERS) break;
  }
  if (lines.length < 2) push(html);
  const title = lines[0] || "Authoritative public financial source";
  return { title: title.slice(0, 300), excerpt: lines.join("\n").slice(0, MAX_EXCERPT_CHARACTERS) };
}

async function fetchAuthoritativeSource(initialUrl: URL) {
  let url = initialUrl;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    await assertPublicDns(url);
    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        headers: {
          Accept: "text/html, text/plain, application/json;q=0.8",
          "User-Agent": "Nest-CIO-Public-Research/1.0",
        },
        signal: AbortSignal.timeout(12_000),
      });
    } catch {
      throw new PublicFinancialSourceError("UNAVAILABLE", "The authoritative public source could not be reached.");
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirectCount === MAX_REDIRECTS) {
        throw new PublicFinancialSourceError("UNAVAILABLE", "The authoritative source returned too many redirects.");
      }
      url = parseAllowedUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) {
      throw new PublicFinancialSourceError("UNAVAILABLE", `The authoritative source returned HTTP ${response.status}.`);
    }
    return { response, url };
  }
  throw new PublicFinancialSourceError("UNAVAILABLE", "The authoritative source could not be opened.");
}

export async function readPublicFinancialSource(rawUrl: string): Promise<PublicFinancialSourceResult> {
  const initialUrl = parseAllowedUrl(rawUrl);
  const { response, url } = await fetchAuthoritativeSource(initialUrl);
  const contentType = (response.headers.get("content-type") || "").split(";", 1)[0]!.trim().toLocaleLowerCase();
  if (!contentType.startsWith("text/html") && contentType !== "text/plain" && contentType !== "application/json") {
    throw new PublicFinancialSourceError(
      "UNSUPPORTED_CONTENT",
      "The authoritative reader currently supports HTML, plain text, and JSON sources. Search-result evidence can still cite PDFs.",
    );
  }

  const body = await readBoundedBody(response);
  const document = contentType.startsWith("text/html")
    ? extractHtmlDocument(body)
    : {
        title: `Public financial source from ${normalizedHostname(url.hostname)}`,
        excerpt: body.replace(/\s+/g, " ").trim().slice(0, MAX_EXCERPT_CHARACTERS),
      };
  if (!document.excerpt) {
    throw new PublicFinancialSourceError("NO_READABLE_CONTENT", "The authoritative source contained no readable text.");
  }

  return {
    title: document.title,
    url: url.toString(),
    domain: normalizedHostname(url.hostname),
    contentType,
    excerpt: document.excerpt,
    normalizedFinancialValues: extractNormalizedFinancialValues(document.excerpt),
    retrievedAt: new Date(),
  };
}
