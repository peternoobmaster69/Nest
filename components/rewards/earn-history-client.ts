import { workspaceFetch } from "@/lib/workspace-client";

export type EarnTransactionInput = {
  frequentFlyerId: string;
  id?: string;
  date: string;
  miles: number;
  title?: string;
  expiryDate?: string;
};

export async function saveEarnTransaction(payload: EarnTransactionInput, method: "POST" | "PATCH") {
  const response = await workspaceFetch("/api/rewards/frequent-flyer/history", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "earn",
      frequentFlyerId: payload.frequentFlyerId,
      id: payload.id,
      date: new Date(`${payload.date}T00:00:00.000Z`).toISOString(),
      miles: payload.miles,
      title: payload.title,
      expiryDate: payload.expiryDate ? new Date(`${payload.expiryDate}T00:00:00.000Z`).toISOString() : null,
    }),
  });
  if (!response.ok) {
    const errorPayload = (await response.json().catch(() => null)) as { error?: string } | null;
    const action = method === "POST" ? "add" : "update";
    throw new Error(errorPayload?.error || `Failed to ${action} earn transaction`);
  }
}
