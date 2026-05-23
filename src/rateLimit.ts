/**
 * Async token bucket for proactive client-side rate limiting.
 *
 * The WireBoard API caps tokens at 120 requests/minute. We set our internal
 * limit slightly under (default 100/min) so LLM bursts space themselves out
 * instead of tripping 429s and paying the back-off cost. The SDK still
 * auto-retries 429 as a backstop, but proactive limiting is faster from the
 * LLM's perspective.
 */

export class TokenBucket {
  readonly maxCalls: number;
  readonly windowMs: number;
  private readonly calls: number[] = [];
  private chain: Promise<void> = Promise.resolve();

  constructor(maxCalls: number, windowSeconds: number) {
    if (!Number.isFinite(maxCalls) || maxCalls < 1) {
      throw new Error("maxCalls must be a finite number >= 1");
    }
    if (!Number.isFinite(windowSeconds) || windowSeconds <= 0) {
      throw new Error("windowSeconds must be a finite number > 0");
    }
    this.maxCalls = maxCalls;
    this.windowMs = windowSeconds * 1000;
  }

  /**
   * Block until a call slot is available, then record the call.
   * Concurrent callers are serialized through a single promise chain
   * so the eviction-then-append sequence is race-free.
   */
  acquire(): Promise<void> {
    const next = this.chain.then(() => this.doAcquire());
    // Swallow rejections so one failure doesn't poison the chain.
    this.chain = next.catch(() => {});
    return next;
  }

  private async doAcquire(): Promise<void> {
    let now = monotonicMs();
    this.evict(now);
    if (this.calls.length >= this.maxCalls) {
      const wait = this.calls[0]! + this.windowMs - now;
      if (wait > 0) await sleep(wait);
      now = monotonicMs();
      this.evict(now);
    }
    this.calls.push(now);
  }

  private evict(now: number): void {
    const cutoff = now - this.windowMs;
    while (this.calls.length > 0 && this.calls[0]! < cutoff) {
      this.calls.shift();
    }
  }
}

function monotonicMs(): number {
  return performance.now();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
