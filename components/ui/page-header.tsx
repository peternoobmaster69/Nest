import { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  filters,
}: {
  title: string;
  description?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  filters?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-header-main">
        <div className="page-header-copy">
          {eyebrow ? <div className="page-header-eyebrow">{eyebrow}</div> : null}
          <h1 className="page-header-title">{title}</h1>
          {description ? <div className="page-header-description">{description}</div> : null}
        </div>
        {actions ? <div className="page-header-actions">{actions}</div> : null}
      </div>
      {filters ? <div className="page-header-filters">{filters}</div> : null}
    </header>
  );
}
