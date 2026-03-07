import { PageFrame } from "@/components/page-frame";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";

export default async function CollaboratorsRoute() {
  const session = await requireSession();
  const userName = session.user?.name || session.user?.email || "User";

  const workspace = await prisma.workspace.findFirst({ orderBy: { createdAt: "asc" } });
  const members = workspace
    ? await prisma.workspaceMember.findMany({
        where: { workspaceId: workspace.id },
        include: { user: true },
        orderBy: { createdAt: "asc" },
      })
    : [];

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
