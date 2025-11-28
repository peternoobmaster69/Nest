import {
  ArrowUpRight,
  BadgePercent,
  BarChart3,
  BellRing,
  Layers,
  PiggyBank,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Users,
  Wallet,
} from "lucide-react";

const features = [
  {
    title: "Shared pots & safeguards",
    description: "Segment funds, automate allocations, and keep contributors aligned with real-time statuses.",
    icon: PiggyBank,
  },
  {
    title: "Institution-grade security",
    description: "Multi-factor protection, encrypted ledgers, and access policies that keep every pool trusted.",
    icon: ShieldCheck,
  },
  {
    title: "Crystal clear analytics",
    description: "Growth projections, variance alerts, and goal tracking with charts tuned for quick reads.",
    icon: BarChart3,
  },
];

const automations = [
  {
    label: "Auto top-ups",
    value: 72,
    detail: "Scheduled contributions across teams",
  },
  {
    label: "Risk flags cleared",
    value: 58,
    detail: "Policy checks resolved this quarter",
  },
  {
    label: "Instant transfers",
    value: 91,
    detail: "Payouts completed under 2 mins",
  },
];

const steps = [
  {
    title: "Invite your circle",
    description: "Share links or QR codes and set contribution tiers instantly.",
    icon: Users,
  },
  {
    title: "Set the guardrails",
    description: "Approval flows, spending caps, and alerts ensure every move is intentional.",
    icon: BellRing,
  },
  {
    title: "Watch balances grow",
    description: "Clear charts, milestone markers, and smart insights keep momentum high.",
    icon: Wallet,
  },
];

