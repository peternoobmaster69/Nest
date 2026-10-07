import { LandingContact } from "@/components/landing-contact";
import { LandingScrollMotion } from "@/components/landing-scroll-motion";
import { LandingSignInDialog } from "@/components/landing-signin-dialog";
import { SiteStructuredData } from "@/components/site-structured-data";
import { getDatabaseReadyServerSession } from "@/lib/server-session";
import { getSignInErrorMessage } from "@/lib/signin-error";
import { normalizeInternalAppPath } from "@/lib/workspace-entry";
import { hasSignInQuery, NO_INDEX_ROBOTS, publicPageMetadata, PUBLIC_PAGES } from "@/lib/seo";
import type { Metadata } from "next";
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
  Mail,
  Layers3,
  PiggyBank,
  ReceiptText,
  RefreshCw,
  TrendingUp,
  WalletCards,
} from "lucide-react";

const LENSES = [
  {
    title: "Real cash",
    body: "Your bank balances are the control totals: the money that actually exists today.",
    question: "How much do I have?",
    icon: Landmark,
    tone: "green",
    figure: "$5,000.00",
    caption: "Across 2 bank accounts",
    bars: [100, 64],
  },
  {
    title: "Virtual purpose",
    body: "Sub-accounts divide bank cash into jobs such as bills, spending, savings, and goals.",
    question: "What is it for?",
    icon: Layers3,
    tone: "blue",
    figure: "4 jobs",
    caption: "Bills · Everyday · Card · Savings",
    bars: [48, 20, 16, 12],
  },
  {
    title: "Commitments",
    body: "Card payables show what you owe. Receivables show what others still owe you.",
    question: "What must happen next?",
    icon: WalletCards,
    tone: "amber",
    figure: "$600 due",
    caption: "Statement due in 9 days · $180 owed to you",
    bars: [72, 30],
  },
  {
    title: "Long-term value",
    body: "Dated investment snapshots show capital invested, current value, and liquidity.",
    question: "What is growing over time?",
    icon: TrendingUp,
    tone: "purple",
    figure: "+8.4%",
    caption: "Market value vs. capital invested",
    bars: [38, 52, 61, 84],
  },
] as const;

const RECONCILE_WORDS = "A discrepancy is a useful signal—not a mystery.".split(" ");
const CTA_WORDS = "One home for the money you have, owe, expect, and invest.".split(" ");

const RHYTHM = [
  { title: "Plan the month", body: "Balance income sources against budget items, then fund the linked sub-accounts." },
  { title: "Record what happens", body: "Classify direct spending, account for card charges, and create receivables when needed." },
  { title: "Settle commitments", body: "Close received receivables and pay each card statement from its reserved cash." },
  { title: "Reconcile and review", body: "Refresh bank balances, explain discrepancies, and update investment values." },
] as const;

type HomeProps = {
  searchParams?: Promise<{ login?: string; error?: string; callbackUrl?: string }>;
};

export async function generateMetadata({ searchParams }: HomeProps): Promise<Metadata> {
  const metadata = publicPageMetadata(PUBLIC_PAGES.home);
  if (hasSignInQuery(Object.keys((await searchParams) ?? {}))) {
    metadata.robots = NO_INDEX_ROBOTS;
  }
  return metadata;
}

