import { describe, expect, it } from "vitest";

import { TokenBucket } from "../src/rateLimit.js";

describe("TokenBucket", () => {
  it("acquire under the limit is effectively instant", async () => {
    const bucket = new TokenBucket(10, 1.0);
    const t0 = performance.now();
    for (let i = 0; i < 5; i++) await bucket.acquire();
    expect(performance.now() - t0).toBeLessThan(50);
  });

  it("blocks when the limit is reached and resumes after the window", async () => {
    const bucket = new TokenBucket(3, 0.3);
    for (let i = 0; i < 3; i++) await bucket.acquire();
    const t0 = performance.now();
    await bucket.acquire();
    const elapsed = performance.now() - t0;
    // Should have waited roughly the full window for the oldest call to age out.
    expect(elapsed).toBeGreaterThan(200);
    expect(elapsed).toBeLessThan(500);
  });

  it("serialises concurrent callers correctly", async () => {
    const bucket = new TokenBucket(5, 0.2);
    const t0 = performance.now();
    await Promise.all(Array.from({ length: 10 }, () => bucket.acquire()));
    const elapsed = performance.now() - t0;
    // First 5 instant, next 5 wait ~200ms for the window to roll.
    expect(elapsed).toBeGreaterThan(150);
    expect(elapsed).toBeLessThan(500);
  });

  it("rejects invalid params", () => {
    expect(() => new TokenBucket(0, 1)).toThrow();
    expect(() => new TokenBucket(10, 0)).toThrow();
    expect(() => new TokenBucket(10, -1)).toThrow();
    expect(() => new TokenBucket(NaN, 1)).toThrow();
    expect(() => new TokenBucket(10, NaN)).toThrow();
    expect(() => new TokenBucket(Infinity, 1)).toThrow();
  });
});
