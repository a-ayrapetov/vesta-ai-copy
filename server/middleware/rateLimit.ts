/**
 * Fixed-window, in-memory request limiter. One process only: when the app runs
 * on several instances, move the counters to Postgres or Redis.
 */
export interface RateLimitResult {
  allowed: boolean;
  retryAfterSec: number;
}

export function createRateLimiter(opts: {
  windowMs: number;
  max: number;
  now?: () => number;
}) {
  const now = opts.now ?? Date.now;
  const windows = new Map<string, { start: number; count: number }>();

  return {
    hit(key: string): RateLimitResult {
      const t = now();
      let w = windows.get(key);
      if (!w || t - w.start >= opts.windowMs) {
        w = { start: t, count: 0 };
        windows.set(key, w);
        // Keep the map from growing without bound on a long-running server.
        if (windows.size > 10_000) {
          windows.forEach((v, k) => {
            if (t - v.start >= opts.windowMs) windows.delete(k);
          });
        }
      }
      w.count += 1;
      if (w.count <= opts.max) return { allowed: true, retryAfterSec: 0 };
      return {
        allowed: false,
        retryAfterSec: Math.max(1, Math.ceil((w.start + opts.windowMs - t) / 1000)),
      };
    },
  };
}
