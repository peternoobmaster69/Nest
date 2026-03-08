import { DashboardShell } from "@/components/dashboard-shell";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";
import Image from "next/image";
import Link from "next/link";

export default async function Home() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return (
      <main className="home-public">
        <section className="home-public-card">
          <Image src="/icon.svg" alt="Nest Personal Finance Companion" width={56} height={56} className="home-public-logo" />
          <h1>Nest Personal Finance Companion</h1>
          <p>
            Track bank balances, sub-accounts, credit cards, receivables, and rewards in one place. Nest helps you stay aligned
            between bank balances and account allocations with clear, guided workflows.
          </p>
          <div className="home-public-cta">
            <Link href="/signin" className="home-public-signin">
              Sign in
            </Link>
            <Link href="/privacy-policy" target="_blank" rel="noopener noreferrer">
              Privacy Policy
            </Link>
            <Link href="/terms-of-service" target="_blank" rel="noopener noreferrer">
              Terms of Service
            </Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <DashboardShell
      userName={session.user.name || session.user.email || "Nest User"}
      userEmail={session.user.email || ""}
    />
  );
}
