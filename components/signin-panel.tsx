"use client";

import { signIn } from "next-auth/react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

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

export function SignInPanel() {
  const [providers, setProviders] = useState<ProviderMap>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    fetch("/api/auth/providers")
      .then((res) => res.json())
      .then((data) => {
        if (mounted) {
          setProviders(data || {});
          setLoading(false);
        }
      })
      .catch(() => {
        if (mounted) {
          setLoading(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  const providerList = Object.values(providers);

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

          {!loading && !providerList.length && (
            <p className="signin-error">
              No auth providers configured.
            </p>
          )}

          {providerList.map((provider) => (
            <button
              key={provider.id}
              className="signin-provider-btn"
              onClick={() => signIn(provider.id, { callbackUrl: "/" })}
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
