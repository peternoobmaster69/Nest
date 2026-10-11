export type WorkspaceMember = {
  user: { id: string; name: string | null; email: string | null };
};

export type SubAccount = {
  id: string;
  name: string;
  availableCents: number;
};

export type SetupItem = {
  id: string;
  title: string;
  amountCents: number;
  isMonthly: boolean;
  destinationSubAccountId: string | null;
  destinationSubAccount?: SubAccount | null;
};

export type SetupSource = {
  id: string;
  title: string;
  amountCents: number;
  ownerId: string;
  owner?: { id: string; name: string | null; email: string | null } | null;
};

export type MonthlyBudgetPlanItem = {
  id: string;
  planId: string;
  templateItemId?: string | null;
  title: string;
  amountCents: number;
  destinationSubAccountId: string | null;
  destinationSubAccount?: SubAccount | null;
  sortOrder?: number;
  appliedCents?: number;
};

export type MonthlyBudgetPlanSource = {
  id: string;
  planId: string;
  templateSourceId?: string | null;
  title: string;
  amountCents: number;
  ownerId: string;
  owner?: { id: string; name: string | null; email: string | null } | null;
  sortOrder?: number;
};

export type MonthlyBudgetPlan = {
  id: string;
  year: number;
  month: number;
  status: "DRAFT" | "CONFIRMING" | "CONFIRMED" | "REVIEW";
  confirmedAt: string | null;
  sources: MonthlyBudgetPlanSource[];
  items: MonthlyBudgetPlanItem[];
};

export type BudgetPlanData = {
  setup: {
    items: SetupItem[];
    sources: SetupSource[];
  };
  monthlyPlan: MonthlyBudgetPlan | null;
  members: WorkspaceMember[];
  subAccounts: SubAccount[];
};

export type AppContext = {
  workspaceId: string | null;
  workspaceName?: string | null;
  role?: "OWNER" | "EDITOR" | "VIEWER";
  baseCurrency?: string | null;
};

export type ModalScope = "template" | "monthly";
export type EditModalState = { scope: ModalScope; id: string | null };
export type DeleteType = "templateItem" | "templateSource" | "monthlyItem" | "monthlySource";

export type ItemFields = {
  title: string;
  amountCents: number;
  isMonthly: boolean;
  destinationSubAccountId: string | null;
};

export type SourceFields = {
  title: string;
  amountCents: number;
  ownerId: string;
};

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function requestBody(action: string, workspaceId: string, payload: Record<string, unknown> = {}) {
  return JSON.stringify({ workspaceId, action, ...payload });
}

export function toCents(value: string) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : null;
}

export function personLabel(person?: { name: string | null; email: string | null } | null) {
  return person?.name || person?.email || "Unknown member";
}

