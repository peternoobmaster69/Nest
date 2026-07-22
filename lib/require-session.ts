import { getDatabaseReadyServerSession } from "@/lib/server-session";
import { WORKSPACE_PATH_HEADER } from "@/lib/workspace-request";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export async function requireSession() {
  const session = await getDatabaseReadyServerSession();
  if (!session?.user) {
    const callbackUrl = (await headers()).get(WORKSPACE_PATH_HEADER);
    redirect(callbackUrl ? `/login?callbackUrl=${encodeURIComponent(callbackUrl)}` : "/login");
  }
  return session;
}
