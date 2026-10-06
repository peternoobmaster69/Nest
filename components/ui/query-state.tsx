import { ReactNode } from "react";
import { AlertTriangle, Inbox } from "lucide-react";
import { Button } from "./button";

export function QueryError({ title = "Something went wrong", message, onRetry }: Readonly<{ title?: string; message?: string; onRetry?: () => void }>) {
  return (
    <section className="state-panel state-panel-error" role="alert">
      <AlertTriangle size={24} aria-hidden="true" />
      <div>
        <h3>{title}</h3>
        {message ? <p>{message}</p> : null}
      </div>
      {onRetry ? <Button variant="primary" size="sm" onClick={onRetry}>Retry</Button> : null}
    </section>
  );
}

export function EmptyState({ title, description, action, icon }: Readonly<{ title: string; description?: string; action?: ReactNode; icon?: ReactNode }>) {
  return (
    <section className="empty-state">
      <div className="empty-state-icon" aria-hidden="true">{icon || <Inbox size={28} />}</div>
      <h3 className="empty-state-title">{title}</h3>
      {description ? <p className="empty-state-desc">{description}</p> : null}
      {action ? <div className="empty-state-action">{action}</div> : null}
    </section>
  );
}
