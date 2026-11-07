import { describe, it, expect } from "vitest";
import { createRateLimiter } from "../middleware/rateLimit";

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

describe("createRateLimiter", () => {
  it("allows up to max requests in a window", () => {
    const c = clock();
    const limiter = createRateLimiter({ windowMs: 60_000, max: 3, now: c.now });
    expect([1, 2, 3].map(() => limiter.hit("a").allowed)).toEqual([true, true, true]);
  });

  it("blocks the next request and says when to retry", () => {
    const c = clock();
    const limiter = createRateLimiter({ windowMs: 60_000, max: 2, now: c.now });
    limiter.hit("a");
    limiter.hit("a");
    c.advance(15_000);
    const result = limiter.hit("a");
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSec).toBe(45);
  });

  it("counts each key separately", () => {
    const c = clock();
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1, now: c.now });
    expect(limiter.hit("a").allowed).toBe(true);
    expect(limiter.hit("b").allowed).toBe(true);
    expect(limiter.hit("a").allowed).toBe(false);
  });

  it("opens again once the window has passed", () => {
    const c = clock();
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1, now: c.now });
    limiter.hit("a");
    c.advance(60_000);
    expect(limiter.hit("a").allowed).toBe(true);
  });
});
