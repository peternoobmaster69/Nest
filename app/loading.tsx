export default function Loading() {
  return (
    <main className="initial-route-loading" aria-busy="true" aria-label="Loading Nest">
      <div className="initial-route-loading-mark" aria-hidden="true">N</div>
      <span>Loading Nest…</span>
    </main>
  );
}
