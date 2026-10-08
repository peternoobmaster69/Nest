import type { CioAllocationBucket } from "@/lib/domains/cio/types";
import type { CioPolicyBand } from "@/components/cio/types";
import { formatCioLabel, formatCioMoney, formatCioPercent } from "@/components/cio/cio-format";

export function AllocationChart({
  title,
  buckets,
  currency,
  targetBands = [],
}: Readonly<{
  title: string;
  buckets: CioAllocationBucket[];
  currency: string;
  targetBands?: CioPolicyBand[];
}>) {
  const bandByClass = new Map(targetBands.map((band) => [band.assetClass, band]));
  const visible = buckets.filter((bucket) => bucket.valueCents !== 0 || bucket.allocationBps !== 0);

  if (!visible.length) {
    return <p className="cio-chart-empty">No classified value is available for this view yet.</p>;
  }

  return (
    <div className="cio-allocation-chart">
      <div className="cio-allocation-bars" role="img" aria-label={`${title} allocation`}>
        {visible.map((bucket, index) => {
          const band = bandByClass.get(bucket.key as CioPolicyBand["assetClass"]);
          const inBand = !band || (bucket.allocationBps >= band.minimumBps && bucket.allocationBps <= band.maximumBps);
          let policyStatus = bucket.isUnknown ? <span className="is-warning">Needs classification</span> : null;
          if (band) {
            policyStatus = (
              <span className={inBand ? "is-good" : "is-warning"}>
                {inBand ? "Within" : "Outside"} {formatCioPercent(band.minimumBps)}–{formatCioPercent(band.maximumBps)} band
              </span>
            );
          }
          return (
            <div className="cio-allocation-row" key={bucket.key}>
              <div className="cio-allocation-row-copy">
                <span className="cio-allocation-label">
                  <span className={`cio-chart-marker cio-chart-marker-${(index % 6) + 1}`} aria-hidden="true" />
                  {formatCioLabel(bucket.key)}
                </span>
                <strong>{formatCioPercent(bucket.allocationBps)}</strong>
              </div>
              <div className="cio-allocation-track" aria-hidden="true">
                <span
                  className={`cio-allocation-fill cio-allocation-fill-${(index % 6) + 1}`}
                  style={{ width: `${Math.max(bucket.allocationBps ? 1 : 0, Math.min(100, bucket.allocationBps / 100))}%` }}
                />
                {band ? (
                  <span
                    className="cio-allocation-target"
                    style={{ left: `${Math.min(100, band.targetBps / 100)}%` }}
                  />
                ) : null}
              </div>
              <div className="cio-allocation-meta">
                <span>{formatCioMoney(bucket.valueCents, currency)}</span>
                {policyStatus}
              </div>
            </div>
          );
        })}
      </div>

      <details className="cio-chart-table-toggle">
        <summary>View {title.toLowerCase()} data table</summary>
        <div className="cio-table-scroll">
          <table className="cio-data-table">
            <thead><tr><th scope="col">Category</th><th scope="col">Value</th><th scope="col">Allocation</th><th scope="col">Sources</th></tr></thead>
            <tbody>
              {visible.map((bucket) => (
                <tr key={bucket.key}>
                  <th scope="row">{formatCioLabel(bucket.key)}</th>
                  <td>{formatCioMoney(bucket.valueCents, currency)}</td>
                  <td>{formatCioPercent(bucket.allocationBps)}</td>
                  <td>{bucket.sourceCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
