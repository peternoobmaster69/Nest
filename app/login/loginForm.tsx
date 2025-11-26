"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Login failed");
        setLoading(false);
        return;
      }

      // login succeeded → redirect to accounts
      router.push("/accounts");
      router.refresh();
    } catch (err) {
      setError("Something went wrong");
      console.error(err);
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-md bg-white shadow-lg rounded-xl p-6">
      <h1 className="text-2xl font-semibold text-center mb-4">Login</h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm mb-1">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border rounded-md px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-sm mb-1">Password</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border rounded-md px-3 py-2 text-sm"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="
            w-full py-2 rounded-md text-sm font-medium
            bg-slate-900 text-white
            hover:shadow-[0_0_12px_rgba(15,23,42,0.5)]
            transition disabled:opacity-60
          "
        >
          {loading ? "Logging in…" : "Log In"}
        </button>

        <button
          type="button"
          onClick={() => router.push("/register")}
          className="
            w-full py-2 rounded-md text-sm mt-2
            border border-slate-300 text-slate-700
            hover:bg-slate-100 transition
          "
        >
          Create account
        </button>
      </form>
    </div>
  );
}
