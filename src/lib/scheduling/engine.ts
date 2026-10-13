/**
 * Scheduling engine — pure functions, no I/O.
 *
 * A slot (start, instructor) is available when the instructor:
 *   1. is qualified: covers the zone, teaches every swimmer's level, meets the
 *      minimum age, allows that many swimmers, and is accepting new clients
 *      (unless the family picked or favorited them);
 *   2. has the whole lesson inside an availability window for that local day
 *      (weekly rules + extra availability − blackouts);
 *   3. keeps the zone-pair travel buffer before and after every lesson they
 *      already have (and the default buffer around external busy blocks).
 *
 * Candidates are ranked to cluster bookings geographically and pack instructor
 * days contiguously. The ranked candidate list is also the order in which a
 * booking request is offered to instructors.
 */
import { addDays, daysBetween, laDateString, laMinutesOfDay, laWallTimeToUtc, parseTimeOfDay, weekdayOf } from "@/lib/time";
import { AvailabilityIndex } from "./availability";
import {
  SchedulingError,
  type Candidate,
  type InstructorCapability,
  type OccupiedBlock,
  type SchedulingData,
  type Slot,
  type SlotRequest,
  type SlotResult,
  type Zone,
} from "./types";

const MINUTE = 60_000;

/** Score weights. Exported so the admin preview can explain rankings. */
export const WEIGHTS = {
  neighborhood: 40,
  fillsGap: 50,
  extendsDay: 30,
  sameZoneSameDay: 15,
  opensNewDay: -10,
  leavesUnusableGap: -15,
  requestedOrFavorite: 25,
  matchesPreferences: 10,
  perDayOut: -0.25,
} as const;

const MAX_SUGGESTED = 6;
const MAX_SUGGESTED_PER_DAY = 2;

export class Scheduler {
  private readonly availability: AvailabilityIndex;
  private readonly occupiedBy = new Map<string, OccupiedBlock[]>();
  private readonly bufferMatrix = new Map<string, number>();
  private readonly zones = new Map<string, Zone>();

  constructor(
    private readonly data: SchedulingData,
    private readonly now: number = Date.now(),
  ) {
    this.availability = new AvailabilityIndex(data.rules, data.overrides);
    for (const b of data.occupied) {
      const list = this.occupiedBy.get(b.instructorId) ?? [];
      list.push(b);
      this.occupiedBy.set(b.instructorId, list);
    }
    for (const list of this.occupiedBy.values()) list.sort((a, b) => a.start - b.start);
    for (const b of data.buffers) this.bufferMatrix.set(`${b.from}|${b.to}`, b.minutes);
    for (const z of data.zones) this.zones.set(z.id, z);
  }

