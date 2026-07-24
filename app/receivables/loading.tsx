import { PageFrame } from "@/components/page-frame";
import {
  ReceivablesListSkeleton,
  ReceivablesSummarySkeleton,
} from "@/components/skeletons/ReceivablesSkeleton";

export default function Loading() {
  return (
    <PageFrame title="Receivables" current="/receivables" userName="User" userImage={null}>
      <div aria-busy="true" aria-label="Loading receivables" style={{ display: "grid", gap: "14px" }}>
        <section className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "10px" }}>
            <ReceivablesSummarySkeleton />
          </div>
          <ReceivablesListSkeleton />
        </section>
      </div>
    </PageFrame>
  );
}
