// components/Header.tsx
"use client";

import Link from "next/link";
import { useState } from "react";
import { Landmark } from "lucide-react";

type HeaderProps = {
  user:
    | {
        Id: string;
        Email: string;
        Phone: string;
        Name: string | null;
        CreatedAt: string;
      }
    | null;
};

export default function Header({ user }: HeaderProps) {
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    try {
      setLoggingOut(true);
      await fetch("/api/auth/logout", { method: "POST" });
      window.location.assign("/login");
    } catch (e) {
      console.error("Logout failed", e);
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <header
      className="
        fixed inset-x-0 top-0 z-20
        border-b border-slate-200
        bg-white/80 backdrop-blur
      "
    >
      <div className="mx-auto flex h-14 max-w-8xl items-center justify-between px-4">
        {/* App name / logo */}
        <Link
          href="/accounts"
          className="flex items-center gap-2 text-sm font-semibold text-primary"
        >
          <Landmark size={24} strokeWidth={1.4} />
          <span>SaveTogether</span>
        </Link>

        {/* Right side: auth buttons */}
        <div className="flex items-center gap-3">
          {user ? (
            <>
              <span className="hidden text-xs text-slate-600 sm:inline">
                Hi, {user.Name || user.Email}
              </span>
              <button
                onClick={handleLogout}
                disabled={loggingOut}
                className="
                  rounded-full px-3 py-1 text-xs font-medium
                  bg-slate-900 text-white
                  hover:shadow-[0_0_10px_rgba(15,23,42,0.5)]
                  transition disabled:opacity-60
                "
              >
                {loggingOut ? "Logging out…" : "Log out"}
              </button>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="
                  rounded-full px-3 py-1 text-xs font-medium
                  border border-slate-300 text-slate-700
                  hover:bg-slate-100 transition
                "
              >
                Log in
              </Link>
              <Link
                href="/register"
                className="
                  rounded-full px-3 py-1 text-xs font-medium
                  bg-slate-900 text-white
                  hover:shadow-[0_0_10px_rgba(15,23,42,0.5)]
                  transition
                "
              >
                Sign up
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
