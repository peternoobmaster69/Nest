import { getDatabaseReadyServerSession } from "@/lib/server-session";
import { redirect } from "next/navigation";
import { InvitationResponse } from "./response";

export default async function InvitationPage({ params }: Readonly<{ params: Promise<{ token: string }> }>) {
  const { token } = await params;
  const path = `/invitations/${encodeURIComponent(token)}`;
  const session = await getDatabaseReadyServerSession();
  if (!session?.user?.id) redirect(`/login?callbackUrl=${encodeURIComponent(path)}`);

  return (
    <main style={{ maxWidth: 620, margin: "48px auto", padding: "0 16px" }}>
      <InvitationResponse token={token} />
    </main>
  );
}
