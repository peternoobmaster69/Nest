import { Skeleton } from "@/components/ui/Skeleton";

/*
Structural inventory: Collaborators page
Route: /collaborators
Layout regions: PageFrame chrome static; workspace/share controls render synchronously from context where available.
Content blocks:
- Collaborator rows: .simple-list > .crud-row; left member identity line, right inline role badge and optional Remove button.
- Pending invite rows: same .crud-row structure; left email, right timestamp.
- Audit logs: .audit-timeline > .audit-item with 12px dot column and .audit-content card containing 13px details and 11px metadata.
Do not skeletonize: section headings, invite form fields/buttons, workspace-management chrome, status message card.
*/
export function CollaboratorsRowsSkeleton() {
  return (
    <>
      {Array.from({ length: 3 }).map((_, index) => (
        <div className="crud-row" key={index}>
          <Skeleton width={index === 1 ? 188 : 144} height={17} borderRadius="4px" />
          <div style={{ display: "inline-flex", gap: "8px", alignItems: "center" }}>
            <Skeleton width={48} height={13} borderRadius="4px" />
            <Skeleton width={62} height={28} borderRadius="var(--r-sm)" />
          </div>
        </div>
      ))}
    </>
  );
}

/*
Structural inventory: Pending invite rows
Same .crud-row shell as loaded invites, preserving email left and timestamp right alignment.
*/
export function CollaboratorsInvitesSkeleton() {
  return (
    <>
      {Array.from({ length: 2 }).map((_, index) => (
        <div className="crud-row" key={index}>
          <Skeleton width={index === 0 ? 184 : 142} height={17} borderRadius="4px" />
          <Skeleton width={136} height={13} borderRadius="4px" />
        </div>
      ))}
    </>
  );
}

/*
Structural inventory: Audit timeline rows
Preserves .audit-item grid, timeline dot, and .audit-content padding/radius while replacing detail/meta text.
*/
export function CollaboratorsAuditSkeleton() {
  return (
    <>
      {Array.from({ length: 3 }).map((_, index) => (
        <div className="audit-item" key={index}>
          <div className="audit-dot" aria-hidden="true" />
          <div className="audit-content">
            <Skeleton width={index === 1 ? "82%" : "68%"} height={18} borderRadius="4px" />
            <Skeleton width={index === 1 ? 180 : 142} height={13} borderRadius="4px" />
          </div>
        </div>
      ))}
    </>
  );
}
