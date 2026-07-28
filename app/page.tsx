import { LandingSignInDialog } from "@/components/landing-signin-dialog";
import { getDatabaseReadyServerSession } from "@/lib/server-session";
import { getSignInErrorMessage } from "@/lib/signin-error";
import { normalizeInternalAppPath } from "@/lib/workspace-entry";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  BarChart3,
  Check,
  CheckCircle2,
  CircleDollarSign,
  Cloud,
  CreditCard,
  ExternalLink,
  GitFork,
  Landmark,
  Layers3,
  PiggyBank,
  ReceiptText,
  RefreshCw,
  TrendingUp,
  WalletCards,
} from "lucide-react";

export default async function Home({
  searchParams,
}: {
  searchParams?: Promise<{ login?: string; error?: string; callbackUrl?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const showSignIn = params.login === "1" || Boolean(params.error);
  const callbackUrl = normalizeInternalAppPath(params.callbackUrl);
  const signInErrorMessage = getSignInErrorMessage(params.error);
  const session = await getDatabaseReadyServerSession();
  if (!session?.user) {
    return (
      <main className="lp">
        {showSignIn || session?.sessionLimitRequired ? (
          <LandingSignInDialog
            callbackUrl={callbackUrl}
            serviceMessage={signInErrorMessage}
            sessionLimitRequired={session?.sessionLimitRequired}
          />
        ) : null}
        <header className="lp-nav">
          <Link href="/" className="lp-brand" aria-label="Nest home">
            <Image src="/icon.svg" alt="" width={30} height={30} priority />
            <span>
              <strong>Nest</strong>
              <small>Personal Finance Companion</small>
            </span>
          </Link>
          <nav className="lp-nav-links" aria-label="Landing page navigation">
            <a href="#use-nest">Use Nest</a>
            <a href="#how-it-works">How it works</a>
            <a href="#money-flows">Money flows</a>
            <a href="#monthly-rhythm">Monthly rhythm</a>
          </nav>
          <Link href="/login" className="lp-nav-signin">
            Sign in <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </header>

        <section className="lp-hero">
          <div className="lp-hero-copy">
            <h1>Know what you have, what it is for, and what comes next.</h1>
            <p>
              Nest brings your bank cash, virtual budgets, card payments, receivables, savings, and investments into one clear
              money map—without pretending they are all the same thing.
            </p>
            <div className="lp-hero-actions">
              <a href="#use-nest" className="lp-btn-primary">
                Choose how to use Nest <ArrowRight size={16} aria-hidden="true" />
              </a>
              <a href="#how-it-works" className="lp-btn-secondary">See how it works</a>
            </div>
            <div className="lp-hero-principles" aria-label="Nest's four money views">
              <span><Landmark size={14} aria-hidden="true" /> Real cash</span>
              <span><Layers3 size={14} aria-hidden="true" /> Virtual purpose</span>
              <span><WalletCards size={14} aria-hidden="true" /> Commitments</span>
              <span><TrendingUp size={14} aria-hidden="true" /> Long-term value</span>
            </div>
          </div>

          <div className="lp-hero-shot" aria-label="Example Nest money map">
            <div className="lp-mock-top">
              <span><span className="lp-live-dot" /> Your money map</span>
              <small>Example</small>
            </div>

            <div className="lp-mock-balance">
              <div>
                <small>Available bank balance</small>
                <strong>$5,000.00</strong>
              </div>
              <div className="lp-mock-balance-meta">
                <span>Allocated <strong>$4,800</strong></span>
                <span>Unallocated <strong>$200</strong></span>
              </div>
            </div>

            <div className="lp-allocation-bar" aria-label="$4,800 allocated and $200 unallocated">
              <span className="is-everyday" style={{ flex: 16 }} />
              <span className="is-bills" style={{ flex: 20 }} />
              <span className="is-card" style={{ flex: 12 }} />
              <span className="is-savings" style={{ flex: 48 }} />
              <span className="is-free" style={{ flex: 4 }} />
            </div>

            <div className="lp-mock-list">
              <div>
                <span><i className="is-everyday" /> Everyday</span>
                <strong>$800.00</strong>
              </div>
              <div>
                <span><i className="is-bills" /> Bills</span>
                <strong>$1,000.00</strong>
              </div>
              <div>
                <span><i className="is-card" /> Card settlement</span>
                <strong>$600.00</strong>
              </div>
              <div>
                <span><i className="is-savings" /> Emergency savings</span>
                <strong>$2,400.00</strong>
              </div>
            </div>

            <div className="lp-mock-equation">
              <CheckCircle2 size={17} aria-hidden="true" />
              <div>
                <strong>$5,000 bank − $4,800 assigned = $200 free</strong>
                <span>Every dollar is visible, even before it has a job.</span>
              </div>
            </div>
          </div>
        </section>

        <section className="lp-section lp-use" id="use-nest" aria-labelledby="use-nest-title">
          <div className="lp-section-head">
            <span className="lp-eyebrow">Use Nest your way</span>
            <h2 id="use-nest-title">Choose where Nest runs.</h2>
            <p>Run it on infrastructure you control, or get started on the best-effort hosted version.</p>
          </div>
          <div className="lp-use-grid">
            <article className="lp-use-card">
              <span className="lp-icon-tile is-green"><GitFork size={21} aria-hidden="true" /></span>
              <div className="lp-use-card-copy">
                <span className="lp-use-label">Your infrastructure</span>
                <h3>Host it yourself</h3>
                <p>Deploy Nest yourself and keep control of the infrastructure, database, and operating costs.</p>
              </div>
              <div className="lp-use-card-footer">
                <small>The GitHub repository will be public soon.</small>
                <a
                  href="https://github.com/peternoobmaster69/SaveTogether"
                  className="lp-btn-secondary"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View repository <ExternalLink size={15} aria-hidden="true" />
                </a>
              </div>
            </article>

            <article className="lp-use-card is-hosted">
              <span className="lp-icon-tile is-blue"><Cloud size={21} aria-hidden="true" /></span>
              <div className="lp-use-card-copy">
                <span className="lp-use-label">Best-effort service</span>
                <h3>Use the hosted version</h3>
                <p>Sign in and use this deployment without setting up your own infrastructure.</p>
              </div>
              <div className="lp-use-card-footer">
                <small>No SLA. The service may be paused when cloud spending reaches its ceiling.</small>
                <Link href="/login" className="lp-btn-primary">
                  Use hosted Nest <ArrowRight size={15} aria-hidden="true" />
                </Link>
              </div>
            </article>
          </div>
        </section>

        <section className="lp-section" id="how-it-works">
          <div className="lp-section-head">
            <span className="lp-eyebrow">The Nest model</span>
            <h2>Four views that answer four different questions.</h2>
            <p>Keeping cash, purpose, commitments, and investments distinct gives you a more honest picture of your money.</p>
          </div>
          <div className="lp-lens-grid">
            <article className="lp-lens-card">
              <span className="lp-lens-number">01</span>
              <span className="lp-icon-tile is-green"><Landmark size={20} aria-hidden="true" /></span>
              <h3>Real cash</h3>
              <p>Your bank balances are the control totals: the money that actually exists today.</p>
              <small>Answers: “How much do I have?”</small>
            </article>
            <article className="lp-lens-card">
              <span className="lp-lens-number">02</span>
              <span className="lp-icon-tile is-blue"><Layers3 size={20} aria-hidden="true" /></span>
              <h3>Virtual purpose</h3>
              <p>Sub-accounts divide bank cash into jobs such as bills, spending, savings, and goals.</p>
              <small>Answers: “What is it for?”</small>
            </article>
            <article className="lp-lens-card">
              <span className="lp-lens-number">03</span>
              <span className="lp-icon-tile is-amber"><WalletCards size={20} aria-hidden="true" /></span>
              <h3>Commitments</h3>
              <p>Card payables show what you owe. Receivables show what others still owe you.</p>
              <small>Answers: “What must happen next?”</small>
            </article>
            <article className="lp-lens-card">
              <span className="lp-lens-number">04</span>
              <span className="lp-icon-tile is-purple"><TrendingUp size={20} aria-hidden="true" /></span>
              <h3>Long-term value</h3>
              <p>Dated investment snapshots show capital invested, current value, and liquidity.</p>
              <small>Answers: “What is growing over time?”</small>
            </article>
          </div>
        </section>

        <section className="lp-reconcile" aria-labelledby="reconcile-title">
          <div className="lp-reconcile-copy">
            <span className="lp-eyebrow">One balance, many jobs</span>
            <h2 id="reconcile-title">A discrepancy is a useful signal—not a mystery.</h2>
            <p>
              Nest compares each real bank balance with the total of its virtual sub-accounts. Positive means money is still free
              to assign. Negative means you have allocated more than the bank currently holds.
            </p>
            <div className="lp-reconcile-formula">
              <span>Bank balance</span><strong>−</strong><span>Sub-account total</span><strong>=</strong><span>Unallocated</span>
            </div>
          </div>
          <div className="lp-reconcile-signals">
            <div>
              <span className="lp-signal is-positive">+$350</span>
              <p><strong>Unallocated</strong><small>New income or cash waiting for a purpose.</small></p>
            </div>
            <div>
              <span className="lp-signal is-zero"><Check size={17} aria-hidden="true" /></span>
              <p><strong>Fully assigned</strong><small>The bank and its virtual accounts agree.</small></p>
            </div>
            <div>
              <span className="lp-signal is-negative">−$90</span>
              <p><strong>Over-allocated</strong><small>A budget needs funding or the bank balance is stale.</small></p>
            </div>
          </div>
        </section>

        <section className="lp-section" id="money-flows">
          <div className="lp-section-head">
            <span className="lp-eyebrow">See the movement</span>
            <h2>Understand the full journey of your money.</h2>
            <p>A transaction is easier to act on when you can see whether it changed cash, purpose, or a future commitment.</p>
          </div>

          <div className="lp-flow-grid">
            <article className="lp-flow-card is-budget">
              <header>
                <span className="lp-icon-tile is-green"><CircleDollarSign size={21} aria-hidden="true" /></span>
                <div><small>Monthly budget</small><h3>Give incoming money a plan</h3></div>
              </header>
              <div className="lp-flow-steps">
                <div><span>1</span><p><strong>List sources</strong><small>Salary, freelance income, household contributions</small></p></div>
                <ArrowRight size={17} aria-hidden="true" />
                <div><span>2</span><p><strong>Assign every amount</strong><small>Bills, spending, savings, investing</small></p></div>
                <ArrowRight size={17} aria-hidden="true" />
                <div><span>3</span><p><strong>Confirm the month</strong><small>Fund the linked virtual sub-accounts</small></p></div>
              </div>
              <p className="lp-flow-note"><BarChart3 size={15} aria-hidden="true" /> Sources must equal items. Bank cash changes only when income actually arrives.</p>
            </article>

            <article className="lp-flow-card is-credit-payable">
              <header>
                <span className="lp-icon-tile is-amber"><CreditCard size={21} aria-hidden="true" /></span>
                <div><small >Credit-card payable</small><h3>Reserve now, pay later</h3></div>
              </header>
              <div className="lp-flow-steps">
                <div><span>1</span><p><strong>Card purchase</strong><small>The payable rises; bank cash has not moved</small></p></div>
                <ArrowRight size={17} aria-hidden="true" />
                <div><span>2</span><p><strong>Reserve the cash</strong><small>Move value from Spending to Card Settlement</small></p></div>
                <ArrowRight size={17} aria-hidden="true" />
                <div className="is-emphasis"><span>3</span><p><strong>Pay the statement</strong><small>Now the payable and bank cash both fall</small></p></div>
              </div>
              <p className="lp-flow-note"><RefreshCw size={15} aria-hidden="true" /> Resolve every charge, then refresh the bank balance after payment posts.</p>
            </article>

            <article className="lp-flow-card is-receivable">
              <header>
                <span className="lp-icon-tile is-blue"><ReceiptText size={21} aria-hidden="true" /></span>
                <div><small>Receivable</small><h3>Keep expected money visible</h3></div>
              </header>
              <div className="lp-flow-steps">
                <div><span>1</span><p><strong>You cover a cost</strong><small>Create the matching receivable</small></p></div>
                <ArrowRight size={17} aria-hidden="true" />
                <div><span>2</span><p><strong>Track it as open</strong><small>See what is owed without counting it as bank cash</small></p></div>
                <ArrowRight size={17} aria-hidden="true" />
                <div className="is-emphasis"><span>3</span><p><strong>Close when paid</strong><small>Credit the default settlement sub-account</small></p></div>
              </div>
              <p className="lp-flow-note"><CheckCircle2 size={15} aria-hidden="true" /> Close the receivable and refresh the bank balance when payment arrives.</p>
            </article>
          </div>
        </section>

        <section className="lp-assets" aria-labelledby="assets-title">
          <div className="lp-assets-intro">
            <span className="lp-eyebrow">Build beyond this month</span>
            <h2 id="assets-title">See savings and investments clearly—without double-counting.</h2>
            <p>Savings is still bank cash with a protected purpose. Investments are separate assets measured by their latest value.</p>
          </div>
          <div className="lp-assets-grid">
            <article>
              <span className="lp-icon-tile is-green"><PiggyBank size={21} aria-hidden="true" /></span>
              <div>
                <h3>Savings stays connected to cash</h3>
                <p>Use a Savings sub-account to show which bank money is protected for emergencies or goals.</p>
              </div>
              <strong className="lp-asset-value">$12,400 <small>saved</small></strong>
            </article>
            <article>
              <span className="lp-icon-tile is-purple"><TrendingUp size={21} aria-hidden="true" /></span>
              <div>
                <h3>Investments show current value</h3>
                <p>Track invested capital, market value, gain or loss, and what can be withdrawn.</p>
              </div>
              <strong className="lp-asset-value is-positive">+8.4% <small>return</small></strong>
            </article>
          </div>
        </section>

        <section className="lp-section" id="monthly-rhythm">
          <div className="lp-section-head">
            <span className="lp-eyebrow">A calm operating rhythm</span>
            <h2>A few small checks keep the whole picture trustworthy.</h2>
          </div>
          <ol className="lp-rhythm">
            <li>
              <span>01</span>
              <div><strong>Plan the month</strong><p>Balance income sources against budget items, then fund the linked sub-accounts.</p></div>
            </li>
            <li>
              <span>02</span>
              <div><strong>Record what happens</strong><p>Classify direct spending, account for card charges, and create receivables when needed.</p></div>
            </li>
            <li>
              <span>03</span>
              <div><strong>Settle commitments</strong><p>Close received receivables and pay each card statement from its reserved cash.</p></div>
            </li>
            <li>
              <span>04</span>
              <div><strong>Reconcile and review</strong><p>Refresh bank balances, explain discrepancies, and update investment values.</p></div>
            </li>
          </ol>
        </section>

        <section className="lp-footer-cta">
          <div>
            <span className="lp-eyebrow">Make every amount explainable</span>
            <h2>One home for the money you have, owe, expect, and invest.</h2>
            <p>Start with one bank account and a few meaningful sub-accounts. Nest helps the rest of the picture come into focus.</p>
          </div>
          <Link href="/login" className="lp-btn-primary">
            Continue to sign in <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </section>

        <footer className="lp-footer">
          <div className="lp-brand">
            <Image src="/icon.svg" alt="" width={24} height={24} />
            <span><strong>Nest</strong><small>Full-visibility money management</small></span>
          </div>
          <div>
            <Link href="/privacy-policy" target="_blank" rel="noopener noreferrer">Privacy</Link>
            <Link href="/terms-of-service" target="_blank" rel="noopener noreferrer">Terms</Link>
            <Link href="/login">Sign in</Link>
          </div>
        </footer>
      </main>
    );
  }
  redirect("/entry");
}
