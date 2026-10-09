import type { ReactNode } from "react";
import { QueryError } from "@/components/ui/query-state";

type QueryState = { isError: boolean; isLoading: boolean; error: unknown };

export function CioQueryContent({ state, title, loadingText, onRetry, children }: Readonly<{
  state: QueryState; title: string; loadingText: string; onRetry: () => void; children: ReactNode;
}>) {
  if (state.isError) {
    return <QueryError title={title} message={state.error instanceof Error ? state.error.message : undefined} onRetry={onRetry} />;
  }
  if (state.isLoading) return <div className="cio-dialog-loading" aria-busy="true">{loadingText}</div>;
  return children;
}
