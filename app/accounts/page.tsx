// app/accounts/page.tsx
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import AccountsPageClient from "./AccountsPageClient";
import { PageFrame } from "@/components/page-frame";

export default async function AccountsPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/"); // or "/login" if that's what you want
  }

  return (
    <PageFrame title="Accounts" current="/accounts" userName={user.Name || user.Email || "User"} userEmail={user.Email}>
      <AccountsPageClient />
    </PageFrame>
  );
}
