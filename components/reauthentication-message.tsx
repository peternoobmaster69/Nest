"use client";

import { signOut } from "next-auth/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

const RECENT_AUTHENTICATION_MESSAGES = new Set([
  "Recent authentication required",
  "Please re-authenticate to continue.",
]);

export function isRecentAuthenticationRequired(message?: string | null) {
  return message ? RECENT_AUTHENTICATION_MESSAGES.has(message.trim()) : false;
}

export function ReauthenticateButton({ className = "btn btn-primary btn-xs" }: Readonly<{ className?: string }>) {
  const [isRedirecting, setIsRedirecting] = useState(false);

  const reauthenticate = async () => {
    setIsRedirecting(true);
    const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const signInUrl = `/login?callbackUrl=${encodeURIComponent(returnTo)}`;

    try {
      await signOut({ callbackUrl: signInUrl });
    } catch {
      setIsRedirecting(false);
    }
  };

  return (
    <Button className={className} type="button" onClick={reauthenticate} disabled={isRedirecting}>
      {isRedirecting ? "Redirecting…" : "Re-authenticate"}
    </Button>
  );
}

export function ActionableAuthenticationMessage({
  message,
  className,
  role = "status",
}: Readonly<{
  message?: string | null;
  className: string;
  role?: "alert" | "status";
}>) {
  if (!message) return null;

  const requiresReauthentication = isRecentAuthenticationRequired(message);

  return (
    <div
      className={`${className}${requiresReauthentication ? " reauthentication-message" : ""}`}
      role={requiresReauthentication ? "alert" : role}
      aria-live="polite"
    >
      <span>
        {requiresReauthentication
          ? "For your security, please re-authenticate to continue. You’ll return here afterward."
          : message}
      </span>
      {requiresReauthentication ? <ReauthenticateButton /> : null}
    </div>
  );
}
