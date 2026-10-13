import { parseTimeOfDay, weekdayOf } from "@/lib/time";
import type { AvailabilityOverride, AvailabilityRule } from "./types";

/** Half-open local-minute range [start, end). */
export type MinuteRange = [number, number];

export function mergeRanges(ranges: MinuteRange[]): MinuteRange[] {
  const sorted = ranges.filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
  const out: MinuteRange[] = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

export function subtractRange(ranges: MinuteRange[], [cs, ce]: MinuteRange): MinuteRange[] {
  return ranges.flatMap(([s, e]): MinuteRange[] => {
    if (ce <= s || cs >= e) return [[s, e]];
    const parts: MinuteRange[] = [];
    if (cs > s) parts.push([s, cs]);
    if (ce < e) parts.push([ce, e]);
    return parts;
  });
}

/** Indexes rules/overrides once so per-day lookups are O(1). */
export class AvailabilityIndex {
  private rules = new Map<string, AvailabilityRule[]>();
  private overrides = new Map<string, AvailabilityOverride[]>();

  constructor(rules: AvailabilityRule[], overrides: AvailabilityOverride[]) {
    for (const r of rules) push(this.rules, `${r.instructorId}|${r.weekday}`, r);
    for (const o of overrides) push(this.overrides, `${o.instructorId}|${o.date}`, o);
  }

  /** The instructor's free local-minute windows on a date: rules + extra availability − blackouts. */
  windows(instructorId: string, date: string): MinuteRange[] {
    const overrides = this.overrides.get(`${instructorId}|${date}`) ?? [];
    if (overrides.some((o) => o.kind === "blackout" && !o.startTime)) return [];

    const base: MinuteRange[] = (this.rules.get(`${instructorId}|${weekdayOf(date)}`) ?? [])
      .filter((r) => r.effectiveFrom <= date && (!r.effectiveUntil || r.effectiveUntil >= date))
      .map((r) => [parseTimeOfDay(r.startTime), parseTimeOfDay(r.endTime)]);

    const extra: MinuteRange[] = overrides
      .filter((o) => o.kind === "available" && o.startTime && o.endTime)
      .map((o) => [parseTimeOfDay(o.startTime!), parseTimeOfDay(o.endTime!)]);

    let windows = mergeRanges([...base, ...extra]);
    for (const o of overrides) {
      if (o.kind === "blackout" && o.startTime && o.endTime) {
        windows = subtractRange(windows, [parseTimeOfDay(o.startTime), parseTimeOfDay(o.endTime)]);
      }
    }
    return windows;
  }
}

function push<T>(map: Map<string, T[]>, key: string, value: T) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