export default function Home() {
  return (
    <div className="flex flex-col gap-6">
      <section className="section-card">
        <div className="flex flex-col gap-6">
          <div className="pill">
            <Sparkles size={16} />
            Modern fintech experience
          </div>
          <div className="grid-2" style={{ gap: "1.5rem", alignItems: "flex-start" }}>
            <div className="flex flex-col gap-4">
              <h1 className="hero-title">
                A <span className="hero-accent">modern</span> home for collaborative saving
              </h1>
              <p className="text-muted" style={{ maxWidth: "38rem" }}>
                SaveTogether now feels like the fintech tools you love: crisp layouts, deliberate spacing, and a
                dark-friendly palette that keeps every number readable.
              </p>
              <div className="btn-row">
                <a className="btn btn-primary" href="#">
                  Start a pool
                  <ArrowUpRight size={18} />
                </a>
                <a className="btn btn-secondary" href="#">
                  See live demo
                  <ArrowUpRight size={18} />
                </a>
              </div>
              <div className="grid-3" style={{ marginTop: "0.5rem" }}>
                <div className="stat-card">
                  <div className="icon-pill">
                    <BadgePercent size={18} />
                  </div>
                  <div className="stat-value">98%</div>
                  <p className="text-muted" style={{ margin: 0 }}>Visibility across every pool</p>
                </div>
                <div className="stat-card">
                  <div className="icon-pill">
                    <ShieldCheck size={18} />
                  </div>
                  <div className="stat-value">24/7</div>
                  <p className="text-muted" style={{ margin: 0 }}>Automated guardrails</p>
                </div>
                <div className="stat-card">
                  <div className="icon-pill">
                    <Smartphone size={18} />
                  </div>
                  <div className="stat-value">Instant</div>
                  <p className="text-muted" style={{ margin: 0 }}>Mobile-friendly approvals</p>
                </div>
              </div>
            </div>

            <div className="section-card" style={{ padding: "1.5rem" }}>
              <div className="flex items-start justify-between" style={{ gap: "0.5rem" }}>
                <div className="flex items-center gap-2">
                  <div className="icon-pill">
                    <Wallet size={18} />
                  </div>
                  <div>
                    <p className="card-title">Shared vault</p>
                    <p className="text-muted" style={{ margin: 0 }}>Live snapshot for your circles</p>
                  </div>
                </div>
                <div className="pill">
                  <Layers size={16} />
                  Multi-pool
                </div>
              </div>
              <div className="divider" />
              <div className="grid-2" style={{ gap: "1rem" }}>
                <div className="callout">
                  <p className="card-title">Growth forecast</p>
                  <p className="text-muted" style={{ marginTop: "0.35rem", marginBottom: "0.75rem" }}>
                    Projected to hit 125% of target in 4 months with current contribution velocity.
                  </p>
                  <div className="progress-bar" aria-label="Growth forecast">
                    <span style={{ width: "68%" }} />
                  </div>
                </div>
                <div className="callout">
                  <p className="card-title">Safety checks</p>
                  <p className="text-muted" style={{ marginTop: "0.35rem", marginBottom: "0.75rem" }}>
                    14 smart rules are active: spend caps, dual approvals, and identity locks.
                  </p>
                  <div className="small-grid">
                    <div className="pill" style={{ justifyContent: "space-between" }}>
                      <span>Spending caps</span>
                      <span aria-hidden="true">●</span>
                    </div>
                    <div className="pill" style={{ justifyContent: "space-between" }}>
                      <span>Dual approvals</span>
                      <span aria-hidden="true">●</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section-card">
        <div className="flex items-center justify-between" style={{ gap: "0.75rem", marginBottom: "1rem" }}>
          <div>
            <p className="pill" style={{ margin: 0 }}>
              <Sparkles size={16} />
              Fintech clarity
            </p>
            <h2 className="card-title" style={{ fontSize: "1.35rem", marginTop: "0.65rem" }}>
              Controls that keep everyone aligned
            </h2>
            <p className="text-muted" style={{ marginTop: "0.35rem" }}>
              Spacing, typography, and iconography have been tuned for readability in light or dark mode.
            </p>
          </div>
          <div className="pill" style={{ background: "color-mix(in srgb, var(--color-accent) 18%, transparent)" }}>
            <ArrowUpRight size={16} />
            Action-ready
          </div>
        </div>
        <div className="grid-3">
          {features.map(({ title, description, icon: Icon }) => (
            <div className="section-card" key={title} style={{ padding: "1.25rem", boxShadow: "none" }}>
              <div className="icon-pill" style={{ marginBottom: "0.65rem" }}>
                <Icon size={18} />
              </div>
              <p className="card-title">{title}</p>
              <p className="text-muted" style={{ marginTop: "0.35rem" }}>{description}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section-card">
        <div className="grid-2" style={{ gap: "1.5rem", alignItems: "center" }}>
          <div className="flex flex-col gap-4">
            <div className="pill" style={{ width: "fit-content" }}>
              <BarChart3 size={16} />
              Automation and growth
            </div>
            <h2 className="card-title" style={{ fontSize: "1.4rem" }}>
              Consistent rituals that keep momentum high
            </h2>
            <p className="text-muted">
              Reduce manual work with scheduled actions, transparent insights, and alerts that land before problems do.
            </p>
            <div className="small-grid">
              {automations.map((automation) => (
                <div key={automation.label} className="stat-card">
                  <div className="flex items-center justify-between" style={{ gap: "0.5rem" }}>
                    <p className="card-title" style={{ margin: 0 }}>{automation.label}</p>
                    <div className="pill" style={{ margin: 0 }}>{automation.value}%</div>
                  </div>
                  <p className="text-muted" style={{ margin: "0.35rem 0" }}>{automation.detail}</p>
                  <div className="progress-bar" aria-label={automation.label}>
                    <span style={{ width: `${automation.value}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="section-card" style={{ padding: "1.5rem", boxShadow: "none" }}>
            <div className="flex items-center gap-2">
              <div className="icon-pill">
                <Users size={18} />
              </div>
              <div>
                <p className="card-title">Launch in three moves</p>
                <p className="text-muted" style={{ margin: 0 }}>Built for remote teams and communities alike</p>
              </div>
            </div>
            <div className="divider" />
            <div className="grid-2" style={{ gap: "1rem" }}>
              {steps.map(({ title, description, icon: Icon }) => (
                <div key={title} className="stat-card" style={{ gap: "0.5rem" }}>
                  <div className="flex items-center gap-2">
                    <div className="icon-pill">
                      <Icon size={18} />
                    </div>
                    <p className="card-title" style={{ margin: 0 }}>{title}</p>
                  </div>
                  <p className="text-muted" style={{ margin: 0 }}>{description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
