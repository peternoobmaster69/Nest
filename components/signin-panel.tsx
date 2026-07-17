"use client";

import { signIn } from "next-auth/react";
import { startAuthentication } from "@simplewebauthn/browser";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import {
  DATABASE_UNAVAILABLE_CODE,
  DATABASE_UNAVAILABLE_MESSAGE,
} from "@/lib/database-errors";

type ProviderMap = Record<
  string,
  {
    id: string;
    name: string;
    type: string;
  }
>;

const providerIcons: Record<string, string> = {
  google: "G",
  apple: "🍎",
  facebook: "f",
  github: "⚡",
};

export function SignInPanel({
  serviceMessage,
  callbackUrl = "/",
}: {
  serviceMessage?: string | null;
  callbackUrl?: string;
}) {
  const [providers, setProviders] = useState<ProviderMap>({});
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(serviceMessage ?? null);
  const [passkeySupported, setPasskeySupported] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const isBlockingError = errorMessage === DATABASE_UNAVAILABLE_MESSAGE;

  useEffect(() => {
    setPasskeySupported(Boolean(window.PublicKeyCredential && navigator.credentials));
    let mounted = true;
    fetch("/api/auth/providers")
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          const message =
            data?.code === DATABASE_UNAVAILABLE_CODE
              ? data?.message || DATABASE_UNAVAILABLE_MESSAGE
              : "Unable to load sign-in options right now.";
          throw new Error(message);
        }
        return data;
      })
      .then((data) => {
        if (mounted) {
          setProviders(data || {});
          setErrorMessage(serviceMessage ?? null);
          setLoading(false);
        }
      })
      .catch((error: unknown) => {
        if (mounted) {
          setErrorMessage(error instanceof Error ? error.message : "Unable to load sign-in options right now.");
          setLoading(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  const providerList = Object.values(providers).filter((provider) => provider.id !== "passkey");

  const signInWithPasskey = async () => {
    setPasskeyLoading(true);
    setErrorMessage(null);
    try {
      const optionsResponse = await fetch("/api/passkeys/authenticate/options", { method: "POST" });
      const start = await optionsResponse.json();
      if (!optionsResponse.ok) throw new Error(start.error || "Unable to start passkey sign-in.");
      const response = await startAuthentication({ optionsJSON: start.options });
      const verifyResponse = await fetch("/api/passkeys/authenticate/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId: start.challengeId, response }),
      });
      const verified = await verifyResponse.json();
      if (!verifyResponse.ok || !verified.loginToken) throw new Error(verified.error || "Passkey sign-in failed.");
      const result = await signIn("passkey", { loginToken: verified.loginToken, redirect: false, callbackUrl });
      if (result?.error) throw new Error("Passkey sign-in failed.");
      window.location.assign(result?.url || "/");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Passkey sign-in failed.");
      setPasskeyLoading(false);
    }
  };

  return (
    <main className="signin-shell">
      <div className="signin-gradient" />

      <section className="signin-card">
        <div className="signin-logo-wrap">
          <div className="signin-logo-ring">
            <Image src="/icon.svg" alt="Nest" width={40} height={40} className="signin-logo" />
          </div>
        </div>

        <h1 className="signin-title">Welcome to Nest</h1>
        <p className="signin-subtitle">
          Your personal finance companion
        </p>

        <div className="signin-divider" />

        <div className="signin-providers">
          {loading && (
            <div className="signin-loading">
              <div className="signin-spinner" />
              <span>Loading...</span>
            </div>
          )}

          {!loading && errorMessage && (
            <p className="signin-error">
              {errorMessage}
            </p>
          )}

          {!loading && !errorMessage && !providerList.length && !passkeySupported && (
            <p className="signin-error">
              No auth providers configured.
            </p>
          )}

          {!loading && !isBlockingError && passkeySupported ? (
            <button className="signin-provider-btn" type="button" onClick={signInWithPasskey} disabled={passkeyLoading}>
              <span className="signin-provider-icon"><KeyRound size={20} aria-hidden="true" /></span>
              <span className="signin-provider-text">{passkeyLoading ? "Checking passkey…" : "Continue with a passkey"}</span>
            </button>
          ) : null}

          {!isBlockingError && providerList.map((provider) => (
            <button
              key={provider.id}
              className="signin-provider-btn"
              onClick={() => signIn(provider.id, { callbackUrl })}
            >
              <span className="signin-provider-icon">
                {providerIcons[provider.id] || "🔐"}
              </span>
              <span className="signin-provider-text">
                Continue with {provider.name}
              </span>
            </button>
          ))}
        </div>

        <p className="signin-footer">
          By continuing, you agree to our{" "}
          <Link href="/terms-of-service" target="_blank" rel="noopener noreferrer">Terms of Service</Link>
          {" "}and{" "}
          <Link href="/privacy-policy" target="_blank" rel="noopener noreferrer">Privacy Policy</Link>
        </p>
      </section>
    </main>
  );
}
