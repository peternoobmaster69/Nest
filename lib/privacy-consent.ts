export const PRIVACY_CONSENT_STORAGE_KEY = "nest_privacy_consent_v2";
export const PRIVACY_CONSENT_EVENT = "nest:privacy-consent-changed";

export type PrivacyConsent = {
  analytics: boolean;
  performance: boolean;
  decidedAt: string;
};

export function parsePrivacyConsent(value: string | null): PrivacyConsent | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<PrivacyConsent>;
    if (typeof parsed.analytics !== "boolean" || typeof parsed.performance !== "boolean") return null;
    return {
      analytics: parsed.analytics,
      performance: parsed.performance,
      decidedAt: typeof parsed.decidedAt === "string" ? parsed.decidedAt : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

export function readPrivacyConsent(): PrivacyConsent | null {
  if (typeof window === "undefined") return null;
  try {
    return parsePrivacyConsent(window.localStorage.getItem(PRIVACY_CONSENT_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function savePrivacyConsent(preferences: Pick<PrivacyConsent, "analytics" | "performance">) {
  const consent: PrivacyConsent = {
    ...preferences,
    decidedAt: new Date().toISOString(),
  };
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(PRIVACY_CONSENT_STORAGE_KEY, JSON.stringify(consent));
    } catch {
      // Privacy choices still apply for this page when storage is unavailable.
    }
    window.dispatchEvent(new CustomEvent<PrivacyConsent>(PRIVACY_CONSENT_EVENT, { detail: consent }));
  }
  return consent;
}

