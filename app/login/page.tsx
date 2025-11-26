// app/login/page.tsx
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import LoginForm from "./loginForm";

export default async function LoginPage() {
  const user = await getCurrentUser();

  if (user) {
    // Already logged in → go to accounts page
    redirect("/accounts");
  }

  // Not logged in → render the login form
  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-100">
      <LoginForm />
    </main>
  );
}
