"use client";

import { MessageCircleQuestion, Settings2 } from "lucide-react";
import { useRouter } from "next/navigation";
import type { CioPolicy, CioSetupSection, CioSnapshot } from "@/components/cio/types";
import { CioHealthSummary } from "@/components/cio/cio-health-summary";
import { CioAllocationCard } from "@/components/cio/cio-allocation-card";
import { CioLiquidityCard } from "@/components/cio/cio-liquidity-card";
import { CioPolicyExceptions } from "@/components/cio/cio-policy-exceptions";
import { CioRetirementCard } from "@/components/cio/cio-retirement-card";
import { CioStrategyReportsCard } from "@/components/cio/cio-strategy-reports-card";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { useWorkspaceId } from "@/components/workspace-provider";
import { buildWorkspacePath } from "@/lib/workspace-entry";

export function CioOverview({
  overview,
  policy,
  canEdit,
  onConfigure,
}: {
  overview: CioSnapshot;
  policy: CioPolicy | null | undefined;
  canEdit: boolean;
  onConfigure: (section?: CioSetupSection) => void;
}) {
  const router = useRouter();
  const workspaceId = useWorkspaceId();
  const askCio = () => {
    document.querySelector<HTMLButtonElement>('[aria-controls="ask-nest-panel"]')?.click();
  };
  const openBankControls = () => {
    const destination = "/settings?tab=workspaces#bank-accounts";
    router.push(workspaceId ? buildWorkspacePath(workspaceId, destination) : destination);
  };
  const openSubAccounts = () => {
    const destination = "/transactions";
    router.push(workspaceId ? buildWorkspacePath(workspaceId, destination) : destination);
  };

  return (
    <div className="cio-page">
      <PageHeader
        eyebrow={<span>As of {overview.asOfDate}</span>}
        title={typeof window !== "undefined" && window.innerWidth >= 1024 ? "Your personal Chief Investment Officer (CIO)" : "Your personal CIO"}
        description="View of allocation, liquidity, and retirement readiness. Planning values stay separate from your net worth."
        actions={
          <>
            <Button variant="outline" onClick={() => onConfigure()} disabled={!canEdit} title={canEdit ? "Configure CIO inputs" : "Editor access is required"}>
              <Settings2 size={17} aria-hidden="true" /> Configure
            </Button>
            <Button variant="primary" onClick={askCio}>
              <MessageCircleQuestion size={17} aria-hidden="true" /> Ask CIO
            </Button>
          </>
        }
      />
      {!canEdit ? <p className="cio-readonly-note" role="status">You have view-only access. An owner or editor can update CIO assumptions.</p> : null}
      <CioHealthSummary overview={overview} onConfigure={(section) => onConfigure(section)} onOpenBankControls={openBankControls} onOpenSubAccounts={openSubAccounts} />
      <div className="cio-content-grid">
        <CioAllocationCard overview={overview} policy={policy?.confirmedAt ? policy : null} onConfigure={(section) => onConfigure(section)} />
        <CioLiquidityCard overview={overview} onConfigure={(section) => onConfigure(section)} />
      </div>
      <CioRetirementCard overview={overview} onConfigure={(section) => onConfigure(section)} />
      <CioPolicyExceptions overview={overview} onConfigure={(section) => onConfigure(section)} />
      <CioStrategyReportsCard canEdit={canEdit} />
      <p className="cio-disclaimer">Nest CIO provides deterministic household strategy recommendations from your recorded data and confirmed policy. It does not place trades or recommend individual securities.</p>
    </div>
  );
}
