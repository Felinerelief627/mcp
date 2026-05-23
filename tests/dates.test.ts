import { describe, expect, it } from "vitest";

import { resolveRange, resolveSingle } from "../src/dates.js";

function today(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function addDays(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n));
}

function iso(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

describe("resolveRange", () => {
  it("today", () => {
    const t = today();
    expect(resolveRange("today")).toEqual({ from: iso(t), to: iso(t) });
  });

  it("yesterday", () => {
    const y = addDays(today(), -1);
    expect(resolveRange("yesterday")).toEqual({ from: iso(y), to: iso(y) });
  });

  it("last N days", () => {
    const t = today();
    const { from, to } = resolveRange("last 7 days");
    expect(to).toBe(iso(t));
    expect(from).toBe(iso(addDays(t, -6)));
  });

  it("bare N days short form", () => {
    const t = today();
    const { from, to } = resolveRange("30d");
    expect(to).toBe(iso(t));
    expect(from).toBe(iso(addDays(t, -29)));
  });

  it("this week starts Monday", () => {
    const t = today();
    const { from, to } = resolveRange("this week");
    expect(to).toBe(iso(t));
    const start = new Date(`${from}T00:00:00Z`);
    // ISO weekday: Monday is (getUTCDay() + 6) % 7 === 0
    expect((start.getUTCDay() + 6) % 7).toBe(0);
    expect(start.getTime()).toBeLessThanOrEqual(t.getTime());
  });

  it("last week is Mon–Sun, 7 days", () => {
    const { from, to } = resolveRange("last week");
    const s = new Date(`${from}T00:00:00Z`);
    const e = new Date(`${to}T00:00:00Z`);
    expect((s.getUTCDay() + 6) % 7).toBe(0); // Monday
    expect((e.getUTCDay() + 6) % 7).toBe(6); // Sunday
    expect((e.getTime() - s.getTime()) / 86_400_000).toBe(6);
  });

  it("this month", () => {
    const t = today();
    const { from, to } = resolveRange("this month");
    expect(to).toBe(iso(t));
    expect(from).toBe(iso(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1))));
  });

  it("last month ends on the last day of the previous calendar month", () => {
    const { from, to } = resolveRange("last month");
    const s = new Date(`${from}T00:00:00Z`);
    const e = new Date(`${to}T00:00:00Z`);
    expect(s.getUTCDate()).toBe(1);
    const nextDay = addDays(e, 1);
    expect(nextDay.getUTCDate()).toBe(1);
    expect(nextDay.getTime()).toBeGreaterThan(e.getTime());
  });

  it("explicit YYYY-MM-DD..YYYY-MM-DD range", () => {
    expect(resolveRange("2026-05-01..2026-05-22")).toEqual({
      from: "2026-05-01",
      to: "2026-05-22",
    });
  });

  it("is case-insensitive", () => {
    expect(resolveRange("LAST 7 Days")).toEqual(resolveRange("last 7 days"));
  });

  it.each([
    "",
    "next week",
    "tomorrow",
    "last 0 days",
    "last 500 days",
    "2026/05/01..2026/05/22",
    "2026-05-01", // single date — use resolveSingle instead
  ])("rejects %j", (bad) => {
    expect(() => resolveRange(bad)).toThrow();
  });
});

describe("resolveSingle", () => {
  it("today", () => {
    expect(resolveSingle("today")).toBe(iso(today()));
  });

  it("yesterday", () => {
    expect(resolveSingle("yesterday")).toBe(iso(addDays(today(), -1)));
  });

  it("ISO literal passes through", () => {
    expect(resolveSingle("2026-05-22")).toBe("2026-05-22");
  });

  it.each(["", "last 7 days", "May 22", "2026/05/22"])("rejects %j", (bad) => {
    expect(() => resolveSingle(bad)).toThrow();
  });
});
