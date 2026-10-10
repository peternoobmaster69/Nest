import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";

export function invalidateTransactionGroupViews(client: QueryClient, workspaceId: string) {
  for (const root of ["transaction-groups", "transactions"] as const) {
    void client.invalidateQueries({ queryKey: queryKeys.key([root, workspaceId]), refetchType: "active" });
  }
}