export default async function Home({ searchParams }: Readonly<HomeProps>) {
  const params = (await searchParams) ?? {};
  const showSignIn = params.login === "1" || Boolean(params.error);
  const callbackUrl = normalizeInternalAppPath(params.callbackUrl);
  const signInErrorMessage = getSignInErrorMessage(params.error);
  const session = await getDatabaseReadyServerSession();
  if (!session?.user) {
    return (
      <main className="lp" data-landing>
        <SiteStructuredData />
        <LandingScrollMotion />
        <LandingContact />
        {showSignIn || session?.sessionLimitRequired ? (
          <LandingSignInDialog
            callbackUrl={callbackUrl}
            serviceMessage={signInErrorMessage}
            sessionLimitRequired={session?.sessionLimitRequired}
          />
        ) : null}
        <div className="lp-progress" aria-hidden="true"><span /></div>
        <header className="lp-nav">
          <Link href="/" className="lp-brand" aria-label="Nest home">
            <Image src="/icon.svg" alt="" width={30} height={30} priority />
            <span>
              <strong>Nest</strong>
              <small>Personal Finance Companion</small>
            </span>
          </Link>
          <nav className="lp-nav-links" aria-label="Landing page navigation">
            <a href="#how-it-works">How it works</a>
            <a href="#money-flows">Money flows</a>
            <a href="#monthly-rhythm">Monthly rhythm</a>
            <a href="#use-nest">Use Nest</a>
            <a href="#contact">Contact</a>
          </nav>
          <Link href="/login" className="lp-nav-signin">
            Sign in <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </header>

        <section className="lp-hero" data-scene="exit" aria-labelledby="hero-title">
          <div className="lp-hero-glow" aria-hidden="true" />
          <div className="lp-hero-copy">
            <span className="lp-hero-kicker">Personal budgeting &amp; expense tracking</span>
            <h1 id="hero-title" className="lp-hero-title">
              <span className="lp-intro-word" style={{ ["--w" as string]: 0 }}>Every</span>{" "}
              <span className="lp-intro-word" style={{ ["--w" as string]: 1 }}>dollar.</span>{" "}<br />
              <span className="lp-intro-word lp-gradient-text is-start" style={{ ["--w" as string]: 2 }}>Fully</span>{" "}
              <span className="lp-intro-word lp-gradient-text is-end" style={{ ["--w" as string]: 3 }}>explained.</span>
            </h1>
            <p>
              Nest is a personal finance app for planning budgets, tracking expenses, and managing savings and investments.
              Organize your bank balances, credit card payments, and money owed to you in one clear view, on your own or
              in a shared workspace.
            </p>
            <div className="lp-hero-actions">
              <Link href="/login" className="lp-btn-primary">
                Get started <ArrowRight size={16} aria-hidden="true" />
              </Link>
              <a href="#how-it-works" className="lp-btn-secondary">See how it works</a>
            </div>
          </div>

          <div className="lp-hero-stage">
            <div className="lp-hero-chip is-left" aria-hidden="true">
              <span className="lp-signal is-positive">+$3500</span>
              <span><strong>Salary arrived</strong><small>Waiting to be allocated</small></span>
            </div>
            <div className="lp-hero-chip is-right" aria-hidden="true">
              <span className="lp-icon-tile is-amber"><CreditCard size={16} /></span>
              <span><strong>Card reserved</strong><small>$600 set aside</small></span>
            </div>
            <div className="lp-hero-shot" aria-label="Example Nest money map" data-reveal>
              <div className="lp-mock-top">
                <span><span className="lp-live-dot" /> Your money map</span>
                <small>Example</small>
              </div>

              <div className="lp-mock-balance">
                <div>
                  <small>Available bank balance</small>
                  <strong data-count>$5,000.00</strong>
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
          </div>
        </section>

        <section className="lp-views" id="how-it-works" data-scene="pin" data-steps={LENSES.length} data-active="0" style={{ ["--n" as string]: LENSES.length }} aria-labelledby="views-title">
          <div className="lp-views-stage">
            <div className="lp-views-copy">
              <span className="lp-eyebrow">The Nest model</span>
              <h2 id="views-title">Four views. Four honest answers.</h2>
              <p className="lp-views-lede">
                Keeping cash, purpose, commitments, and investments distinct gives you a more honest picture of your money.
              </p>
              <ol className="lp-views-steps">
                {LENSES.map((lens, index) => (
                  <li key={lens.title} data-i={index} style={{ ["--i" as string]: index }}>
                    <span className="lp-views-number">{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <strong>{lens.title}</strong>
                      <p>{lens.body}</p>
                      <small>Answers: “{lens.question}”</small>
                    </div>
                  </li>
                ))}
              </ol>
              <div className="lp-views-rail" aria-hidden="true"><span /></div>
            </div>

            <div className="lp-views-visual" aria-hidden="true">
              {LENSES.map((lens, index) => {
                const Icon = lens.icon;
                return (
                  <div key={lens.title} className={`lp-lens-panel is-${lens.tone}`} data-i={index} style={{ ["--i" as string]: index }}>
                    <span className={`lp-icon-tile is-${lens.tone}`}><Icon size={22} /></span>
                    <small>{lens.title}</small>
                    <strong>{lens.figure}</strong>
                    <span className="lp-lens-caption">{lens.caption}</span>
                    <div className="lp-lens-bars">
                      {lens.bars.map((bar, barIndex) => (
                        <span key={barIndex} style={{ ["--w" as string]: `${bar}%` }} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="lp-reconcile" data-scene="track" aria-labelledby="reconcile-title">
          <div className="lp-reconcile-inner">
            <span className="lp-eyebrow">One balance, many jobs</span>
            <h2 id="reconcile-title" className="lp-words" style={{ ["--n" as string]: RECONCILE_WORDS.length }}>
              {RECONCILE_WORDS.map((word, index) => (
                <span key={index} style={{ ["--i" as string]: index }}>{word} </span>
              ))}
            </h2>
            <p>
              Nest compares each real bank balance with the total of its virtual sub-accounts. Positive means money is still free
              to assign. Negative means you have allocated more than the bank currently holds.
            </p>
            <div className="lp-reconcile-formula" data-reveal>
              <span>Bank balance</span><strong>−</strong><span>Sub-account total</span><strong>=</strong><span>Unallocated</span>
            </div>
            <div className="lp-reconcile-signals">
              <div data-reveal>
                <span className="lp-signal is-positive">+$350</span>
                <p><strong>Unallocated</strong><small>New income or cash waiting for a purpose.</small></p>
              </div>
              <div data-reveal>
                <span className="lp-signal is-zero"><Check size={17} aria-hidden="true" /></span>
                <p><strong>Fully assigned</strong><small>The bank and its virtual accounts agree.</small></p>
              </div>
              <div data-reveal>
                <span className="lp-signal is-negative">−$90</span>
                <p><strong>Over-allocated</strong><small>A budget needs funding or the bank balance is stale.</small></p>
              </div>
            </div>
          </div>
        </section>

        <section className="lp-flows" id="money-flows" data-scene="pin" aria-labelledby="flows-title">
          <div className="lp-flows-stage">
            <div className="lp-section-head" data-reveal>
              <span className="lp-eyebrow">See the movement</span>
              <h2 id="flows-title">Follow the full journey of your money.</h2>
              <p>A transaction is easier to act on when you can see whether it changed cash, purpose, or a future commitment.</p>
            </div>

            <div className="lp-flow-track">
              <article className="lp-flow-card is-budget" data-reveal>
                <header>
                  <span className="lp-icon-tile is-green"><CircleDollarSign size={21} aria-hidden="true" /></span>
                  <div><small>Monthly budget</small><h3>Give incoming money a plan</h3></div>
                </header>
                <div className="lp-flow-steps">
                  <div><span>1</span><p><strong>List sources</strong><small>Salary, freelance income, household contributions</small></p></div>
                  <div><span>2</span><p><strong>Assign every amount</strong><small>Bills, spending, savings, investing</small></p></div>
                  <div className="is-emphasis"><span>3</span><p><strong>Confirm the month</strong><small>Fund the linked virtual sub-accounts</small></p></div>
                </div>
                <p className="lp-flow-note"><BarChart3 size={15} aria-hidden="true" /> Sources must equal items. Bank cash changes only when income actually arrives.</p>
              </article>

              <article className="lp-flow-card is-credit-payable" data-reveal>
                <header>
                  <span className="lp-icon-tile is-amber"><CreditCard size={21} aria-hidden="true" /></span>
                  <div><small>Credit-card payable</small><h3>Reserve now, pay later</h3></div>
                </header>
                <div className="lp-flow-steps">
                  <div><span>1</span><p><strong>Card purchase</strong><small>The payable rises; bank cash has not moved</small></p></div>
                  <div><span>2</span><p><strong>Reserve the cash</strong><small>Move value from Spending to Card Settlement</small></p></div>
                  <div className="is-emphasis"><span>3</span><p><strong>Pay the statement</strong><small>Now the payable and bank cash both fall</small></p></div>
                </div>
                <p className="lp-flow-note"><RefreshCw size={15} aria-hidden="true" /> Resolve every charge, then refresh the bank balance after payment posts.</p>
              </article>

              <article className="lp-flow-card is-receivable" data-reveal>
                <header>
                  <span className="lp-icon-tile is-blue"><ReceiptText size={21} aria-hidden="true" /></span>
                  <div><small>Receivable</small><h3>Keep expected money visible</h3></div>
                </header>
                <div className="lp-flow-steps">
                  <div><span>1</span><p><strong>You cover a cost</strong><small>Create the matching receivable</small></p></div>
                  <div><span>2</span><p><strong>Track it as open</strong><small>See what is owed without counting it as bank cash</small></p></div>
                  <div className="is-emphasis"><span>3</span><p><strong>Close when paid</strong><small>Credit the default settlement sub-account</small></p></div>
                </div>
                <p className="lp-flow-note"><CheckCircle2 size={15} aria-hidden="true" /> Close the receivable and refresh the bank balance when payment arrives.</p>
              </article>
            </div>
            <div className="lp-flows-progress" aria-hidden="true"><span /></div>
          </div>
        </section>

        <section className="lp-assets" data-scene="track" aria-labelledby="assets-title">
          <div className="lp-section-head" data-reveal>
            <span className="lp-eyebrow">Build beyond this month</span>
            <h2 id="assets-title">Savings and investments, without double-counting.</h2>
            <p>Savings is still bank cash with a protected purpose. Investments are separate assets measured by their latest value.</p>
          </div>
          <div className="lp-assets-grid">
            <article data-reveal>
              <span className="lp-icon-tile is-green"><PiggyBank size={21} aria-hidden="true" /></span>
              <strong className="lp-asset-value"><span data-count>$12,400</span> <small>saved</small></strong>
              <div>
                <h3>Savings stays connected to cash</h3>
                <p>Use a Savings sub-account to show which bank money is protected for emergencies or goals.</p>
              </div>
            </article>
            <article data-reveal>
              <span className="lp-icon-tile is-purple"><TrendingUp size={21} aria-hidden="true" /></span>
              <strong className="lp-asset-value is-positive"><span data-count>+8.4%</span> <small>return</small></strong>
              <div>
                <h3>Investments show current value</h3>
                <p>Track invested capital, market value, gain or loss, and what can be withdrawn.</p>
              </div>
            </article>
          </div>
        </section>

        <section className="lp-section lp-rhythm-section" id="monthly-rhythm" data-scene="track" aria-labelledby="rhythm-title">
          <div className="lp-section-head" data-reveal>
            <span className="lp-eyebrow">A calm operating rhythm</span>
            <h2 id="rhythm-title">A few small checks keep the whole picture trustworthy.</h2>
          </div>
          <ol className="lp-rhythm">
            {RHYTHM.map((step, index) => (
              <li key={step.title} data-reveal>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div><strong>{step.title}</strong><p>{step.body}</p></div>
              </li>
            ))}
          </ol>
        </section>

        <section className="lp-section lp-use" id="use-nest" aria-labelledby="use-nest-title">
          <div className="lp-section-head" data-reveal>
            <span className="lp-eyebrow">Use Nest your way</span>
            <h2 id="use-nest-title">Choose where Nest runs.</h2>
            <p>Run it on infrastructure you control, or get started on the best-effort hosted version.</p>
          </div>
          <div className="lp-use-grid">
            <article className="lp-use-card" data-reveal>
              <span className="lp-icon-tile is-green"><GitFork size={21} aria-hidden="true" /></span>
              <div className="lp-use-card-copy">
                <span className="lp-use-label">Your infrastructure</span>
                <h3>Host it yourself</h3>
                <p>Deploy Nest yourself and keep control of the infrastructure, database, and operating costs.</p>
              </div>
              <div className="lp-use-card-footer">
                <small>The source and setup instructions are available on GitHub.</small>
                <a
                  href="https://github.com/peternoobmaster69/Nest"
                  className="lp-btn-secondary"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View repository <ExternalLink size={15} aria-hidden="true" />
                </a>
              </div>
            </article>

            <article className="lp-use-card is-hosted" data-reveal>
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
          <div className="lp-contact-strip" data-reveal>
            <span className="lp-icon-tile is-amber"><Mail size={20} aria-hidden="true" /></span>
            <div>
              <strong>Questions before you start?</strong>
              <p>Ask about hosting, share feedback, or report something that isn&apos;t working.</p>
            </div>
            <a href="#contact" className="lp-btn-secondary">
              Contact me <ArrowRight size={15} aria-hidden="true" />
            </a>
          </div>
        </section>

        <section className="lp-footer-cta" data-scene="track" aria-labelledby="cta-title">
          <div className="lp-footer-cta-inner">
            <span className="lp-eyebrow">Make every amount explainable</span>
            <h2 id="cta-title" className="lp-words" style={{ ["--n" as string]: CTA_WORDS.length }}>
              {CTA_WORDS.map((word, index) => (
                <span key={index} style={{ ["--i" as string]: index }}>{word} </span>
              ))}
            </h2>
            <p>Start with one bank account and a few meaningful sub-accounts. Nest helps the rest of the picture come into focus.</p>
            <Link href="/login" className="lp-btn-primary">
              Continue to sign in <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
        </section>

        <footer className="lp-footer">
          <div className="lp-brand">
            <Image src="/icon.svg" alt="" width={24} height={24} />
            <span><strong>Nest</strong><small>Full-visibility money management</small></span>
          </div>
          <div>
            <Link href="/privacy-policy" target="_blank" rel="noopener noreferrer">Privacy</Link>
            <Link href="/terms-of-service" target="_blank" rel="noopener noreferrer">Terms</Link>
            <a href="#contact">Contact</a>
            <Link href="/login">Sign in</Link>
          </div>
        </footer>
      </main>
    );
  }
  redirect("/entry");
}
