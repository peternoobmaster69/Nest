import Link from "next/link";

export default function OfflinePage() {
  return (
    <main className="offline-page">
      <h1>You&apos;re offline</h1>
      <p>Reconnect to continue. An already-open Nest screen remains available with the information it has loaded.</p>
      <Link className="btn btn-primary" href="/">Try again</Link>
    </main>
  );
}
