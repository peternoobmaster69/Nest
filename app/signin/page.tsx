import { SignInPanel } from "@/components/signin-panel";
import { DATABASE_UNAVAILABLE_MESSAGE, isDatabaseUnavailableError } from "@/lib/database-errors";
import { getDatabaseReadyServerSession } from "@/lib/server-session";
import { redirect } from "next/navigation";
import { normalizeInternalAppPath } from "@/lib/workspace-entry";
import { getSignInErrorMessage } from "@/lib/signin-error";

export default async function SignInPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const signInErrorMessage = getSignInErrorMessage(params.error);
  const callbackUrl = normalizeInternalAppPath(params.callbackUrl);

  try {
    const session = await getDatabaseReadyServerSession();
    if (session?.user) {
      redirect(callbackUrl);
    }
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      return <SignInPanel serviceMessage={DATABASE_UNAVAILABLE_MESSAGE} callbackUrl={callbackUrl} />;
    }
    throw error;
  }
  return <SignInPanel serviceMessage={signInErrorMessage} callbackUrl={callbackUrl} />;
}
