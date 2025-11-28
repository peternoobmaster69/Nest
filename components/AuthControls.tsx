"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogOut, UserRound } from "lucide-react";
import type { User } from "@/lib/session";

type AuthControlsProps = {
  user: User | null;
};

export function AuthControls({ user }: AuthControlsProps) {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    try {
      setLoggingOut(true);
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/login");
      router.refresh();
    } catch (err) {
      console.error("Logout failed", err);
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <div className="auth-controls">
      {user ? (
        <>
          <div className="auth-identity" aria-label="Signed in user">
            <UserRound size={16} />
            <span>{user.Name || user.Email}</span>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            disabled={loggingOut}
            className="auth-button"
          >
            <LogOut size={14} />
            {loggingOut ? "Logging out…" : "Log out"}
          </button>
        </>
      ) : (
        <>
          <Link href="/login" className="auth-link">
            Log in
          </Link>
          <Link href="/register" className="auth-button">
            Sign up
          </Link>
        </>
      )}
    </div>
  );
}
