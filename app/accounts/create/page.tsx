// app/accounts/new/page.tsx
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import AccountForm from "../AccountForm";

export default async function NewAccountPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  return (
    <main className="min-h-screen bg-slate-100">
      <div className="mx-auto flex max-w-5xl justify-center px-4 py-8">
        <AccountForm mode="create" />
      </div>
    </main>
  );
}
