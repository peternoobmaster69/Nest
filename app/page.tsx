import { DashboardShell } from "@/components/dashboard-shell";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

export default async function Home() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    redirect("/signin");
  }

  return (
    <DashboardShell
      userName={session.user.name || session.user.email || "Nest User"}
      userEmail={session.user.email || ""}
    />
  );
}
