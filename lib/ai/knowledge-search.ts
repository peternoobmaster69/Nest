import { AzureKeyCredential } from "@azure/core-auth";
import { DefaultAzureCredential } from "@azure/identity";
import { SearchClient } from "@azure/search-documents";
import { trimEndCharacters } from "../string-boundaries.mjs";
import { normalizeInternalAppPath } from "../workspace-entry";

type AskNestKnowledgeDocument = {
  id: string;
  workspaceId: string;
  userId?: string | null;
  title: string;
  content: string;
  sourceType: string;
  sourceId?: string | null;
  sourceUrl?: string | null;
  contentVector?: number[];
};

export type AskNestKnowledgeResult = {
  id: string;
  title: string;
  content: string;
  sourceType: string;
  sourceId: string | null;
  href: string;
  score: number | null;
  rerankerScore: number | null;
};

type SearchGate = {
  enabled: boolean;
  evaluationPassed: boolean;
  configured: boolean;
  active: boolean;
  reason: "ACTIVE" | "DISABLED" | "EVALUATION_REQUIRED" | "NOT_CONFIGURED";
};

function enabled(value: string | undefined) {
  return value?.trim().toLocaleLowerCase() === "true";
}

function getSearchEndpoint() {
  const raw = process.env.AZURE_SEARCH_ENDPOINT?.trim();
  if (!raw) return null;
  try {
    const endpoint = new URL(raw);
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) return null;
    endpoint.pathname = trimEndCharacters(endpoint.pathname, "/");
    return endpoint.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function searchGateReason(isEnabled: boolean, evaluationPassed: boolean, configured: boolean): SearchGate["reason"] {
  if (!isEnabled) return "DISABLED";
  if (!evaluationPassed) return "EVALUATION_REQUIRED";
  return configured ? "ACTIVE" : "NOT_CONFIGURED";
}

function getSearchConfiguration() {
  const endpoint = getSearchEndpoint();
  const indexName = process.env.AZURE_SEARCH_INDEX?.trim();
  return endpoint && indexName ? { endpoint, indexName } : null;
}

export function getAskNestSearchGate(): SearchGate {
  const isEnabled = enabled(process.env.ASK_NEST_SEARCH_ENABLED);
  const evaluationPassed = enabled(process.env.ASK_NEST_SEARCH_EVAL_PASS);
  const configured = Boolean(getSearchConfiguration());
  const active = isEnabled && evaluationPassed && configured;
  return {
    enabled: isEnabled,
    evaluationPassed,
    configured,
    active,
    reason: searchGateReason(isEnabled, evaluationPassed, configured),
  };
}

function escapeOData(value: string) {
  return value.replace(/'/g, "''");
}

function safeHref(value: string | null | undefined) {
  return normalizeInternalAppPath(value, "/transactions");
}

function getSearchClient({ endpoint, indexName }: NonNullable<ReturnType<typeof getSearchConfiguration>>) {
  const queryKey = process.env.AZURE_SEARCH_QUERY_KEY?.trim();
  const credential = queryKey ? new AzureKeyCredential(queryKey) : new DefaultAzureCredential();
  return new SearchClient<AskNestKnowledgeDocument>(endpoint, indexName, credential);
}

export async function searchAskNestKnowledge(params: {
  workspaceId: string;
  userId: string;
  query: string;
  limit: number;
}): Promise<AskNestKnowledgeResult[]> {
  const configuration = getSearchConfiguration();
  if (!configuration || !enabled(process.env.ASK_NEST_SEARCH_ENABLED) || !enabled(process.env.ASK_NEST_SEARCH_EVAL_PASS)) return [];
  const client = getSearchClient(configuration);
  const semanticConfiguration = process.env.AZURE_SEARCH_SEMANTIC_CONFIGURATION?.trim() || "ask-nest-semantic";
  const filter = `workspaceId eq '${escapeOData(params.workspaceId)}' and (userId eq null or userId eq '${escapeOData(params.userId)}')`;
  const response = await client.search(params.query, {
    filter,
    queryType: "semantic",
    semanticSearchOptions: {
      configurationName: semanticConfiguration,
      captions: { captionType: "extractive", highlight: false },
      errorMode: "partial",
    },
    searchFields: ["title", "content"],
    select: ["id", "title", "content", "sourceType", "sourceId", "sourceUrl"],
    top: Math.min(8, Math.max(1, params.limit)),
    vectorSearchOptions: {
      filterMode: "preFilter",
      queries: [{
        kind: "text",
        text: params.query,
        fields: ["contentVector"],
        kNearestNeighborsCount: 50,
      }],
    },
  });
  const results: AskNestKnowledgeResult[] = [];
  for await (const result of response.results) {
    const document = result.document;
    results.push({
      id: document.id,
      title: document.title.slice(0, 180),
      content: document.content.slice(0, 1_200),
      sourceType: document.sourceType.slice(0, 60),
      sourceId: document.sourceId?.slice(0, 180) ?? null,
      href: safeHref(document.sourceUrl),
      score: result.score ?? null,
      rerankerScore: result.rerankerScore ?? null,
    });
  }
  return results;
}