  /** Travel time required from a lesson in `from` to a lesson in `to`, in minutes. */
  buffer(from: string | null, to: string | null): number {
    if (!from || !to) return this.data.settings.defaultBufferMinutes;
    return this.bufferMatrix.get(`${from}|${to}`) ?? this.data.settings.defaultBufferMinutes;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** All bookable slots in a date range, ranked, plus a short "suggested" list. */
  findSlots(req: SlotRequest): SlotResult {
    const zone = this.validate(req);
    const { settings } = this.data;
    const today = laDateString(new Date(this.now));
    const from = req.fromDate > today ? req.fromDate : today;
    const horizon = addDays(today, settings.maxHorizonDays);
    const to = req.toDate < horizon ? req.toDate : horizon;
    if (req.toDate < req.fromDate) throw new SchedulingError("invalid_range", "toDate is before fromDate");

    const eligible = this.eligibleInstructors(req);
    const earliest = req.ignoreNotice ? this.now : this.now + settings.minNoticeHours * 60 * MINUTE;
    const step = settings.slotStepMinutes;
    const bySlot = new Map<number, Slot>();

    for (let date = from; date <= to; date = addDays(date, 1)) {
      for (const instructor of eligible) {
        for (const [ws, we] of this.availability.windows(instructor.id, date)) {
          for (let t = Math.ceil(ws / step) * step; t + req.durationMinutes <= we; t += step) {
            const start = laWallTimeToUtc(date, t);
            const end = start + req.durationMinutes * MINUTE;
            if (start < earliest) continue;
            if (this.conflicts(instructor.id, start, end, zone.id)) continue;

            const candidate = this.score(instructor, req, zone.id, date, start, end);
            const slot = bySlot.get(start) ?? {
              start,
              end,
              date,
              startMinutes: t,
              candidates: [],
              isNeighborhoodSlot: false,
              matchesPreferences: matchesPreferences(req, date, t, req.durationMinutes),
              score: 0,
            };
            slot.candidates.push(candidate);
            bySlot.set(start, slot);
          }
        }
      }
    }

    const sortOrder = new Map(eligible.map((i) => [i.id, i.sortOrder]));
    const hasPreferences = Boolean(req.preferences?.weekdays?.length || req.preferences?.windows?.length);
    let slots = [...bySlot.values()];
    for (const slot of slots) {
      slot.candidates.sort(
        (a, b) => b.score - a.score || (sortOrder.get(a.instructorId)! - sortOrder.get(b.instructorId)!) || a.instructorId.localeCompare(b.instructorId),
      );
      const best = slot.candidates[0];
      slot.isNeighborhoodSlot = best.isNeighborhoodSlot;
      slot.score =
        best.score +
        (hasPreferences && slot.matchesPreferences ? WEIGHTS.matchesPreferences : 0) +
        WEIGHTS.perDayOut * daysBetween(today, slot.date);
    }
    if (req.onlyPreferred && hasPreferences) slots = slots.filter((s) => s.matchesPreferences);
    slots.sort((a, b) => a.start - b.start);

    return { slots, suggested: pickSuggested(slots), eligibleInstructorIds: eligible.map((i) => i.id) };
  }

  /**
   * Ranked instructors who could take one exact lesson time — used to offer a
   * booking request and to auto-offer the next instructor after a decline.
   */
  rankInstructorsForSlot(req: Omit<SlotRequest, "fromDate" | "toDate"> & { start: number }): Candidate[] {
    const zone = this.validate(req);
    const date = laDateString(new Date(req.start));
    const t = laMinutesOfDay(req.start);
    const end = req.start + req.durationMinutes * MINUTE;

    const sortOrder = new Map(this.data.instructors.map((i) => [i.id, i.sortOrder]));
    return this.eligibleInstructors(req)
      .filter((i) => this.isFree(i.id, date, t, req.durationMinutes, zone.id))
      .map((i) => this.score(i, req, zone.id, date, req.start, end))
      .sort((a, b) => b.score - a.score || sortOrder.get(a.instructorId)! - sortOrder.get(b.instructorId)!);
  }

  /**
   * Slots for a weekly series: the first lesson falls in [fromDate, toDate] and
   * the same instructor must be free at the same local time for every week of
   * the term. Candidates who can't make every week are dropped. The scheduler's
   * data must cover the whole term (toDate + 7 × (weeks − 1)).
   */
  findRecurringSlots(req: SlotRequest, weeks: number): SlotResult {
    const first = this.findSlots(req);
    const slots = first.slots
      .map((slot) => {
        const candidates = slot.candidates.filter((c) =>
          Array.from({ length: weeks - 1 }, (_, k) => addDays(slot.date, 7 * (k + 1))).every((date) =>
            this.isFree(c.instructorId, date, slot.startMinutes, req.durationMinutes, req.zoneId),
          ),
        );
        return candidates.length ? { ...slot, candidates, isNeighborhoodSlot: candidates[0].isNeighborhoodSlot } : null;
      })
      .filter((s): s is Slot => s !== null);
    return { slots, suggested: pickSuggested(slots), eligibleInstructorIds: first.eligibleInstructorIds };
  }

  /** Inside the instructor's hours on `date` and clear of every lesson + travel buffer. */
  isFree(instructorId: string, date: string, startMinutes: number, durationMinutes: number, zoneId: string): boolean {
    const inHours = this.availability.windows(instructorId, date).some(([ws, we]) => ws <= startMinutes && startMinutes + durationMinutes <= we);
    if (!inHours) return false;
    const start = laWallTimeToUtc(date, startMinutes);
    return !this.conflicts(instructorId, start, start + durationMinutes * MINUTE, zoneId);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private validate(req: Pick<SlotRequest, "zoneId" | "durationMinutes" | "swimmers">): Zone {
    const zone = this.zones.get(req.zoneId);
    if (!zone) throw new SchedulingError("zone_not_found", "Unknown service zone");
    if (!zone.isBookable) throw new SchedulingError("zone_not_bookable", `Zone ${zone.code} is not currently bookable`);
    if (!Number.isInteger(req.durationMinutes) || req.durationMinutes <= 0) {
      throw new SchedulingError("invalid_duration", "Lesson length must be a positive number of minutes");
    }
    if (req.durationMinutes < zone.minBookingMinutes) {
      throw new SchedulingError("below_zone_minimum", `Zone ${zone.code} requires at least ${zone.minBookingMinutes} minutes per booking`);
    }
    if (req.swimmers.length === 0) throw new SchedulingError("no_swimmers", "Add at least one swimmer");
    if (req.swimmers.length > this.data.settings.maxChildrenPerLesson) {
      throw new SchedulingError("too_many_swimmers", `At most ${this.data.settings.maxChildrenPerLesson} swimmers per lesson`);
    }
    return zone;
  }

  private eligibleInstructors(req: Pick<SlotRequest, "zoneId" | "swimmers" | "instructorId" | "favoriteInstructorId" | "excludeInstructorIds">): InstructorCapability[] {
    const exclude = new Set(req.excludeInstructorIds ?? []);
    return this.data.instructors.filter((i) => {
      if (exclude.has(i.id)) return false;
      if (req.instructorId && i.id !== req.instructorId) return false;
      return qualifies(i, req) && (i.isAcceptingNewClients || i.id === req.instructorId || i.id === req.favoriteInstructorId);
    });
  }

  private conflicts(instructorId: string, start: number, end: number, zoneId: string): boolean {
    for (const b of this.occupiedBy.get(instructorId) ?? []) {
      if (b.start >= end + 4 * 60 * MINUTE) break; // sorted; nothing later can conflict
      const before = this.buffer(zoneId, b.zoneId) * MINUTE; // travel from this lesson to b
      const after = this.buffer(b.zoneId, zoneId) * MINUTE; //  travel from b to this lesson
      if (b.start < end + before && start < b.end + after) return true;
    }
    return false;
  }

  private score(
    instructor: InstructorCapability,
    req: Pick<SlotRequest, "instructorId" | "favoriteInstructorId">,
    zoneId: string,
    date: string,
    start: number,
    end: number,
  ): Candidate {
    const { settings } = this.data;
    const dayStart = laWallTimeToUtc(date, 0);
    const dayEnd = laWallTimeToUtc(addDays(date, 1), 0);
    const lessons = (this.occupiedBy.get(instructor.id) ?? []).filter((b) => b.zoneId && b.start < dayEnd && b.end > dayStart);

    let prev: OccupiedBlock | undefined;
    let next: OccupiedBlock | undefined;
    for (const b of lessons) {
      if (b.end <= start && (!prev || b.end > prev.end)) prev = b;
      if (b.start >= end && (!next || b.start < next.start)) next = b;
    }

    const reasons: string[] = [];
    let score = 0;
    const window = settings.neighborhoodWindowMinutes;
    const gapPrev = prev ? (start - prev.end) / MINUTE : null;
    const gapNext = next ? (next.start - end) / MINUTE : null;

    const isNeighborhoodSlot =
      (prev?.zoneId === zoneId && gapPrev! <= window) || (next?.zoneId === zoneId && gapNext! <= window);
    if (isNeighborhoodSlot) {
      score += WEIGHTS.neighborhood;
      reasons.push("next to a lesson in the same zone");
    } else if (lessons.some((b) => b.zoneId === zoneId)) {
      score += WEIGHTS.sameZoneSameDay;
      reasons.push("already teaching in this zone that day");
    }

    // Idle time beyond the required travel buffer on each side.
    const idlePrev = prev ? gapPrev! - this.buffer(prev.zoneId, zoneId) : null;
    const idleNext = next ? gapNext! - this.buffer(zoneId, next.zoneId) : null;
    const tight = (idle: number | null) => idle !== null && idle < settings.slotStepMinutes;
    if (tight(idlePrev) && tight(idleNext)) {
      score += WEIGHTS.fillsGap;
      reasons.push("fills a gap in the instructor's day");
    } else if (tight(idlePrev) || tight(idleNext)) {
      score += WEIGHTS.extendsDay;
      reasons.push("back-to-back with another lesson");
    }

    // Leftover idle that's too short to sell another lesson into.
    const unusable = (idle: number | null) =>
      idle !== null && idle >= settings.slotStepMinutes && idle < settings.minLessonMinutes + settings.defaultBufferMinutes;
    for (const idle of [idlePrev, idleNext]) {
      if (unusable(idle)) {
        score += WEIGHTS.leavesUnusableGap;
        reasons.push("leaves an unusable gap");
      }
    }

    if (lessons.length === 0) {
      score += WEIGHTS.opensNewDay;
      reasons.push("first lesson of the instructor's day");
    }

    if (instructor.id === req.instructorId || instructor.id === req.favoriteInstructorId) {
      score += WEIGHTS.requestedOrFavorite;
      reasons.push(instructor.id === req.instructorId ? "requested instructor" : "favorite instructor");
    }

    return { instructorId: instructor.id, score, isNeighborhoodSlot, reasons };
  }
}

export function qualifies(i: InstructorCapability, req: Pick<SlotRequest, "zoneId" | "swimmers">): boolean {
  if (!i.zoneIds.includes(req.zoneId)) return false;
  if (req.swimmers.length > i.maxChildrenPerLesson) return false;
  return req.swimmers.every(
    (s) => i.levelsTaught.includes(s.level) && (s.ageMonths === null || s.ageMonths >= i.minChildAgeMonths),
  );
}

function matchesPreferences(req: SlotRequest, date: string, startMinutes: number, duration: number): boolean {
  const p = req.preferences;
  if (!p) return true;
  if (p.weekdays?.length && !p.weekdays.includes(weekdayOf(date))) return false;
  if (p.windows?.length) {
    return p.windows.some((w) => parseTimeOfDay(w.start) <= startMinutes && startMinutes + duration <= parseTimeOfDay(w.end));
  }
  return true;
}

/** Best-scoring slots, spread across days so the list isn't one afternoon. */
function pickSuggested(slots: Slot[]): Slot[] {
  const perDay = new Map<string, number>();
  const picked: Slot[] = [];
  for (const slot of [...slots].sort((a, b) => b.score - a.score || a.start - b.start)) {
    const n = perDay.get(slot.date) ?? 0;
    if (n >= MAX_SUGGESTED_PER_DAY) continue;
    perDay.set(slot.date, n + 1);
    picked.push(slot);
    if (picked.length === MAX_SUGGESTED) break;
  }
  return picked.sort((a, b) => a.start - b.start);
}

/** Age in whole months on a given local date. */
export function ageInMonths(birthDate: string, onDate: string): number {
  const [by, bm, bd] = birthDate.split("-").map(Number);
  const [y, m, d] = onDate.split("-").map(Number);
  return (y - by) * 12 + (m - bm) - (d < bd ? 1 : 0);
}
