"use client";

import { ArrowLeftRight, BriefcaseBusiness, Landmark, SlidersHorizontal, UserRoundCog } from "lucide-react";
import type { CioSetupSection } from "@/components/cio/types";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const SECTIONS: Array<{ id: CioSetupSection; title: string; description: string; stage: string; icon: React.ReactNode }> = [
  { id: "profile", title: "Planning profile", description: "Choose an individual or household plan, then add a retirement goal and spending needs. Current age is calculated for you.", stage: "Start here", icon: <UserRoundCog size={21} /> },
  { id: "investments", title: "Explain your investments", description: "For each account, tell us when the money is accessible and what it broadly holds.", stage: "Next", icon: <BriefcaseBusiness size={21} /> },
  { id: "flows", title: "Add recurring money", description: "Record regular contributions or withdrawals. Mark account-to-account moves as transfers.", stage: "Then", icon: <ArrowLeftRight size={21} /> },
  { id: "policy", title: "Set personal guardrails", description: "Optionally choose limits that should trigger a warning. This never places a trade.", stage: "Optional", icon: <SlidersHorizontal size={21} /> },
  { id: "positions", title: "Add other assets or debts", description: "Only add items not already tracked in Nest, such as property, CPF, or a mortgage.", stage: "If needed", icon: <Landmark size={21} /> },
];

export function CioSetupDialog({ open, onClose, onSelect }: { open: boolean; onClose: () => void; onSelect: (section: CioSetupSection) => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Set up Nest CIO" description="Build a useful plan in a few guided steps. You can save what you know and return later." size="lg" contentClassName="cio-dialog">
      <div className="cio-setup-guide" role="note">
        <strong>Recommended setup</strong>
        <p>Complete the first three sections for a useful overview. Guardrails and other assets are optional refinements.</p>
      </div>
      <div className="cio-setup-grid">
        {SECTIONS.map((section) => (
          <Button className="cio-setup-option" key={section.id} onClick={() => onSelect(section.id)}>
            <span className="cio-setup-option-icon" aria-hidden="true">{section.icon}</span>
            <span><span className="cio-setup-stage">{section.stage}</span><strong>{section.title}</strong><small>{section.description}</small></span>
          </Button>
        ))}
      </div>
    </Dialog>
  );
}
