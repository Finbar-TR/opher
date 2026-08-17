import "server-only";

// Simple in-memory sliding-window rate limiter for auth endpoints. Good enough
// for a single-instance MVP. For multi-instance / serverless deployments, back
// this with Redis (e.g. Upstash) instead, since memory isn't shared across nodes.

const hits = new Map<string, number[]>();

export function rateLimit(
  key: string,
  max: number,
  windowMs: number
): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const windowStart = now - windowMs;
  const recent = (hits.get(key) ?? []).filter((t) => t > windowStart);

  if (recent.length >= max) {
    const retryAfterSec = Math.ceil((recent[0] + windowMs - now) / 1000);
    return { ok: false, retryAfterSec };
  }

  recent.push(now);
  hits.set(key, recent);

  // Opportunistic cleanup so the map doesn't grow unbounded.
  if (hits.size > 5000) {
    for (const [k, v] of hits) {
      if (v.every((t) => t <= windowStart)) hits.delete(k);
    }
  }

  return { ok: true, retryAfterSec: 0 };
}
