/**
 * Relative-date resolver.
 *
 * LLM users naturally write "last 7 days" or "yesterday" rather than ISO
 * dates. The MCP tool schemas accept those strings and resolve them to
 * the YYYY-MM-DD (UTC) values the WireBoard API expects.
 *
 * Always UTC. Always inclusive on both ends (matches API semantics).
 */

const LAST_N_DAYS = /^(?:last|past)\s+(\d+)\s+days?$/i;
const BARE_N_DAYS = /^(\d+)\s*d$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type DateRange = { from: string; to: string };

export function resolveRange(value: string): DateRange {
  if (typeof value !== "string") {
    throw new Error(`date range must be a string, got ${typeof value}`);
  }
  const raw = value.trim().toLowerCase();
  const today = utcToday();

  if (raw === "today") return iso(today, today);
  if (raw === "yesterday") {
    const d = addDays(today, -1);
    return iso(d, d);
  }

  const m = raw.match(LAST_N_DAYS) ?? raw.match(BARE_N_DAYS);
  if (m) {
    const n = Number(m[1]);
    if (n < 1 || n > 366) {
      throw new Error("'last N days' must be 1..366");
    }
    return iso(addDays(today, -(n - 1)), today);
  }

  if (raw === "this week") {
    // Monday of the current week through today (ISO weeks: Mon=0..Sun=6)
    return iso(addDays(today, -isoWeekday(today)), today);
  }
  if (raw === "last week") {
    const end = addDays(today, -(isoWeekday(today) + 1));
    return iso(addDays(end, -6), end);
  }

  if (raw === "this month") {
    return iso(firstOfMonth(today), today);
  }
  if (raw === "last month") {
    const firstOfThis = firstOfMonth(today);
    const end = addDays(firstOfThis, -1);
    return iso(firstOfMonth(end), end);
  }

  if (raw.includes("..")) {
    const parts = raw.split("..");
    if (parts.length === 2 && ISO_DATE.test(parts[0]!.trim()) && ISO_DATE.test(parts[1]!.trim())) {
      return { from: parts[0]!.trim(), to: parts[1]!.trim() };
    }
  }

  throw new Error(
    `unrecognised date range: ${JSON.stringify(value)}. ` +
      "Use 'today', 'yesterday', 'last N days', 'this/last week', " +
      "'this/last month', or 'YYYY-MM-DD..YYYY-MM-DD'.",
  );
}

export function resolveSingle(value: string): string {
  if (typeof value !== "string") {
    throw new Error(`date must be a string, got ${typeof value}`);
  }
  const raw = value.trim().toLowerCase();
  const today = utcToday();
  if (raw === "today") return formatDate(today);
  if (raw === "yesterday") return formatDate(addDays(today, -1));
  const trimmed = value.trim();
  if (ISO_DATE.test(trimmed)) return trimmed;
  throw new Error(`unrecognised date: ${JSON.stringify(value)}. Use YYYY-MM-DD, 'today', or 'yesterday'.`);
}

// ─── helpers ────────────────────────────────────────────────────────────────

function utcToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function addDays(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n));
}

function firstOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function isoWeekday(d: Date): number {
  // ISO weeks: Monday=0..Sunday=6. getUTCDay returns Sunday=0..Saturday=6.
  return (d.getUTCDay() + 6) % 7;
}

function formatDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function iso(from: Date, to: Date): DateRange {
  return { from: formatDate(from), to: formatDate(to) };
}
