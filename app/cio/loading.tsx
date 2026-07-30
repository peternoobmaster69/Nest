import { PageFrame } from "@/components/page-frame";

export default function Loading() {
  return (
    <PageFrame title="Nest CIO" current="/cio" userName="User" userImage={null}>
      <div className="cio-page cio-page-loading" aria-busy="true" aria-label="Loading Nest CIO">
        <div className="cio-skeleton cio-skeleton-header" />
        <div className="cio-metric-grid">
          {Array.from({ length: 5 }, (_, index) => <div className="cio-skeleton cio-skeleton-metric" key={index} />)}
        </div>
        <div className="cio-content-grid">
          <div className="cio-skeleton cio-skeleton-card" />
          <div className="cio-skeleton cio-skeleton-card" />
        </div>
      </div>
    </PageFrame>
  );
}
