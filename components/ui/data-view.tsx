import { HTMLAttributes, ReactNode } from "react";

export function DataView({ className = "", children, ...props }: Readonly<HTMLAttributes<HTMLDivElement>>) {
  return <div className={`data-view ${className}`.trim()} {...props}>{children}</div>;
}

export function MobileDataCard({ children, className = "" }: Readonly<{ children: ReactNode; className?: string }>) {
  return <article className={`mobile-data-card ${className}`.trim()}>{children}</article>;
}

export function DataValue({ label, children, priority = "normal" }: Readonly<{ label: string; children: ReactNode; priority?: "high" | "normal" | "low" }>) {
  return (
    <div className={`data-value data-value-${priority}`}>
      <span>{label}</span>
      <strong>{children}</strong>
    </div>
  );
}
