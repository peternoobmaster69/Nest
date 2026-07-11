// app/accounts/AccountForm.tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { SelectField, TextField } from "@/components/ui/form-field";
import { useToast } from "@/components/toast-provider";

export type AccountFormProps = {
  mode: "create" | "edit";
  account?: {
    Id: string;
    Name: string;
    Type: string;
    Currency: string;
    InitialAmount: number;
    IsActive: boolean;
  };
};

const ACCOUNT_TYPES = ["bank", "cash", "credit", "investment", "loan"];

export default function AccountForm({ mode, account }: AccountFormProps) {
  const router = useRouter();
  const toast = useToast();

  const [name, setName] = useState(account?.Name ?? "");
  const [type, setType] = useState(account?.Type ?? "bank");
  const [currency, setCurrency] = useState(account?.Currency ?? "SGD");
  const [initialAmount, setInitialAmount] = useState(
    account?.InitialAmount ?? 0
  );
  const [isActive, setIsActive] = useState(account?.IsActive ?? true);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const payload = {
        name,
        type,
        currency,
        initialAmount: Number(initialAmount) || 0,
        isActive,
      };

      const url =
        mode === "create"
          ? "/api/accounts"
          : `/api/accounts/${account?.Id}`;

      const method = mode === "create" ? "POST" : "PUT";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error || "Failed to save account");
        setLoading(false);
        return;
      }

      router.push("/accounts");
      router.refresh();
      toast.success(mode === "create" ? "Account created" : "Account updated");
    } catch (err) {
      console.error(err);
      setError("Something went wrong");
      setLoading(false);
    }
  }

  return (
    <div className="card account-form-card">
      <form onSubmit={handleSubmit} className="form-stack">
          <TextField
            label="Name"
            placeholder="e.g. DBS Savings"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        <div className="form-grid form-grid-2">
            <SelectField
              label="Type"
              value={type}
              onChange={(e) => setType(e.target.value)}
              required
            >
              {ACCOUNT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </option>
              ))}
            </SelectField>
            <TextField
              label="Currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              maxLength={3}
              pattern="[A-Za-z]{3}"
              hint="Three-letter currency code, for example SGD."
              required
            />
        </div>
          <TextField
            label="Initial amount"
            type="number"
            step="0.01"
            value={initialAmount}
            onChange={(e) => setInitialAmount(Number(e.target.value))}
          />

        {/* Active toggle only in edit */}
        {mode === "edit" && (
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            <span>Active account</span>
          </label>
        )}

        {error && <p className="form-error" role="alert">{error}</p>}

        <div className="form-actions">
          <Button
            type="submit"
            loading={loading}
            variant="primary"
          >
            {loading
              ? mode === "create"
                ? "Creating…"
                : "Saving…"
              : mode === "create"
              ? "Create account"
              : "Save changes"}
          </Button>

          <Button
            type="button"
            onClick={() => router.push("/accounts")}
            variant="ghost"
          >
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
