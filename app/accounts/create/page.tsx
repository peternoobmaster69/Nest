// app/accounts/new/page.tsx
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import AccountForm from "../AccountForm";
import { PageFrame } from "@/components/page-frame";
import { PageHeader } from "@/components/ui/page-header";

export default async function NewAccountPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  return (
    <PageFrame title="Add Account" current="/accounts" userName={user.Name || user.Email || "User"} userEmail={user.Email}>
      <div className="page-stack page-narrow">
        <PageHeader title="Add account" description="Create an account to track its balance and activity." />
        <AccountForm mode="create" />
      </div>
    </PageFrame>
  );
}
