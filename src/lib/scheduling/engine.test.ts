import { describe, expect, it } from "vitest";
import { laWallTimeToUtc, formatTimeOfDay } from "@/lib/time";
import { ageInMonths, Scheduler, WEIGHTS } from "./engine";
import { SchedulingError, SWIM_LEVELS, type InstructorCapability, type SchedulingData, type SlotRequest } from "./types";

// "Now" = Mon 2026-10-12 08:00 PDT. With 24h notice, Mon 10/19 is the next Monday.
const NOW = Date.parse("2026-10-12T15:00:00Z");
const ZONE_A = "zone-a";
const ZONE_B = "zone-b";
const ZONE_C = "zone-c";

function instructor(id: string, over: Partial<InstructorCapability> = {}): InstructorCapability {
  return {
    id,
    firstName: id,
    photoPath: `/seed/instructors/${id}.svg`,
    specialties: [],
    levelsTaught: [...SWIM_LEVELS],
    minChildAgeMonths: 6,
    maxChildrenPerLesson: 4,
    isAcceptingNewClients: true,
    sortOrder: 1,
    zoneIds: [ZONE_A, ZONE_B, ZONE_C],
    ...over,
  };
}

function data(over: Partial<SchedulingData> = {}): SchedulingData {
  return {
    settings: {
      slotStepMinutes: 30,
      minNoticeHours: 24,
      maxHorizonDays: 60,
      defaultBufferMinutes: 30,
      neighborhoodWindowMinutes: 60,
      bookingRequestWindowHours: 12,
      offerMinLeadMinutes: 120,
      paymentHoldMinutes: 20,
      maxChildrenPerLesson: 6,
      minLessonMinutes: 30,
    },
    zones: [
      { id: ZONE_A, code: "A", name: "Core", minBookingMinutes: 0, isBookable: true },
      { id: ZONE_B, code: "B", name: "Greater", minBookingMinutes: 0, isBookable: true },
      { id: ZONE_C, code: "C", name: "Extended", minBookingMinutes: 60, isBookable: true },
    ],
    buffers: [
      { from: ZONE_A, to: ZONE_C, minutes: 45 },
      { from: ZONE_C, to: ZONE_A, minutes: 45 },
    ],
    instructors: [instructor("maya")],
    rules: [{ instructorId: "maya", weekday: 1, startTime: "08:00", endTime: "14:00", effectiveFrom: "2026-01-01", effectiveUntil: null }],
    overrides: [],
    occupied: [],
    ...over,
  };
}

const at = (date: string, hhmm: string) => laWallTimeToUtc(date, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)));
const lesson = (instructorId: string, zoneId: string | null, date: string, from: string, to: string) => ({
  instructorId,
  zoneId,
  start: at(date, from),
  end: at(date, to),
});

function req(over: Partial<SlotRequest> = {}): SlotRequest {
  return {
    zoneId: ZONE_A,
    durationMinutes: 60,
    swimmers: [{ ageMonths: 60, level: "beginner" }],
    fromDate: "2026-10-12",
    toDate: "2026-10-19",
    ...over,
  };
}

const times = (slots: { startMinutes: number }[]) => slots.map((s) => formatTimeOfDay(s.startMinutes));

