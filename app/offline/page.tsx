import Link from "next/link";
import Image from "next/image";

export default function OfflinePage() {
  return (
    <main className="offline-page">
      <h1>You&apos;re offline</h1>
      <p>Recent read-only information may still be available. Financial changes are never queued while offline.</p>
      <Link className="btn btn-primary" href="/">Try again</Link>
    </main>
  );
}
