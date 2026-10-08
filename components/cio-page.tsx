"use client";

import "@/app/styles/cio.css";

import { useState } from "react";
import type { CioSetupSection } from "@/components/cio/types";
import { CioOverview } from "@/components/cio/cio-overview";
import { CioSetupDialog } from "@/components/cio/dialogs/cio-setup-dialog";
import { CioProfileDialog } from "@/components/cio/dialogs/cio-profile-dialog";
import { CioPolicyDialog } from "@/components/cio/dialogs/cio-policy-dialog";
import { CioPositionsDialog } from "@/components/cio/dialogs/cio-positions-dialog";
import { CioFlowsDialog } from "@/components/cio/dialogs/cio-flows-dialog";
import { CioInvestmentProfileDialog } from "@/components/cio/dialogs/cio-investment-profile-dialog";
import { QueryError } from "@/components/ui/query-state";
import { useCioOverview } from "@/hooks/use-cio-overview";
import { usePrivacyMode } from "@/lib/privacy-mode";

export function CioPage() {
  const { overview, policy, workspaceId, canEdit, refresh } = useCioOverview();
  usePrivacyMode(); // Re-renders CIO figures, which format through formatCioMoney, when privacy mode toggles.
  const [setupOpen, setSetupOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<CioSetupSection | null>(null);

  const openConfigure = (section?: CioSetupSection) => {
    if (!canEdit) return;
    if (section) setActiveSection(section);
    else setSetupOpen(true);
  };

  const selectSection = (section: CioSetupSection) => {
    setSetupOpen(false);
    setActiveSection(section);
  };

  if (overview.isLoading && !overview.data) {
    return <CioPageSkeleton />;
  }
  if (overview.isError || !overview.data) {
    return <QueryError title="Nest CIO is unavailable" message={overview.error instanceof Error ? overview.error.message : "The overview could not be loaded."} onRetry={() => void overview.refetch()} />;
  }

  return (
    <>
      <CioOverview overview={overview.data} policy={policy.data} canEdit={canEdit} onConfigure={openConfigure} />
      <CioSetupDialog open={setupOpen} onClose={() => setSetupOpen(false)} onSelect={selectSection} />
      <CioProfileDialog open={activeSection === "profile"} workspaceId={workspaceId} onClose={() => setActiveSection(null)} onSaved={refresh} />
      <CioPolicyDialog open={activeSection === "policy"} workspaceId={workspaceId} onClose={() => setActiveSection(null)} onSaved={refresh} />
      <CioPositionsDialog open={activeSection === "positions"} workspaceId={workspaceId} currency={overview.data.baseCurrency} onClose={() => setActiveSection(null)} onSaved={refresh} />
      <CioFlowsDialog open={activeSection === "flows"} workspaceId={workspaceId} currency={overview.data.baseCurrency} onClose={() => setActiveSection(null)} onSaved={refresh} />
      <CioInvestmentProfileDialog open={activeSection === "investments"} workspaceId={workspaceId} investments={overview.data.investments} onClose={() => setActiveSection(null)} onSaved={refresh} />
    </>
  );
}

function CioPageSkeleton() {
  return (
    <div className="cio-page cio-page-loading" aria-busy="true" aria-label="Loading Nest CIO overview">
      <div className="cio-skeleton cio-skeleton-header" />
      <div className="cio-metric-grid">
        {Array.from({ length: 5 }, (_, index) => <div className="cio-skeleton cio-skeleton-metric" key={index} />)}
      </div>
      <div className="cio-content-grid"><div className="cio-skeleton cio-skeleton-card" /><div className="cio-skeleton cio-skeleton-card" /></div>
    </div>
  );
}