describe("availability windows", () => {
  it("offers every step that fits inside the weekly window, after the notice period", () => {
    const { slots } = new Scheduler(data(), NOW).findSlots(req());
    // Mon 10/12 is inside the 24h notice → only Mon 10/19.
    expect(new Set(slots.map((s) => s.date))).toEqual(new Set(["2026-10-19"]));
    expect(times(slots)).toEqual(["08:00", "08:30", "09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30", "13:00"]);
    expect(new Date(slots[0].start).toISOString()).toBe("2026-10-19T15:00:00.000Z");
  });

  it("ignoreNotice exposes same-day times that haven't started", () => {
    const { slots } = new Scheduler(data(), NOW).findSlots(req({ ignoreNotice: true, toDate: "2026-10-12" }));
    expect(times(slots)[0]).toBe("08:00");
  });

  it("applies whole-day blackouts, partial blackouts and extra availability", () => {
    const blackout = new Scheduler(
      data({ overrides: [{ instructorId: "maya", date: "2026-10-19", kind: "blackout", startTime: null, endTime: null }] }),
      NOW,
    ).findSlots(req());
    expect(blackout.slots).toEqual([]);

    const partial = new Scheduler(
      data({
        overrides: [
          { instructorId: "maya", date: "2026-10-19", kind: "blackout", startTime: "09:00", endTime: "13:00" },
          { instructorId: "maya", date: "2026-10-17", kind: "available", startTime: "15:00", endTime: "16:00" },
        ],
      }),
      NOW,
    ).findSlots(req());
    expect(partial.slots.map((s) => `${s.date} ${formatTimeOfDay(s.startMinutes)}`)).toEqual([
      "2026-10-17 15:00",
      "2026-10-19 08:00",
      "2026-10-19 13:00",
    ]);
  });

  it("respects rule effective dates", () => {
    const d = data({ rules: [{ instructorId: "maya", weekday: 1, startTime: "08:00", endTime: "14:00", effectiveFrom: "2026-10-20", effectiveUntil: null }] });
    expect(new Scheduler(d, NOW).findSlots(req()).slots).toEqual([]);
  });

  it("converts local times correctly across the DST change", () => {
    const d = data({ rules: [{ instructorId: "maya", weekday: 0, startTime: "09:00", endTime: "10:00", effectiveFrom: "2026-01-01", effectiveUntil: null }] });
    const { slots } = new Scheduler(d, NOW).findSlots(req({ fromDate: "2026-10-25", toDate: "2026-11-01" }));
    expect(slots.map((s) => new Date(s.start).toISOString())).toEqual(["2026-10-25T16:00:00.000Z", "2026-11-01T17:00:00.000Z"]);
  });

  it("never offers dates past the booking horizon", () => {
    const { slots } = new Scheduler(data(), NOW).findSlots(req({ fromDate: "2026-12-20", toDate: "2027-01-31" }));
    expect(slots.every((s) => s.date <= "2026-12-11")).toBe(true);
  });
});

describe("travel buffers", () => {
  it("keeps the same-zone buffer around an existing lesson", () => {
    const d = data({ occupied: [lesson("maya", ZONE_A, "2026-10-19", "10:00", "11:00")] });
    expect(times(new Scheduler(d, NOW).findSlots(req()).slots)).toEqual(["08:00", "08:30", "11:30", "12:00", "12:30", "13:00"]);
  });

  it("uses the zone-pair buffer when travelling between zones", () => {
    const d = data({ occupied: [lesson("maya", ZONE_A, "2026-10-19", "10:00", "11:00")] });
    // A↔C needs 45 minutes each way.
    expect(times(new Scheduler(d, NOW).findSlots(req({ zoneId: ZONE_C })).slots)).toEqual(["08:00", "12:00", "12:30", "13:00"]);
  });

  it("treats calendar busy blocks (no zone) with the default buffer", () => {
    const d = data({ occupied: [lesson("maya", null, "2026-10-19", "08:00", "12:00")] });
    expect(times(new Scheduler(d, NOW).findSlots(req()).slots)).toEqual(["12:30", "13:00"]);
  });
});

