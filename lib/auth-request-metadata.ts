import { AsyncLocalStorage } from "node:async_hooks";
import { isIP } from "node:net";

export type AuthRequestMetadata = {
  ipAddress: string | null;
  countryCode: string | null;
};

type RequestMetadataEnvironment = Partial<
  Pick<
    NodeJS.ProcessEnv,
    | "VERCEL"
    | "WEBSITE_INSTANCE_ID"
    | "WEBSITE_SITE_NAME"
    | "TRUST_PROXY_HEADERS"
    | "TRUSTED_COUNTRY_HEADER"
  >
>;

const authRequestMetadata = new AsyncLocalStorage<AuthRequestMetadata>();

function firstHeaderValue(value: string | null) {
  return value?.split(",", 1)[0]?.trim() || null;
}

function normalizeIpAddress(value: string | null) {
  const candidate = firstHeaderValue(value);
  if (!candidate) return null;
  if (isIP(candidate)) return candidate;

  const bracketedIpv6 = candidate.match(/^\[([^\]]+)](?::\d+)?$/);
  if (bracketedIpv6 && isIP(bracketedIpv6[1]) === 6) return bracketedIpv6[1];

  const ipv4WithPort = candidate.match(/^(.+):(\d+)$/);
  if (ipv4WithPort && isIP(ipv4WithPort[1]) === 4) return ipv4WithPort[1];
  return null;
}

function normalizeCountryCode(value: string | null) {
  const candidate = value?.trim().toUpperCase() ?? "";
  return /^[A-Z]{2}$/.test(candidate) ? candidate : null;
}

function configuredCountryHeader(request: Request, env: RequestMetadataEnvironment) {
  const headerName = env.TRUSTED_COUNTRY_HEADER?.trim().toLowerCase();
  if (!headerName || !/^[a-z0-9-]+$/.test(headerName)) return null;
  return request.headers.get(headerName);
}

export function getTrustedRequestMetadata(
  request: Request,
  env: RequestMetadataEnvironment = process.env,
): AuthRequestMetadata {
  const headers = request.headers;

  if (env.VERCEL) {
    return {
      ipAddress: normalizeIpAddress(
        headers.get("x-vercel-forwarded-for") ?? headers.get("x-forwarded-for"),
      ),
      countryCode: normalizeCountryCode(headers.get("x-vercel-ip-country")),
    };
  }

  if (env.WEBSITE_SITE_NAME || env.WEBSITE_INSTANCE_ID) {
    return {
      ipAddress: normalizeIpAddress(headers.get("x-azure-clientip")),
      countryCode: normalizeCountryCode(configuredCountryHeader(request, env)),
    };
  }

  if (env.TRUST_PROXY_HEADERS === "true") {
    return {
      ipAddress: normalizeIpAddress(
        headers.get("cf-connecting-ip") ??
          headers.get("x-real-ip") ??
          headers.get("x-forwarded-for"),
      ),
      countryCode: normalizeCountryCode(
        configuredCountryHeader(request, env) ?? headers.get("cf-ipcountry"),
      ),
    };
  }

  return { ipAddress: null, countryCode: null };
}

export function withAuthRequestMetadata<T>(request: Request, action: () => T) {
  return authRequestMetadata.run(getTrustedRequestMetadata(request), action);
}

export function getAuthRequestMetadata() {
  return authRequestMetadata.getStore() ?? { ipAddress: null, countryCode: null };
}
