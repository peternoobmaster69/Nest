// app/accounts/page.tsx
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import AccountsPageClient from "./AccountsPageClient";

export default async function AccountsPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/"); // or "/login" if that's what you want
  }

  // UI lives in the client component; look & feel unchanged
  return <AccountsPageClient />;
}
