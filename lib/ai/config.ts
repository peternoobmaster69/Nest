import OpenAI from "openai";
import { trimEndCharacters } from "../string-boundaries.mjs";

export class AiConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiConfigurationError";
  }
}

export type AiWorkloadConfig = {
  baseURL: string;
  apiKey: string;
  model: string;
};

function normalizeAiWorkloadBaseUrl(value: string) {
  const input = value.trim();
  if (!input) {
    throw new AiConfigurationError("AI_WORKLOAD_ENDPOINT is required.");
  }

  let endpoint: URL;
  try {
    endpoint = new URL(input);
  } catch {
    throw new AiConfigurationError("AI_WORKLOAD_ENDPOINT must be a valid URL.");
  }

  if (endpoint.protocol !== "https:") {
    throw new AiConfigurationError("AI_WORKLOAD_ENDPOINT must use HTTPS.");
  }
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new AiConfigurationError("AI_WORKLOAD_ENDPOINT must not contain credentials, a query, or a fragment.");
  }

  let path = trimEndCharacters(endpoint.pathname, "/");
  if (path.endsWith("/openai/v1/responses")) {
    path = path.slice(0, -"/responses".length);
  } else if (!path.endsWith("/openai/v1")) {
    if (path.includes("/openai/deployments/")) {
      throw new AiConfigurationError(
        "AI_WORKLOAD_ENDPOINT must be the Azure OpenAI resource endpoint, not a deployment URL.",
      );
    }
    path = `${path}/openai/v1`;
  }

  endpoint.pathname = `${path.replace(/^\/+/, "/")}/`;
  return endpoint.toString();
}

function getAiWorkloadConfig(): AiWorkloadConfig {
  const apiKey = process.env.AI_WORKLOAD_API_KEY?.trim();
  const model = process.env.AI_WORKLOAD_MODEL?.trim();
  if (!apiKey) {
    throw new AiConfigurationError("AI_WORKLOAD_API_KEY is required.");
  }
  if (!model) {
    throw new AiConfigurationError("AI_WORKLOAD_MODEL is required.");
  }

  return {
    baseURL: normalizeAiWorkloadBaseUrl(process.env.AI_WORKLOAD_ENDPOINT || ""),
    apiKey,
    model,
  };
}

let cachedClient: { signature: string; client: OpenAI } | null = null;

export function getAiWorkloadClient(deployment?: string | null) {
  const config = getAiWorkloadConfig();
  const signature = `${config.baseURL}\u0000${config.model}\u0000${config.apiKey}`;
  if (cachedClient?.signature === signature) {
    return { client: cachedClient.client, model: deployment || config.model };
  }

  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    maxRetries: 1,
    timeout: 30_000,
  });
  cachedClient = { signature, client };
  return { client, model: deployment || config.model };
}

export function getAiWorkloadStatus() {
  try {
    const config = getAiWorkloadConfig();
    return { configured: true, model: config.model };
  } catch {
    return { configured: false, model: process.env.AI_WORKLOAD_MODEL?.trim() || null };
  }
}
