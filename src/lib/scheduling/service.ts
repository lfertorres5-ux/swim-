import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { addDays, laDateString } from "@/lib/time";
import { Scheduler } from "./engine";
import { toSchedulingData, type RawSnapshot } from "./snapshot";
import type { SchedulingData, SlotRequest, SlotResult } from "./types";

/**
 * Loads everything the engine needs for a date range in one RPC. Runs with the
 * service role because availability spans every instructor's calendar; the
 * snapshot itself contains no client PII.
 */
export async function loadSchedulingData(fromDate: string, toDate: string): Promise<SchedulingData> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("scheduling_snapshot", { p_from: fromDate, p_to: toDate });
  if (error) throw new Error(`scheduling_snapshot failed: ${error.message}`);
  // TODO(phase 6): merge Google Calendar busy blocks as externalBusy.
  return toSchedulingData(data as RawSnapshot);
}

export async function getAvailability(req: SlotRequest, now = Date.now()): Promise<SlotResult> {
  const data = await loadSchedulingData(req.fromDate, req.toDate);
  return new Scheduler(data, now).findSlots(req);
}

/**
 * Scheduler covering the day of `start` (plus neighbors, for buffers across
 * midnight) and, for weekly series, the following `weeks − 1` weeks.
 * `excludeBookingIds` removes lessons being moved (reschedule) from the busy set.
 */
export async function schedulerForInstant(start: number, now = Date.now(), opts: { weeks?: number; excludeBookingIds?: string[] } = {}) {
  const date = laDateString(new Date(start));
  const data = await loadSchedulingData(addDays(date, -1), addDays(date, 7 * ((opts.weeks ?? 1) - 1) + 1));
  if (opts.excludeBookingIds?.length) {
    const skip = new Set(opts.excludeBookingIds);
    data.occupied = data.occupied.filter((b) => !b.id || !skip.has(b.id));
  }
  return { scheduler: new Scheduler(data, now), data };
}
