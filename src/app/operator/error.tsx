"use client";

export default function OperatorError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="card">
        <p className="badge bg-saffron text-saffron-ink">Something needs fixing</p>
        <h1 className="mt-3 font-display text-2xl text-ink">That didn&apos;t go through</h1>
        <p className="mt-2 text-muted">{error.message}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" onClick={() => reset()} className="btn-primary">
            Try again
          </button>
          <a href="/operator" className="btn-secondary">
            Back to overview
          </a>
        </div>
      </div>
    </div>
  );
}
