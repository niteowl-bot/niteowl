// In-memory rate limiter. Deliberately simple (no Redis/Upstash) — it
// only needs to cap worst-case abuse cost on public routes, not enforce
// an exact global quota. State is per warm serverless instance, which
// is enough to stop a single scripted client from running up OpenAI
// costs or flooding a business's inbox with fake needs-review leads.

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 5000;

export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });

    if (buckets.size > MAX_BUCKETS) {
      for (const [k, v] of buckets) {
        if (v.resetAt <= now) buckets.delete(k);
      }
    }

    return true;
  }

  if (existing.count >= limit) return false;

  existing.count += 1;
  return true;
}
