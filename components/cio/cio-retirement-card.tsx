"use client";

import { SubmitEvent, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Calculator, Info } from "lucide-react";
import type { CioRetirementProjection, CioRetirementStatus } from "@/lib/domains/cio/types";
import type { CioSnapshot, CioSetupSection } from "@/components/cio/types";
import { RetirementProjectionChart } from "@/components/cio/charts/retirement-projection-chart";
import { formatCioDate, formatCioMoney, moneyInputFromCents, centsFromMoneyInput } from "@/components/cio/cio-format";
import { apiFetch, mutationFailureMessage } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/form-field";

export function CioRetirementCard({
  overview,
  onConfigure,
}: Readonly<{
  overview: CioSnapshot;
  onConfigure: (section: CioSetupSection) => void;
}>) {
  const [mode, setMode] = useState<"nominal" | "real">("real");
  const [scenarioOpen, setScenarioOpen] = useState(false);
  const savedAssets = moneyInputFromCents(overview.totals.retirementIncludedAssetsCents);
  const savedAnnualContribution = moneyInputFromCents(overview.annualContributions.usedExternalAnnualCents);
  const [assets, setAssets] = useState(savedAssets);
  const [annualContribution, setAnnualContribution] = useState(savedAnnualContribution);
  const mutation = useMutation({
    mutationFn: async (): Promise<CioRetirementProjection> => {
      const response = await apiFetch<{ projection: { retirement: CioRetirementStatus } }>("/api/cio/retirement-projection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentRetirementAssetsCents: centsFromMoneyInput(assets),
          annualExternalContributionCents: centsFromMoneyInput(annualContribution),
        }),
      });
      if (response.projection.retirement.status !== "READY") {
        throw new Error(`Projection assumptions are incomplete: ${response.projection.retirement.missingFields.join(", ")}`);
      }
      return response.projection.retirement.projection;
    },
  });
  const persistedProjection = overview.retirement.status === "READY" ? overview.retirement.projection : null;
  const projection = scenarioOpen && mutation.data ? mutation.data : persistedProjection;
  const baseScenario = useMemo(() => projection?.scenarios.find((scenario) => scenario.scenario === "BASE") ?? null, [projection]);

  const toggleScenario = () => {
    if (scenarioOpen) {
      mutation.reset();
      setAssets(savedAssets);
      setAnnualContribution(savedAnnualContribution);
      setScenarioOpen(false);
      return;
    }
    mutation.reset();
    setAssets(savedAssets);
    setAnnualContribution(savedAnnualContribution);
    setScenarioOpen(true);
  };

  const submitScenario = (event: SubmitEvent) => {
    event.preventDefault();
    mutation.mutate();
  };

  return (
    <section className="cio-card cio-retirement-card" aria-labelledby="cio-retirement-title">
      <header className="cio-card-header">
        <div>
          <span className="cio-card-eyebrow">Long-term planning</span>
          <h2 id="cio-retirement-title">Retirement projection</h2>
          <p>Bear, base, and bull outcomes use your saved assumptions and current retirement assets.</p>
        </div>
        {projection ? (
          <div className="cio-segmented-control is-compact" role="group" aria-label="Projection value basis">
            <Button variant="ghost" className={mode === "real" ? "is-active" : ""} onClick={() => setMode("real")} aria-pressed={mode === "real"}>Today&apos;s money</Button>
            <Button variant="ghost" className={mode === "nominal" ? "is-active" : ""} onClick={() => setMode("nominal")} aria-pressed={mode === "nominal"}>Nominal</Button>
          </div>
        ) : null}
      </header>

      {projection ? (
        <>
          {baseScenario ? (
            <div className="cio-retirement-summary">
              <div><span>Base fund at retirement</span><strong>{formatCioMoney(mode === "real" ? baseScenario.fundAtRetirementRealCents : baseScenario.fundAtRetirementNominalCents, overview.baseCurrency)}</strong></div>
              <div><span>Sustainable monthly income</span><strong>{formatCioMoney(mode === "real" ? baseScenario.sustainableMonthlyIncomeRealCents : baseScenario.sustainableMonthlyIncomeNominalCents, overview.baseCurrency)}</strong></div>
              <div><span>Base target gap / surplus</span><strong className={(mode === "real" ? baseScenario.targetGapOrSurplusRealCents : baseScenario.targetGapOrSurplusNominalCents) < 0 ? "is-negative" : "is-positive"}>{formatCioMoney(mode === "real" ? baseScenario.targetGapOrSurplusRealCents : baseScenario.targetGapOrSurplusNominalCents, overview.baseCurrency)}</strong></div>
            </div>
          ) : null}
          <RetirementProjectionChart scenarios={projection.scenarios} mode={mode} currency={overview.baseCurrency} />
          <p className="cio-assumption-note"><Info size={15} aria-hidden="true" /> Projection date {formatCioDate(projection.assumptions.asOfDate)} to {formatCioDate(projection.assumptions.retirementDate)}. This is deterministic planning, not a guarantee.</p>
        </>
      ) : (
        <div className="cio-empty-inline">
          <Calculator size={24} aria-hidden="true" />
          <div><strong>Projection assumptions are incomplete</strong><p>Missing: {overview.retirement.missingFields.map((field) => field.replaceAll("_", " ")).join(", ") || "profile details"}.</p></div>
          <Button variant="outline" size="sm" onClick={() => onConfigure("profile")}>Complete profile</Button>
        </div>
      )}

      <div className="cio-scenario-panel">
        <Button variant="ghost" size="sm" onClick={toggleScenario} aria-expanded={scenarioOpen} aria-controls="cio-scenario-form">
          <Calculator size={16} aria-hidden="true" /> {scenarioOpen ? "Close scenario" : "Try a contribution scenario"}
        </Button>
        {scenarioOpen ? (
          <form id="cio-scenario-form" className="cio-scenario-form" onSubmit={submitScenario}>
            <TextField label={`Retirement assets (${overview.baseCurrency})`} inputMode="decimal" value={assets} onChange={(event) => setAssets(event.target.value)} required />
            <TextField label={`Annual external contribution (${overview.baseCurrency})`} inputMode="decimal" value={annualContribution} onChange={(event) => setAnnualContribution(event.target.value)} required />
            <Button variant="primary" type="submit" loading={mutation.isPending}>Run scenario</Button>
            {mutation.isError ? <p className="form-error cio-form-wide" role="alert">{mutationFailureMessage(mutation.error)}</p> : null}
          </form>
        ) : null}
      </div>
    </section>
  );
}
