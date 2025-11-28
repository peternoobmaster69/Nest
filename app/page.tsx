import {
  Activity,
  ArrowRight,
  CheckCircle,
  Fingerprint,
  Layers,
  PiggyBank,
  ShieldCheck,
  Sparkles,
  Users,
  Wallet,
} from "lucide-react";

import { getCurrentUser } from "@/lib/session";

const quickActions = [
  {
    title: "Open a shared pot",
    description: "Spin up a secure pool with caps, guardrails, and invites in seconds.",
    icon: PiggyBank,
  },
  {
    title: "Invite collaborators",
    description: "Send access links with policies baked in so everyone starts aligned.",
    icon: Users,
  },
  {
    title: "Set approvals",
    description: "Dual sign-offs and spending thresholds keep every move intentional.",
    icon: ShieldCheck,
  },
];

const trustSignals = [
  {
    label: "Identity locks",
    detail: "Passkeys and device checks guard every session.",
    icon: Fingerprint,
  },
  {
    label: "Real-time alerts",
    detail: "Instant pings for withdrawals, caps, and approvals.",
    icon: Activity,
  },
  {
    label: "Layered visibility",
    detail: "Policy-aware views keep stakeholders focused.",
    icon: Layers,
  },
];

export default async function Home() {
  const user = await getCurrentUser();
  const displayName = user?.Name?.trim() || user?.Email || "Welcome to SaveTogether";

  return (
    <div className="page-grid">
      <section className="section-card hero-panel">
        <div className="pill">
          <Sparkles size={16} />
          Built for modern finance teams
        </div>
        <div className="hero-banner">
          {user ? (
            <div className="hero-identity" aria-label="Signed in user">
              <CheckCircle size={18} />
              Signed in as {displayName}
            </div>
          ) : (
            <a className="btn btn-primary" href="/login">
              Log in to your workspace
              <ArrowRight size={16} />
            </a>
          )}
          <h1 className="hero-title hero-title--center">{displayName}</h1>
          <p className="hero-subtext">
            Crisp, distraction-free oversight for shared saving. Everything you need stays readable in light or dark mode.
          </p>
          <div className="hero-actions">
            <a className="btn btn-secondary" href={user ? "/dashboard" : "/register"}>
              {user ? "View your pools" : "Create an account"}
              <ArrowRight size={16} />
            </a>
            <div className="hero-glow" aria-hidden="true" />
          </div>
        </div>
      </section>

      <section className="section-card minimal-panel">
        <div className="panel-heading">
          <div>
            <p className="pill" style={{ margin: 0 }}>
              <Wallet size={16} />
              Clear control surface
            </p>
            <h2 className="card-title" style={{ marginTop: "0.75rem" }}>
              Quick actions tuned for focus
            </h2>
          </div>
        </div>
        <div className="grid-3">
          {quickActions.map(({ title, description, icon: Icon }) => (
            <div key={title} className="stat-card">
              <div className="icon-pill">
                <Icon size={18} />
              </div>
              <p className="card-title" style={{ marginTop: "0.35rem" }}>
                {title}
              </p>
              <p className="text-muted" style={{ margin: "0.35rem 0 0" }}>
                {description}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="section-card trust-panel">
        <div className="panel-heading">
          <div>
            <p className="pill" style={{ margin: 0 }}>
              <ShieldCheck size={16} />
              Trust-first by default
            </p>
            <h2 className="card-title" style={{ marginTop: "0.75rem" }}>
              Safeguards that stay out of your way
            </h2>
            <p className="text-muted" style={{ marginTop: "0.35rem" }}>
              Every control favors clarity: concise copy, strong contrast, and motion kept to a minimum.
            </p>
          </div>
        </div>
        <div className="grid-3">
          {trustSignals.map(({ label, detail, icon: Icon }) => (
            <div key={label} className="section-card glass-card">
              <div className="icon-pill">
                <Icon size={18} />
              </div>
              <p className="card-title" style={{ marginTop: "0.4rem" }}>
                {label}
              </p>
              <p className="text-muted" style={{ marginTop: "0.3rem" }}>
                {detail}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
