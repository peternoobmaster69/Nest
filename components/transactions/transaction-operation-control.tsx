"use client";

import { Button } from "@/components/ui/button";

export function TransactionOperationControl({ operation, onChange }: Readonly<{
  operation: "DEDUCT" | "ADD";
  onChange: (operation: "DEDUCT" | "ADD") => void;
}>) {
  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <legend style={{ padding: 0, marginBottom: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>Deduct or Add</legend>
      <div className="segmented-toggle">
        <Button
          type="button"
          className={`segmented-toggle-btn segmented-toggle-btn-deduct ${operation === "DEDUCT" ? "is-active" : ""}`}
          aria-pressed={operation === "DEDUCT"}
          onClick={() => onChange("DEDUCT")}
        >
          Deduct
        </Button>
        <Button
          type="button"
          className={`segmented-toggle-btn segmented-toggle-btn-add ${operation === "ADD" ? "is-active" : ""}`}
          aria-pressed={operation === "ADD"}
          onClick={() => onChange("ADD")}
        >
          Add
        </Button>
      </div>
    </fieldset>
  );
}
