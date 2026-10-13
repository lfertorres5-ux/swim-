import type { SchedulingData, SchedulingSettings, SwimLevel } from "./types";

/** Shape returned by public.scheduling_snapshot(). */
export type RawSnapshot = {
  settings: Omit<SchedulingSettings, "neighborhoodWindowMinutes">;
  pricing: { neighborhoodWindowMinutes: number };
  zones: SchedulingData["zones"];
  buffers: SchedulingData["buffers"];
  instructors: (Omit<SchedulingData["instructors"][number], "levelsTaught"> & { levelsTaught: SwimLevel[] })[];
  rules: SchedulingData["rules"];
  overrides: SchedulingData["overrides"];
  bookings: { id: string; instructorId: string; zoneId: string; start: string; end: string }[];
};

/** Busy time from synced calendars (Phase 6) — no zone, default buffer applies. */
export type ExternalBusy = { instructorId: string; start: number; end: number };

export function toSchedulingData(raw: RawSnapshot, externalBusy: ExternalBusy[] = []): SchedulingData {
  return {
    settings: { ...raw.settings, neighborhoodWindowMinutes: raw.pricing.neighborhoodWindowMinutes },
    zones: raw.zones,
    buffers: raw.buffers,
    instructors: raw.instructors,
    rules: raw.rules,
    overrides: raw.overrides,
    occupied: [
      ...raw.bookings.map((b) => ({ id: b.id, instructorId: b.instructorId, zoneId: b.zoneId, start: Date.parse(b.start), end: Date.parse(b.end) })),
      ...externalBusy.map((b) => ({ ...b, zoneId: null })),
    ],
  };
}
