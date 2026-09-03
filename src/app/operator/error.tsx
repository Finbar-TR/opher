"use client";

import { useEffect } from "react";

// The backstop, not the feedback channel.
//
// Next only serializes a real `Error.message` to this boundary in development;
// in production it substitutes a generic message and an `error.digest`. So the
// paragraph below explains nothing to an operator on a real deployment, and the
// copy no longer pretends otherwise. Expected operator mistakes — a mistyped
// weight, a city that already has this food — are returned as form state by the
// catalogue and basket actions instead, and never reach here.
//
// What is left is the genuinely unexpected: a refund Stripe refused, a status
// change on a basket that has gone. Each of those logs the real error server-
// side before throwing, so the digest shown here identifies a line in the log.
export default function OperatorError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("[operator] error boundary", error.digest, error);
  }, [error]);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="card">
        <p className="badge bg-saffron text-saffron-ink">Something needs fixing</p>
        <h1 className="mt-3 font-display text-2xl text-ink">That didn&apos;t go through</h1>
        <p className="mt-2 text-muted">
          Nothing was saved. The details are in the server log rather than on
          this page — quote the reference below and they can be found.
        </p>
        {error.digest && (
          <p className="mt-3 text-sm text-muted">
            Reference: <code className="font-medium text-ink">{error.digest}</code>
          </p>
        )}
        <div className="mt-6 flex flex-wrap gap-3">
          {/* `unstable_retry` rather than `reset`: reset only clears the
              boundary's error state and re-renders cached children, so after a
              failed action it puts a stale list back on screen. This re-fetches
              first. */}
          <button type="button" onClick={() => unstable_retry()} className="btn-primary">
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
