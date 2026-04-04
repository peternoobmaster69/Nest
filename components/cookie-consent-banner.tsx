"use client";

import { useEffect, useState } from "react";

const CONSENT_KEY = "nest_cookie_consent_v1";

export function CookieConsentBanner() {
  const [ready, setReady] = useState(false);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    try {
      setAccepted(window.localStorage.getItem(CONSENT_KEY) === "accepted");
    } catch {
      setAccepted(false);
    } finally {
      setReady(true);
    }
  }, []);

  const acceptCookies = () => {
    try {
      window.localStorage.setItem(CONSENT_KEY, "accepted");
    } catch {
      // Ignore storage write failures to avoid blocking UI.
    }
    setAccepted(true);
  };

  if (!ready || accepted) return null;

  return (
    <div className="cookie-overlay" role="dialog" aria-live="polite" aria-label="Cookie consent">
      <p className="cookie-overlay-text">
        This website uses cookies for essential sessions and security. To accept, press{" "}
        <button type="button" className="cookie-overlay-btn" onClick={acceptCookies}>
          here
        </button>
        .
      </p>
    </div>
  );
}
