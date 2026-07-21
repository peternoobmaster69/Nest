import { getDatabaseReadyServerSession } from "@/lib/server-session";
import { redirect } from "next/navigation";

export async function requireSession() {
  const session = await getDatabaseReadyServerSession();
  if (!session?.user) {
    redirect("/signin");
  }
  return session;
}
