import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BoundedRateCounter } from "./bounded-rate-counter.js";

describe("bounded fixed-window counters", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-16T12:00:00Z"));
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("reclaims fifty thousand expired identities while idle, then releases its timer", () => {
    const counter = new BoundedRateCounter({ windowMs: 60_000 });
    for (let index = 0; index < 50_000; index += 1) {
      expect(counter.consume(`account-${index}`, 1)).toBe(true);
    }
    expect(counter.size).toBe(50_000);
    expect(counter.consume("overflow", 1)).toBe(false);
    vi.advanceTimersByTime(110_000);
    expect(counter.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds request cleanup work even when every stored identity has expired", () => {
    const counter = new BoundedRateCounter({ windowMs: 60_000 });
    for (let index = 0; index < 50_000; index += 1) counter.consume(`account-${index}`, 1);
    // Move the clock without running scheduled cleanup, as after a blocked event loop.
    vi.setSystemTime(Date.now() + 60_000);
    expect(counter.consume("new-account", 1)).toBe(true);
    expect(counter.size).toBe(50_000 - 64 + 1);
  });

  it("does not reset exhausted existing accounts when the store is saturated", () => {
    const counter = new BoundedRateCounter({ windowMs: 60_000, maxKeys: 2 });
    expect(counter.consume("limited", 1)).toBe(true);
    expect(counter.consume("available", 2)).toBe(true);
    for (let index = 0; index < 100; index += 1) {
      expect(counter.consume(`rotating-${index}`, 1)).toBe(false);
    }
    expect(counter.consume("limited", 1)).toBe(false);
    expect(counter.consume("available", 2)).toBe(true);
    expect(counter.size).toBe(2);
  });

  it("preserves expiry ordering and protection when the wall clock moves backwards", () => {
    const counter = new BoundedRateCounter({ windowMs: 60_000 });
    const started = Date.now();
    expect(counter.consume("first", 1)).toBe(true);
    vi.setSystemTime(started - 30_000);
    expect(counter.consume("second", 1)).toBe(true);
    expect(counter.consume("first", 1)).toBe(false);
    vi.setSystemTime(started + 59_999);
    expect(counter.consume("second", 1)).toBe(false);
    vi.setSystemTime(started + 60_000);
    expect(counter.consume("second", 1)).toBe(true);
    expect(counter.size).toBe(1);
  });

  it("cleans an expired key beyond the sweep budget without breaking its new window", () => {
    const counter = new BoundedRateCounter({ windowMs: 60_000, requestSweepSize: 1 });
    counter.consume("first", 1);
    counter.consume("second", 1);
    counter.consume("last", 1);
    vi.setSystemTime(Date.now() + 60_000);
    expect(counter.consume("last", 1)).toBe(true);
    expect(counter.consume("last", 1)).toBe(false);
  });

  it("releases service resources explicitly and never creates a timer before first admission", () => {
    const counter = new BoundedRateCounter({ windowMs: 60_000 });
    expect(vi.getTimerCount()).toBe(0);
    counter.consume("account", 1);
    expect(vi.getTimerCount()).toBe(1);
    counter.destroy();
    expect(counter.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    counter.destroy();
  });

  it("rejects invalid bounds and limits instead of disabling protection", () => {
    expect(() => new BoundedRateCounter({ windowMs: 0 })).toThrow();
    expect(() => new BoundedRateCounter({ windowMs: 60_000, maxKeys: Infinity })).toThrow();
    const counter = new BoundedRateCounter({ windowMs: 60_000 });
    for (const limit of [0, -1, NaN, Infinity, 1.5]) {
      expect(counter.consume("account", limit)).toBe(false);
    }
    expect(counter.size).toBe(0);
  });
});