describe("qualification", () => {
  const two = [instructor("maya"), instructor("jordan", { sortOrder: 2 })];
  const both = (over: Partial<InstructorCapability>) =>
    data({
      instructors: [instructor("maya", over), instructor("jordan", { sortOrder: 2 })],
      rules: two.map((i) => ({ instructorId: i.id, weekday: 1, startTime: "09:00", endTime: "10:00", effectiveFrom: "2026-01-01", effectiveUntil: null })),
    });
  const who = (d: SchedulingData, r: Partial<SlotRequest> = {}) => new Scheduler(d, NOW).findSlots(req(r)).eligibleInstructorIds;

  it("filters by zone coverage, levels, age, and group size", () => {
    expect(who(both({ zoneIds: [ZONE_B] }))).toEqual(["jordan"]);
    expect(who(both({ levelsTaught: ["advanced", "stroke_technique"] }))).toEqual(["jordan"]);
    expect(who(both({ minChildAgeMonths: 48 }), { swimmers: [{ ageMonths: 30, level: "water_acclimation" }] })).toEqual(["jordan"]);
    expect(who(both({ maxChildrenPerLesson: 2 }), { swimmers: Array(3).fill({ ageMonths: 72, level: "beginner" }) })).toEqual(["jordan"]);
  });

  it("instructors not taking new clients are only bookable by families who chose them", () => {
    const d = both({ isAcceptingNewClients: false });
    expect(who(d)).toEqual(["jordan"]);
    expect(who(d, { favoriteInstructorId: "maya" })).toEqual(["maya", "jordan"]);
    expect(who(d, { instructorId: "maya" })).toEqual(["maya"]);
  });

  it("a specific instructor request only returns that instructor", () => {
    const d = both({});
    const { slots } = new Scheduler(d, NOW).findSlots(req({ instructorId: "jordan" }));
    expect(slots.flatMap((s) => s.candidates.map((c) => c.instructorId))).toEqual(["jordan"]);
  });

  it("rejects requests that break zone or platform rules", () => {
    const s = new Scheduler(data(), NOW);
    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (e) {
        return (e as SchedulingError).code;
      }
    };
    expect(code(() => s.findSlots(req({ zoneId: ZONE_C, durationMinutes: 30 })))).toBe("below_zone_minimum");
    expect(code(() => s.findSlots(req({ zoneId: "nowhere" })))).toBe("zone_not_found");
    expect(code(() => s.findSlots(req({ swimmers: [] })))).toBe("no_swimmers");
    expect(code(() => s.findSlots(req({ swimmers: Array(7).fill({ ageMonths: 60, level: "beginner" }) })))).toBe("too_many_swimmers");
  });
});

describe("neighborhood slots", () => {
  it("flags slots within 60 minutes of the instructor's lesson in the same zone", () => {
    const d = data({ occupied: [lesson("maya", ZONE_A, "2026-10-19", "10:00", "11:00")] });
    const { slots } = new Scheduler(d, NOW).findSlots(req());
    const flags = Object.fromEntries(slots.map((s) => [formatTimeOfDay(s.startMinutes), s.isNeighborhoodSlot]));
    expect(flags).toEqual({ "08:00": true, "08:30": true, "11:30": true, "12:00": true, "12:30": false, "13:00": false });
  });

  it("is not a neighborhood slot when the nearby lesson is in another zone", () => {
    const d = data({ occupied: [lesson("maya", ZONE_B, "2026-10-19", "10:00", "11:00")] });
    const { slots } = new Scheduler(d, NOW).findSlots(req());
    expect(slots.some((s) => s.isNeighborhoodSlot)).toBe(false);
  });
});

