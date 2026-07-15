import { notFound } from "next/navigation";
import { requireSession } from "@/lib/require-session";

function normalizeEmail(value: string | null | undefined) {
  return value?.trim().toLowerCase() || null;
}

export function isAdminEmail(email: string | null | undefined) {
  const configuredAdmin = normalizeEmail(process.env.ADMIN);
  const candidate = normalizeEmail(email);

  return Boolean(configuredAdmin && candidate && configuredAdmin === candidate);
}

export async function requireAdminPage() {
  const session = await requireSession();

  if (!isAdminEmail(session.user?.email)) {
    notFound();
  }

  return session;
}
