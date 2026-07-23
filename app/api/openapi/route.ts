import spec from "@/generated/openapi.json";
import { isAdminEmail } from "@/lib/admin-auth";
import { getDatabaseReadyServerSession } from "@/lib/server-session";

function docsEnabled() {
  return process.env.NODE_ENV !== "production" || process.env.ENABLE_API_DOCS === "true";
}

export async function GET() {
  if (!docsEnabled()) return Response.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
  const session = await getDatabaseReadyServerSession();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized", code: "UNAUTHENTICATED" }, { status: 401 });
  }
  if (process.env.NODE_ENV === "production" && !isAdminEmail(session.user.email)) {
    return Response.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
  }
  return Response.json(spec, {
    headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
  });
}

