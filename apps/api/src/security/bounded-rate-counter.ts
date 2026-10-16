interface Counter {
  key: string;
  previous: Counter | undefined;
  next: Counter | undefined;
  count: number;
  resetAt: number;
}

interface RateCounterOptions {
  windowMs: number;
  maxKeys?: number;
  sweepIntervalMs?: number;
  sweepBatchSize?: number;
  requestSweepSize?: number;
}

/** Process-local fixed windows. Saturation fails closed; live counters are never evicted. */
export class BoundedRateCounter {
  private readonly counters = new Map<string, Counter>();
  private readonly options: Required<RateCounterOptions>;
  private oldest: Counter | undefined;
  private newest: Counter | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private lastObservedTime = 0;

  constructor(options: RateCounterOptions) {
    this.options = {
      maxKeys: 50_000,
      sweepIntervalMs: 1_000,
      sweepBatchSize: 1_000,
      requestSweepSize: 64,
      ...options,
    };
    for (const value of Object.values(this.options)) {
      if (!Number.isSafeInteger(value) || value < 1) {
        throw new Error("Rate counter bounds must be positive safe integers.");
      }
    }
  }

  get size(): number {
    return this.counters.size;
  }

  consume(key: string, limit: number): boolean {
    if (!Number.isSafeInteger(limit) || limit < 1) return false;
    const now = this.now();
    this.sweep(now, this.options.requestSweepSize);
    const current = this.counters.get(key);
    if (current && current.resetAt > now) {
      if (current.count >= limit) return false;
      current.count += 1;
      return true;
    }
    // Reinsertion preserves expiry ordering when this key was beyond the bounded sweep.
    if (current) this.remove(current);
    if (this.counters.size >= this.options.maxKeys) return false;
    const entry: Counter = {
      key,
      count: 1,
      resetAt: now + this.options.windowMs,
      previous: undefined,
      next: undefined,
    };
    entry.previous = this.newest;
    if (this.newest) this.newest.next = entry;
    else this.oldest = entry;
    this.newest = entry;
    this.counters.set(key, entry);
    this.startSweep();
    return true;
  }

  destroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.counters.clear();
    this.oldest = undefined;
    this.newest = undefined;
  }

  private now(): number {
    // A backward wall-clock adjustment must not reorder expiry or reset a live quota.
    this.lastObservedTime = Math.max(this.lastObservedTime, Date.now());
    return this.lastObservedTime;
  }

  private sweep(now: number, budget: number): void {
    for (let removed = 0; removed < budget; removed += 1) {
      if (!this.oldest || this.oldest.resetAt > now) break;
      this.remove(this.oldest);
    }
    if (!this.counters.size && this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private remove(entry: Counter): void {
    this.counters.delete(entry.key);
    if (entry.previous) entry.previous.next = entry.next;
    else this.oldest = entry.next;
    if (entry.next) entry.next.previous = entry.previous;
    else this.newest = entry.previous;
  }

  private startSweep(): void {
    if (this.timer) return;
    this.timer = setInterval(
      () => this.sweep(this.now(), this.options.sweepBatchSize),
      this.options.sweepIntervalMs,
    );
    this.timer.unref();
  }
}
