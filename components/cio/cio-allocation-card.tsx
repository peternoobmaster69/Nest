"use client";

import { useState } from "react";
import type { CioPolicy, CioSnapshot, CioSetupSection } from "@/components/cio/types";
import { AllocationChart } from "@/components/cio/charts/allocation-chart";
import { formatCioMoney } from "@/components/cio/cio-format";
import { Button } from "@/components/ui/button";

export function CioAllocationCard({
  overview,
  policy,
  onConfigure,
}: Readonly<{
  overview: CioSnapshot;
  policy: CioPolicy | null | undefined;
  onConfigure: (section: CioSetupSection) => void;
}>) {
  const [view, setView] = useState<"asset" | "geography">("asset");
  const buckets = view === "asset" ? overview.allocation.assetClasses : overview.allocation.geographies;

  return (
    <section className="cio-card cio-allocation-card" aria-labelledby="cio-allocation-title">
      <header className="cio-card-header">
        <div>
          <span className="cio-card-eyebrow">Portfolio mix</span>
          <h2 id="cio-allocation-title">Allocation</h2>
          <p>{formatCioMoney(overview.allocation.totalCents, overview.baseCurrency)} classified across investable holdings.</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => onConfigure("policy")}>Edit policy</Button>
      </header>
      <div className="cio-segmented-control" role="group" aria-label="Allocation dimension">
        <Button variant="ghost" className={view === "asset" ? "is-active" : ""} onClick={() => setView("asset")} aria-pressed={view === "asset"}>Asset class</Button>
        <Button variant="ghost" className={view === "geography" ? "is-active" : ""} onClick={() => setView("geography")} aria-pressed={view === "geography"}>Geography</Button>
      </div>
      <AllocationChart
        title={view === "asset" ? "Asset class" : "Geographic"}
        buckets={buckets}
        currency={overview.baseCurrency}
        targetBands={view === "asset" ? policy?.assetClassBands : undefined}
      />
    </section>
  );
}
