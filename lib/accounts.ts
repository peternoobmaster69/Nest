import { queryOptions } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";

export type BankAccount = {
  id: string;
  workspaceId: string;
  name: string;
  bankName: string | null;
  startingCents: number;
  description: string | null;
  isActive: boolean;
  currentBalanceCents: number;
  linkedBudgetTotalCents: number;
  discrepancyCents: number;
  workspace?: { id: string; name: string };
};

export function bankAccountsQueryOptions(workspaceId?: string | null) {
  return queryOptions({
    queryKey: queryKeys.scoped("bank-accounts", workspaceId),
    queryFn: () => apiFetch<BankAccount[]>(`/api/accounts?workspaceId=${workspaceId}`),
    enabled: Boolean(workspaceId),
    staleTime: 30_000,
  });
}
