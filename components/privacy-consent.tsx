"use client";

import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import Link from "next/link";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/controls";
import { WebVitalsReporter } from "@/components/web-vitals-reporter";
import {
  PRIVACY_CONSENT_EVENT,
  type PrivacyConsent,
  readPrivacyConsent,
  savePrivacyConsent,
} from "@/lib/privacy-consent";

type PrivacyConsentContextValue = {
  consent: PrivacyConsent | null;
  ready: boolean;
  updateConsent: (preferences: Pick<PrivacyConsent, "analytics" | "performance">) => void;
};

const PrivacyConsentContext = createContext<PrivacyConsentContextValue | null>(null);

export function PrivacyConsentProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [consent, setConsent] = useState<PrivacyConsent | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setConsent(readPrivacyConsent());
    setReady(true);
    const onConsentChanged = (event: Event) => {
      setConsent((event as CustomEvent<PrivacyConsent>).detail);
    };
    window.addEventListener(PRIVACY_CONSENT_EVENT, onConsentChanged);
    return () => window.removeEventListener(PRIVACY_CONSENT_EVENT, onConsentChanged);
  }, []);

  const updateConsent = useCallback((preferences: Pick<PrivacyConsent, "analytics" | "performance">) => {
    setConsent(savePrivacyConsent(preferences));
  }, []);
  const value = useMemo(() => ({ consent, ready, updateConsent }), [consent, ready, updateConsent]);

  return (
    <PrivacyConsentContext.Provider value={value}>
      {children}
      <PrivacyConsentBanner />
      <OptionalTelemetry />
    </PrivacyConsentContext.Provider>
  );
}

export function usePrivacyConsent() {
  const context = useContext(PrivacyConsentContext);
  if (!context) throw new Error("usePrivacyConsent must be used within PrivacyConsentProvider");
  return context;
}

function OptionalTelemetry() {
  const { consent, ready } = usePrivacyConsent();
  if (!ready || !consent) return null;
  return (
    <>
      {consent.analytics ? <Analytics /> : null}
      {consent.performance ? <SpeedInsights /> : null}
      {consent.performance ? <WebVitalsReporter /> : null}
    </>
  );
}

function PrivacyConsentBanner() {
  const { consent, ready, updateConsent } = usePrivacyConsent();
  const [customizing, setCustomizing] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [performance, setPerformance] = useState(false);

  if (!ready || consent) return null;

  return (
    <aside className="cookie-overlay privacy-consent-banner" role="dialog" aria-modal="false" aria-labelledby="privacy-consent-title" aria-describedby="privacy-consent-description">
      <div className="privacy-consent-copy">
        <strong id="privacy-consent-title">Your privacy choices</strong>
        <p id="privacy-consent-description">
          Essential session and security storage is always on. Optional product analytics and performance measurements run only with your permission. <Link href="/privacy-policy">Privacy policy</Link>
        </p>
      </div>
      {customizing ? (
        <fieldset className="privacy-consent-options">
          <legend>Optional data</legend>
          <label>
            <Input type="checkbox" checked={analytics} onChange={(event) => setAnalytics(event.target.checked)} />
            <span><strong>Product analytics</strong><small>Helps us understand feature usage.</small></span>
          </label>
          <label>
            <Input type="checkbox" checked={performance} onChange={(event) => setPerformance(event.target.checked)} />
            <span><strong>Performance measurement</strong><small>Collects web-vital timings and no finance values.</small></span>
          </label>
        </fieldset>
      ) : null}
      <div className="privacy-consent-actions">
        <Button variant="ghost" size="sm" onClick={() => updateConsent({ analytics: false, performance: false })}>Essential only</Button>
        {customizing ? (
          <Button variant="secondary" size="sm" onClick={() => updateConsent({ analytics, performance })}>Save choices</Button>
        ) : (
          <Button variant="secondary" size="sm" onClick={() => setCustomizing(true)} aria-expanded={customizing}>Customize</Button>
        )}
        <Button variant="primary" size="sm" onClick={() => updateConsent({ analytics: true, performance: true })}>Accept optional</Button>
      </div>
    </aside>
  );
}
