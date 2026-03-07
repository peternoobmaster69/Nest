import { PageFrame } from "@/components/page-frame";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";

export default async function CollaboratorsRoute() {
  const session = await requireSession();
  const userName = session.user?.name || session.user?.email || "User";

  let members: Array<{
    id: string;
    role: string;
    user: { id: string; name: string | null; email: string | null };
  }> = [];

  try {
    const { workspaceId } = await requireWorkspaceAccess();
    members = await prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: { user: true },
      orderBy: { createdAt: "asc" },
    });
  } catch (error) {
    if (!(error instanceof ApiAuthError) || error.status !== 404) {
      throw error;
    }
  }

  return (
    <PageFrame title="Collaborators" current="/collaborators" userName={userName}>
      <div className="card">
        <div className="simple-list">
          {members.map((m) => (
            <div key={m.id} className="crud-row">
              <span>{m.user.name || m.user.email || m.user.id}</span>
              <span style={{ color: "var(--text-tertiary)", fontSize: "11px" }}>{m.role}</span>
            </div>
          ))}
          {!members.length && <p className="muted">No collaborators yet.</p>}
        </div>
      </div>
    </PageFrame>
  );
}
