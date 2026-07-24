import { Skeleton } from "@/components/ui/Skeleton";

export function GenericPageSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading page content"
      style={{ display: "grid", gap: "14px" }}
    >
      <section className="card" style={{ display: "grid", gap: "14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <Skeleton width={52} height={52} borderRadius="999px" />
          <div style={{ display: "grid", gap: "7px", flex: 1 }}>
            <Skeleton width={180} height={20} borderRadius="5px" />
            <Skeleton width={240} height={14} borderRadius="4px" />
          </div>
          <Skeleton width={92} height={34} borderRadius="var(--r-md)" />
        </div>
        <Skeleton width="100%" height={40} borderRadius="var(--r-md)" />
        <Skeleton width="72%" height={40} borderRadius="var(--r-md)" />
      </section>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "14px",
        }}
      >
        {Array.from({ length: 3 }).map((_, index) => (
          <article className="card" key={index} style={{ display: "grid", gap: "10px" }}>
            <Skeleton width={index === 1 ? 148 : 112} height={17} borderRadius="4px" />
            <Skeleton width="100%" height={14} borderRadius="4px" />
            <Skeleton width="76%" height={14} borderRadius="4px" />
            <Skeleton width={84} height={30} borderRadius="var(--r-sm)" />
          </article>
        ))}
      </section>
    </div>
  );
}
