// app/login/page.tsx
import { redirect } from "next/navigation";
import { DATABASE_UNAVAILABLE_MESSAGE, isDatabaseUnavailableError } from "@/lib/database-errors";
import { getCurrentUser } from "@/lib/session";
import LoginForm from "./loginForm";

export default async function LoginPage() {
  let initialError: string | null = null;
  let user = null;

  try {
    user = await getCurrentUser();
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      initialError = DATABASE_UNAVAILABLE_MESSAGE;
    } else {
      throw error;
    }
  }

  if (user) {
    // Already logged in → go to accounts page
    redirect("/accounts");
  }

  // Not logged in → render the login form
  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-100">
      <LoginForm initialError={initialError} />
    </main>
  );
}
