"use client";

import dynamic from "next/dynamic";
import type { AppShellContext } from "@/components/app-shell-context";

const WorkspaceSetupGuide = dynamic(
  () => import("@/components/onboarding/workspace-setup-guide").then((module) => module.WorkspaceSetupGuide),
  { ssr: false },
);

export function WorkspaceSetupGuideBoundary({
  workspaceId,
  context,
}: {
  workspaceId?: string | null;
  context?: AppShellContext;
}) {
  const canEdit = context?.role === "OWNER" || context?.role === "EDITOR";
  if (!workspaceId || !context?.setupProgress || !canEdit) return null;
  return (
    <WorkspaceSetupGuide
      key={workspaceId}
      workspaceId={workspaceId}
      baseCurrency={context.baseCurrency || "SGD"}
      accounts={context.accounts ?? []}
      progress={context.setupProgress}
    />
  );
}
