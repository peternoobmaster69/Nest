import { notFound } from "next/navigation";
import { WorkspaceProvider } from "@/components/workspace-provider";
import { requireSession } from "@/lib/require-session";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";

export default async function WorkspaceLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ workspaceId: string }>;
}>) {
  const { workspaceId } = await params;
  await requireSession();

  try {
    await requireWorkspaceAccess(workspaceId);
  } catch (error) {
    if (error instanceof ApiAuthError && (error.status === 403 || error.status === 404)) {
      notFound();
    }
    throw error;
  }

  return <WorkspaceProvider workspaceId={workspaceId}>{children}</WorkspaceProvider>;
}

