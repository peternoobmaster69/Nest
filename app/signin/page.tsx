import { SignInPanel } from "@/components/signin-panel";
import { authOptions } from "@/lib/auth";
import { DATABASE_UNAVAILABLE_MESSAGE, isDatabaseUnavailableError } from "@/lib/database-errors";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

function getSignInErrorMessage(error: string | undefined) {
  if (!error) return null;

  switch (error) {
    case "Callback":
      return "Sign-in could not be completed. The database is currently unavailable, so your session could not be created.";
    case "OAuthCallback":
    case "OAuthSignin":
    case "OAuthCreateAccount":
      return "The provider sign-in flow failed. Please try again.";
    case "AccessDenied":
      return "Access was denied for this sign-in attempt.";
    default:
      return "Sign-in could not be completed. Please try again.";
  }
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const signInErrorMessage = getSignInErrorMessage(params.error);

  try {
    const session = await getServerSession(authOptions);
    if (session?.user) {
      redirect("/");
    }
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      return <SignInPanel serviceMessage={DATABASE_UNAVAILABLE_MESSAGE} />;
    }
    throw error;
  }
  return <SignInPanel serviceMessage={signInErrorMessage} />;
}
