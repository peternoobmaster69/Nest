import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Droplets } from "lucide-react";
import type { CioSnapshot, CioSetupSection } from "@/components/cio/types";
import { formatCioMoney } from "@/components/cio/cio-format";
import { Button } from "@/components/ui/button";

export function CioLiquidityCard({
  overview,
  onConfigure,
}: Readonly<{
  overview: CioSnapshot;
  onConfigure: (section: CioSetupSection) => void;
}>) {
  const { liquidity, recurringFlows, baseCurrency } = overview;
  const totalLiquidity = liquidity.immediateCents + liquidity.liquidCents + liquidity.restrictedCents + liquidity.lockedCents;
  const runwayDescription = liquidityRunwayDescription(
    liquidity.essentialMonthlyExpenseCents,
    liquidity.emergencyRunwayMonths,
  );

  return (
    <section className="cio-card cio-liquidity-card" aria-labelledby="cio-liquidity-title">
      <header className="cio-card-header">
        <div>
          <span className="cio-card-eyebrow">Liquidity and flows</span>
          <h2 id="cio-liquidity-title">Funding resilience</h2>
          <p>{runwayDescription}</p>
        </div>
        <Droplets size={24} aria-hidden="true" />
      </header>

      <dl className="cio-liquidity-list">
        <LiquidityRow label="Immediate" value={liquidity.immediateCents} total={totalLiquidity} currency={baseCurrency} />
        <LiquidityRow label="Liquid" value={liquidity.liquidCents} total={totalLiquidity} currency={baseCurrency} />
        <LiquidityRow label="Restricted" value={liquidity.restrictedCents} total={totalLiquidity} currency={baseCurrency} />
        <LiquidityRow label="Locked" value={liquidity.lockedCents} total={totalLiquidity} currency={baseCurrency} />
      </dl>

      <div className="cio-flow-summary">
        <FlowMetric icon={<ArrowDownLeft size={16} />} label="External contributions" value={recurringFlows.externalContributionAnnualCents} currency={baseCurrency} />
        <FlowMetric icon={<ArrowUpRight size={16} />} label="External withdrawals" value={recurringFlows.externalWithdrawalAnnualCents} currency={baseCurrency} />
        <FlowMetric icon={<ArrowLeftRight size={16} />} label="Internal reallocations" value={recurringFlows.internalReallocationAnnualCents} currency={baseCurrency} />
      </div>
      <div className="cio-card-footer">
        <span>Net external: <strong>{formatCioMoney(recurringFlows.netExternalContributionAnnualCents, baseCurrency)}/year</strong></span>
        <Button variant="outline" size="sm" onClick={() => onConfigure("flows")}>Manage flows</Button>
      </div>
    </section>
  );
}

export function liquidityRunwayDescription(
  essentialMonthlyExpenseCents: number | null,
  emergencyRunwayMonths: number | null,
) {
  if (essentialMonthlyExpenseCents === null) {
    return "Set essential monthly spending to calculate emergency runway.";
  }
  if (essentialMonthlyExpenseCents === 0) {
    return "Essential monthly spending is set to zero; emergency runway does not apply.";
  }
  return emergencyRunwayMonths === null
    ? "Emergency runway is not available."
    : `${emergencyRunwayMonths.toFixed(1)} months of essential spending is readily available.`;
}

function LiquidityRow({ label, value, total, currency }: Readonly<{ label: string; value: number; total: number; currency: string }>) {
  const percentage = total ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <dt><span>{label}</span><small>{percentage}%</small></dt>
      <dd>{formatCioMoney(value, currency)}</dd>
    </div>
  );
}

function FlowMetric({ icon, label, value, currency }: Readonly<{ icon: React.ReactNode; label: string; value: number; currency: string }>) {
  return <div><span aria-hidden="true">{icon}</span><small>{label}</small><strong>{formatCioMoney(value, currency)}/yr</strong></div>;
}
