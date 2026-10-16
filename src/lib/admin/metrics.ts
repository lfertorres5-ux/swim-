/**
 * Dashboard math — pure functions so they're unit-tested without a database.
 */
import { AvailabilityIndex } from "@/lib/scheduling/availability";
import type { AvailabilityOverride, AvailabilityRule, OccupiedBlock } from "@/lib/scheduling/types";
import { addDays, daysBetween, laDateString, laWallTimeToUtc, weekdayOf } from "@/lib/time";

export type Utilization = { instructorId: string; availableMinutes: number; bookedMinutes: number; pct: number | null };

/**
 * Booked minutes ÷ available minutes per instructor over [fromDate, toDate]
 * (local dates, inclusive). Booked time counts only where it falls inside the
 * range; an instructor with no hours set shows pct = null.
 */
export function utilization(
  instructorIds: string[],
  rules: AvailabilityRule[],
  overrides: AvailabilityOverride[],
  booked: Pick<OccupiedBlock, "instructorId" | "start" | "end">[],
  fromDate: string,
  toDate: string,
): Utilization[] {
  const index = new AvailabilityIndex(rules, overrides);
  const rangeStart = laWallTimeToUtc(fromDate, 0);
  const rangeEnd = laWallTimeToUtc(addDays(toDate, 1), 0);
  const days = daysBetween(fromDate, toDate) + 1;

  return instructorIds.map((id) => {
    let available = 0;
    for (let i = 0; i < days; i++) {
      for (const [s, e] of index.windows(id, addDays(fromDate, i))) available += e - s;
    }
    const bookedMinutes = booked
      .filter((b) => b.instructorId === id)
      .reduce((sum, b) => sum + Math.max(0, Math.min(b.end, rangeEnd) - Math.max(b.start, rangeStart)) / 60_000, 0);
    return { instructorId: id, availableMinutes: available, bookedMinutes: Math.round(bookedMinutes), pct: available > 0 ? Math.min(100, Math.round((bookedMinutes / available) * 100)) : null };
  });
}

export type HeatCell = { count: number; intensity: number };
/** zone id → weekday (0 = Sunday) → lesson count, plus 0–1 intensity relative to the busiest cell. */
export function zoneHeatmap(lessons: { zoneId: string; startsAt: string }[], zoneIds: string[]): Record<string, HeatCell[]> {
  const grid: Record<string, number[]> = Object.fromEntries(zoneIds.map((z) => [z, Array(7).fill(0)]));
  for (const l of lessons) {
    const row = grid[l.zoneId];
    if (row) row[weekdayOf(laDateString(new Date(l.startsAt)))]++;
  }
  const max = Math.max(1, ...Object.values(grid).flat());
  return Object.fromEntries(Object.entries(grid).map(([z, row]) => [z, row.map((count) => ({ count, intensity: count / max }))]));
}

export type MoneyRow = { amount_cents: number; refunded_cents: number; status: string };
/** Collected minus refunds, over succeeded / (partially) refunded payments. */
export function netRevenue(payments: MoneyRow[]) {
  const settled = payments.filter((p) => ["succeeded", "partially_refunded", "refunded"].includes(p.status));
  const gross = settled.reduce((s, p) => s + p.amount_cents, 0);
  const refunds = settled.reduce((s, p) => s + p.refunded_cents, 0);
  return { grossCents: gross, refundsCents: refunds, netCents: gross - refunds };
}
