"use client";

import Link from "next/link";
import { Bot, LayoutDashboard } from "lucide-react";
import { useWorkspaceId } from "@/components/workspace-provider";
import { buildWorkspacePath } from "@/lib/workspace-entry";

export function AdminNavigation({ current }: Readonly<{ current: "overview" | "agents" }>) {
  const workspaceId = useWorkspaceId();
  const href = (path: string) => workspaceId ? buildWorkspacePath(workspaceId, path) : path;
  return (
    <nav className="admin-section-nav" aria-label="Administration">
      <Link href={href("/admin")} aria-current={current === "overview" ? "page" : undefined}><LayoutDashboard size={16} aria-hidden="true" />Overview</Link>
      <Link href={href("/admin/agents")} aria-current={current === "agents" ? "page" : undefined}><Bot size={16} aria-hidden="true" />Agents</Link>
    </nav>
  );
}