describe("ranking", () => {
  const twoInstructors = (occupied: SchedulingData["occupied"]) =>
    data({
      instructors: [instructor("maya"), instructor("jordan", { sortOrder: 2 })],
      rules: ["maya", "jordan"].map((id) => ({ instructorId: id, weekday: 1, startTime: "08:00", endTime: "14:00", effectiveFrom: "2026-01-01", effectiveUntil: null })),
      occupied,
    });

  it("prefers the instructor already teaching next door (geographic clustering)", () => {
    const d = twoInstructors([lesson("jordan", ZONE_A, "2026-10-19", "10:00", "11:00")]);
    const slot = new Scheduler(d, NOW).findSlots(req()).slots.find((s) => formatTimeOfDay(s.startMinutes) === "11:30")!;
    expect(slot.candidates.map((c) => c.instructorId)).toEqual(["jordan", "maya"]);
    expect(slot.isNeighborhoodSlot).toBe(true);
    expect(slot.candidates[0].reasons).toContain("back-to-back with another lesson");
  });

  it("isolates the neighborhood bonus: same-zone neighbor beats an equally-spaced other-zone neighbor", () => {
    const d = twoInstructors([
      lesson("jordan", ZONE_A, "2026-10-19", "10:00", "11:00"),
      lesson("maya", ZONE_B, "2026-10-19", "10:00", "11:00"),
    ]);
    const slot = new Scheduler(d, NOW).findSlots(req()).slots.find((s) => formatTimeOfDay(s.startMinutes) === "12:00")!;
    const [first, second] = slot.candidates;
    expect([first.instructorId, second.instructorId]).toEqual(["jordan", "maya"]);
    expect(first.isNeighborhoodSlot).toBe(true);
    expect(second.isNeighborhoodSlot).toBe(false);
    expect(first.score - second.score).toBe(WEIGHTS.neighborhood);
  });

  it("rewards slots that exactly fill a gap in an instructor's day", () => {
    const d = data({
      occupied: [lesson("maya", ZONE_A, "2026-10-19", "08:00", "09:00"), lesson("maya", ZONE_A, "2026-10-19", "10:30", "11:30")],
    });
    const { slots } = new Scheduler(d, NOW).findSlots(req({ durationMinutes: 30 }));
    const gap = slots.find((s) => formatTimeOfDay(s.startMinutes) === "09:30")!;
    expect(gap.candidates[0].reasons).toContain("fills a gap in the instructor's day");
    expect(gap.score).toBe(Math.max(...slots.map((s) => s.score)));
  });

  it("penalizes leaving a gap too short to sell", () => {
    const d = data({ occupied: [lesson("maya", ZONE_A, "2026-10-19", "08:00", "09:00")] });
    const { slots } = new Scheduler(d, NOW).findSlots(req());
    // 10:00 leaves 30 idle minutes after the 30-minute buffer — not enough for a lesson + buffer.
    const ten = slots.find((s) => formatTimeOfDay(s.startMinutes) === "10:00")!;
    expect(ten.candidates[0].reasons).toContain("leaves an unusable gap");
  });

  it("boosts the favorite instructor", () => {
    const d = twoInstructors([]);
    const slot = new Scheduler(d, NOW).findSlots(req({ favoriteInstructorId: "jordan" })).slots[0];
    expect(slot.candidates[0]).toMatchObject({ instructorId: "jordan" });
    expect(slot.candidates[0].score - slot.candidates[1].score).toBe(WEIGHTS.requestedOrFavorite);
  });

  it("suggests at most 6 slots and at most 2 per day", () => {
    const d = data({
      rules: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ instructorId: "maya", weekday, startTime: "08:00", endTime: "18:00", effectiveFrom: "2026-01-01", effectiveUntil: null })),
    });
    const { suggested } = new Scheduler(d, NOW).findSlots(req({ toDate: "2026-10-31" }));
    expect(suggested).toHaveLength(6);
    const perDay = suggested.reduce<Record<string, number>>((acc, s) => ({ ...acc, [s.date]: (acc[s.date] ?? 0) + 1 }), {});
    expect(Math.max(...Object.values(perDay))).toBeLessThanOrEqual(2);
  });
});

describe("parent preferences", () => {
  it("flags or filters slots by preferred days and times", () => {
    const d = data({
      rules: [1, 3].map((weekday) => ({ instructorId: "maya", weekday, startTime: "08:00", endTime: "14:00", effectiveFrom: "2026-01-01", effectiveUntil: null })),
    });
    const preferences = { weekdays: [3], windows: [{ start: "09:00", end: "11:00" }] };
    const all = new Scheduler(d, NOW).findSlots(req({ preferences, toDate: "2026-10-21" }));
    expect(all.slots.length).toBeGreaterThan(2);
    expect(all.slots.filter((s) => s.matchesPreferences).map((s) => `${s.date} ${formatTimeOfDay(s.startMinutes)}`)).toEqual([
      "2026-10-14 09:00",
      "2026-10-14 09:30",
      "2026-10-14 10:00",
      "2026-10-21 09:00",
      "2026-10-21 09:30",
      "2026-10-21 10:00",
    ]);
    const only = new Scheduler(d, NOW).findSlots(req({ preferences, onlyPreferred: true, toDate: "2026-10-21" }));
    expect(only.slots.every((s) => s.matchesPreferences)).toBe(true);
  });
});

