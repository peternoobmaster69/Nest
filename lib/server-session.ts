import { authOptions } from "@/lib/auth";
import { isDatabaseWakeTransientError } from "@/lib/database-errors";
import { ensureDatabaseReady } from "@/lib/database-readiness";
import { getServerSession } from "next-auth";

export async function getDatabaseReadyServerSession() {
  try {
    return await getServerSession(authOptions);
  } catch (error) {
    if (!isDatabaseWakeTransientError(error)) throw error;
    await ensureDatabaseReady();
    return getServerSession(authOptions);
  }
}
