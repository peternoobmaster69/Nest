import { notFound, redirect } from "next/navigation";
import AdminRoute from "@/app/admin/page";
import BudgetPlanRoute from "@/app/budgets/plan/page";
import CreditAlertsRoute from "@/app/credit-alerts/page";
import CreditCardsRoute from "@/app/credit-cards/page";
import CreditTransactionsRoute from "@/app/credit-transactions/page";
import InvestmentsRoute from "@/app/investments/page";
import ProfileRoute from "@/app/profile/page";
import ReceivablesRoute from "@/app/receivables/page";
import RewardsRoute from "@/app/rewards/page";
import SettingsRoute from "@/app/settings/page";
import TransactionsRoute from "@/app/transactions/page";
import { DashboardShell } from "@/components/dashboard-shell";
import { requireSession } from "@/lib/require-session";
import { buildWorkspacePath } from "@/lib/workspace-entry";

type WorkspacePageProps = {
  params: Promise<{ workspaceId: string; path?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function WorkspacePage({ params, searchParams }: Readonly<WorkspacePageProps>) {
  const { workspaceId, path = [] } = await params;
  const route = path.join("/");

  switch (route) {
    case "": {
      const session = await requireSession();
      return (
        <DashboardShell
          userName={session.user?.name || session.user?.email || "Nest User"}
          userEmail={session.user?.email || ""}
          userImage={session.user?.image || null}
        />
      );
    }
    case "admin":
      return <AdminRoute />;
    case "accounts":
      return redirect(buildWorkspacePath(workspaceId, "/settings?tab=workspaces#bank-accounts"));
    case "budgets":
      return redirect(buildWorkspacePath(workspaceId));
    case "budgets/plan":
      return <BudgetPlanRoute />;
    case "collaborators":
      return redirect(buildWorkspacePath(workspaceId, "/settings?tab=workspaces"));
    case "credit-alerts":
      return <CreditAlertsRoute />;
    case "credit-cards":
      return <CreditCardsRoute />;
    case "credit-transactions":
      return <CreditTransactionsRoute />;
    case "investments":
      return <InvestmentsRoute />;
    case "profile":
      return <ProfileRoute />;
    case "receivables":
      return <ReceivablesRoute />;
    case "rewards":
      return <RewardsRoute />;
    case "settings": {
      const raw = await searchParams;
      const settingsSearchParams = Promise.resolve({
        tab: typeof raw.tab === "string" ? raw.tab : undefined,
      });
      return <SettingsRoute searchParams={settingsSearchParams} />;
    }
    case "transactions":
      return <TransactionsRoute />;
    default:
      notFound();
  }
}