describe("rankInstructorsForSlot (booking request offers)", () => {
  const d = data({
    instructors: [instructor("maya"), instructor("jordan", { sortOrder: 2 }), instructor("sofia", { sortOrder: 3, zoneIds: [ZONE_B] })],
    rules: ["maya", "jordan", "sofia"].map((id) => ({ instructorId: id, weekday: 1, startTime: "08:00", endTime: "14:00", effectiveFrom: "2026-01-01", effectiveUntil: null })),
    occupied: [lesson("jordan", ZONE_A, "2026-10-19", "08:00", "09:00"), lesson("maya", ZONE_A, "2026-10-19", "09:00", "10:00")],
  });
  const start = at("2026-10-19", "10:30");

  it("returns qualified, free instructors best-first", () => {
    const ranked = new Scheduler(d, NOW).rankInstructorsForSlot({ zoneId: ZONE_A, durationMinutes: 60, swimmers: [{ ageMonths: 60, level: "beginner" }], start });
    expect(ranked.map((c) => c.instructorId)).toEqual(["maya", "jordan"]);
  });

  it("skips instructors who already declined, and those who are busy", () => {
    const ranked = new Scheduler(d, NOW).rankInstructorsForSlot({
      zoneId: ZONE_A,
      durationMinutes: 60,
      swimmers: [{ ageMonths: 60, level: "beginner" }],
      start: at("2026-10-19", "09:00"),
      excludeInstructorIds: [],
    });
    expect(ranked.map((c) => c.instructorId)).toEqual([]); // maya teaching, jordan needs 30-min buffer after 09:00
    const afterDecline = new Scheduler(d, NOW).rankInstructorsForSlot({
      zoneId: ZONE_A,
      durationMinutes: 60,
      swimmers: [{ ageMonths: 60, level: "beginner" }],
      start,
      excludeInstructorIds: ["maya"],
    });
    expect(afterDecline.map((c) => c.instructorId)).toEqual(["jordan"]);
  });
});

describe("ageInMonths", () => {
  it("counts whole months", () => {
    expect(ageInMonths("2021-10-19", "2026-10-19")).toBe(60);
    expect(ageInMonths("2021-10-20", "2026-10-19")).toBe(59);
  });
});

describe("weekly series", () => {
  const d = data({
    instructors: [instructor("maya"), instructor("jordan", { sortOrder: 2 })],
    rules: ["maya", "jordan"].map((id) => ({ instructorId: id, weekday: 1, startTime: "09:00", endTime: "11:00", effectiveFrom: "2026-01-01", effectiveUntil: null })),
    // Maya is booked at 09:00 in week 3; Jordan is off entirely in week 2.
    occupied: [lesson("maya", ZONE_A, "2026-11-02", "09:00", "10:00")],
    overrides: [{ instructorId: "jordan", date: "2026-10-26", kind: "blackout", startTime: null, endTime: null }],
  });

  it("only keeps instructors free at the same time every week of the term", () => {
    const s = new Scheduler(d, NOW);
    const four = s.findRecurringSlots(req({ fromDate: "2026-10-19", toDate: "2026-10-19" }), 4);
    const nine = four.slots.find((x) => formatTimeOfDay(x.startMinutes) === "09:00");
    // Maya is busy 11/2 at 09:00 and Jordan is off 10/26 → nobody can do Mondays 09:00 for 4 weeks.
    expect(nine).toBeUndefined();
    const ten = four.slots.find((x) => formatTimeOfDay(x.startMinutes) === "10:00");
    // 10:00 is 0 min after Maya's 09:00–10:00 on 11/2 → inside the 30-min buffer, so still nobody.
    expect(ten).toBeUndefined();

    const two = s.findRecurringSlots(req({ fromDate: "2026-10-19", toDate: "2026-10-19" }), 2);
    expect(two.slots.find((x) => formatTimeOfDay(x.startMinutes) === "09:00")!.candidates.map((c) => c.instructorId)).toEqual(["maya"]);
  });
});
