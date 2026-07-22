"use client";

import { createContext, Fragment, type ReactNode, useContext } from "react";
import { usePathname } from "next/navigation";
import { getWorkspaceIdFromPathname } from "@/lib/workspace-entry";

const WorkspaceIdContext = createContext<string | null>(null);

export function WorkspaceProvider({
  workspaceId,
  children,
}: {
  workspaceId: string;
  children: ReactNode;
}) {
  return (
    <WorkspaceIdContext.Provider value={workspaceId}>
      <Fragment key={workspaceId}>{children}</Fragment>
    </WorkspaceIdContext.Provider>
  );
}

export function useWorkspaceId() {
  const contextWorkspaceId = useContext(WorkspaceIdContext);
  const pathname = usePathname();
  return contextWorkspaceId ?? getWorkspaceIdFromPathname(pathname);
}
