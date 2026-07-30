import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { classifyMutationFailure, mutationFailureMessage } from "@/lib/api/client";

export function MutationErrorSummary({
  error,
  onReload,
  className = "",
}: {
  error: unknown;
  onReload?: () => void | Promise<void>;
  className?: string;
}) {
  if (!error) return null;
  const kind = classifyMutationFailure(error);
  const stale = kind === "stale" || kind === "conflict";
  return (
    <div className={`form-error-summary ${className}`.trim()} role="alert" tabIndex={-1}>
      <AlertTriangle size={17} aria-hidden="true" />
      <div>
        <strong>{stale ? "A newer version is available" : "Your changes were not saved"}</strong>
        <p>{mutationFailureMessage(error)}</p>
      </div>
      {stale && onReload ? (
        <Button variant="ghost" size="sm" onClick={() => void onReload()}>
          <RefreshCw size={14} aria-hidden="true" /> Reload latest
        </Button>
      ) : null}
    </div>
  );
}

