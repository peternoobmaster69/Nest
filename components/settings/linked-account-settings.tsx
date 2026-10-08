"use client";

import { useQuery } from "@tanstack/react-query";
import { signIn } from "next-auth/react";
import { apiFetch as jsonRequest } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";
import { Button } from "@/components/ui/button";

type AuthProvider = { id: string; name: string; type: string };

export function LinkedAccountSettings() {
  const authProviders = useQuery({
    queryKey: queryKeys.key(["settings-auth-providers"]),
    queryFn: () => jsonRequest<Record<string, AuthProvider>>("/api/auth/providers"),
  });

  const linkedAccounts = useQuery({
    queryKey: queryKeys.key(["settings-linked-accounts"]),
    queryFn: () => jsonRequest<{ providers: string[] }>("/api/auth/accounts"),
  });
  const providers = Object.values(authProviders.data ?? {}).filter((provider) => provider.type === "oauth");

  return (
      <div className="card settings-card-block">
        <div className="settings-row settings-row-spaced">
          <div className="settings-item-copy">
            <div className="settings-section-title">Linked sign-in accounts</div>
            <div className="settings-section-copy">
              Link another verified provider while signed in. Nest never links accounts solely because email addresses match.
            </div>
          </div>
        </div>
        <div className="simple-list">
          {providers.map((provider) => {
            const linked = linkedAccounts.data?.providers.includes(provider.id) ?? false;
            return (
              <div className="crud-row" key={provider.id}>
                <span>{provider.name}</span>
                {linked ? (
                  <span className="settings-status-pill is-enabled">Linked</span>
                ) : (
                  <Button
                    className="btn btn-primary btn-xs"
                    type="button"
                    onClick={() => signIn(provider.id, { callbackUrl: "/settings" })}
                  >
                    Link account
                  </Button>
                )}
              </div>
            );
          })}
          {authProviders.isError ? <div className="settings-message" role="alert">Sign-in providers could not be loaded.</div> : null}
          {linkedAccounts.isError ? <div className="settings-message" role="alert">Linked accounts could not be loaded.</div> : null}
          {!authProviders.isLoading && !authProviders.isError && providers.length === 0 ? (
            <div className="settings-muted-message">No OAuth providers are configured for this deployment.</div>
          ) : null}
        </div>
      </div>

  );
}

