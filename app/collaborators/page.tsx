import { redirect } from "next/navigation";
import { requireSession } from "@/lib/require-session";

export default async function CollaboratorsRoute() {
  await requireSession();
  redirect("/settings?tab=workspaces");
}
