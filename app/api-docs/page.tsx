import { notFound } from "next/navigation";
import { ApiDocsClient } from "@/app/api-docs/api-docs-client";
import { requireSession } from "@/lib/require-session";
import { isAdminEmail } from "@/lib/admin-auth";

export default async function ApiDocsPage() {
  if (process.env.NODE_ENV === "production" && process.env.ENABLE_API_DOCS !== "true") {
    notFound();
  }
  const session = await requireSession();
  if (process.env.NODE_ENV === "production" && !isAdminEmail(session.user?.email)) {
    notFound();
  }
  return (
    <main aria-label="API documentation">
      <ApiDocsClient />
    </main>
  );
}
