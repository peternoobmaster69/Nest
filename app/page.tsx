import { DashboardShell } from "@/components/dashboard-shell";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";
import Image from "next/image";
import Link from "next/link";

export default async function Home() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return (
      <main className="lp">
        <section className="lp-hero">
          <div className="lp-hero-copy">
            <div className="lp-badge">
              <Image src="/icon.svg" alt="Nest logo" width={20} height={20} />
              <span>Nest Personal Finance Companion</span>
            </div>
            <h1>One dashboard for your money, cards, receivables, and rewards.</h1>
            <p>
              Built for real life budgeting. Track bank balances, monitor sub-accounts, auto-capture card alerts, and keep every
              dollar allocated with clear discrepancy checks.
            </p>
            <div className="lp-hero-actions">
              <Link href="/signin" className="lp-btn-primary">
                Get Started
              </Link>
              <Link href="/privacy-policy" target="_blank" rel="noopener noreferrer" className="lp-btn-link">
                Privacy
              </Link>
              <Link href="/terms-of-service" target="_blank" rel="noopener noreferrer" className="lp-btn-link">
                Terms
              </Link>
            </div>
          </div>
          <div className="lp-hero-shot" aria-label="Nest product mockup">
            <div className="lp-mock-top">
              <span>Demo Data · Bank Accounts</span>
              <strong>$12,300.00</strong>
            </div>
            <div className="lp-mock-grid">
              <div className="lp-mock-bank">
                <p>Demo Daily Account</p>
                <strong>$4,500.00</strong>
              </div>
              <div className="lp-mock-bank">
                <p>Demo Bills Account</p>
                <strong>$2,800.00</strong>
              </div>
              <div className="lp-mock-bank">
                <p>Demo Savings Account</p>
                <strong>$5,000.00</strong>
              </div>
            </div>
            <div className="lp-mock-alert">
              <span>⚠</span>
              <p>Demo warning: bank balance to accounts discrepancy detected</p>
            </div>
            <div className="lp-mock-list">
              <div>
                <span>Groceries (Demo)</span>
                <strong>$420.00 / $500.00</strong>
              </div>
              <div>
                <span>Transport (Demo)</span>
                <strong>$280.00</strong>
              </div>
              <div>
                <span>Leisure (Demo)</span>
                <strong>-$40.00</strong>
              </div>
            </div>
          </div>
        </section>

        <section className="lp-grid">
          <article className="lp-feature">
            <h2>Bank-to-Account Accuracy</h2>
            <p>Catch discrepancies instantly when total allocated amounts do not match your configured bank balance.</p>
          </article>
          <article className="lp-feature">
            <h2>Credit Card Tracking</h2>
            <p>Manage cards securely with partial card display, transaction history, and read-only Gmail alert sync.</p>
          </article>
          <article className="lp-feature">
            <h2>Receivables Workflow</h2>
            <p>Track who owes you, when receivables are due, and what is expected this month with compact filtering.</p>
          </article>
          <article className="lp-feature">
            <h2>Rewards & Miles</h2>
            <p>Track total miles across cards and configure bank conversion rates in one place.</p>
          </article>
        </section>

        <section className="lp-screens">
          <div className="lp-screen-card">
            <h3>Auto Card Alert Ingestion</h3>
            <div className="lp-sim">
              <div className="lp-sim-row">
                <span>Email</span>
                <strong>DBS Card Transaction Alert</strong>
              </div>
              <div className="lp-sim-row">
                <span>Parsed</span>
                <strong>SGD 60.00 • Card ****4154</strong>
              </div>
              <div className="lp-sim-row">
                <span>Added To</span>
                <strong>Credit Card Transactions</strong>
              </div>
            </div>
          </div>
          <div className="lp-screen-card">
            <h3>Privacy-First Access Model</h3>
            <div className="lp-sim">
              <div className="lp-sim-row">
                <span>OAuth</span>
                <strong>Google, Apple, Facebook</strong>
              </div>
              <div className="lp-sim-row">
                <span>Email Scope</span>
                <strong>Read-only (card alerts only)</strong>
              </div>
              <div className="lp-sim-row">
                <span>Data Isolation</span>
                <strong>Per-user private workspace</strong>
              </div>
            </div>
          </div>
        </section>

        <section className="lp-footer-cta">
          <p>Ready to centralize your personal finance operations?</p>
          <Link href="/signin" className="lp-btn-primary">
            Continue to Sign In
          </Link>
        </section>
      </main>
    );
  }

  return (
    <DashboardShell
      userName={session.user.name || session.user.email || "Nest User"}
      userEmail={session.user.email || ""}
      userImage={session.user.image || null}
    />
  );
}
