import { describe, expect, it } from "vitest";
import { addDays, formatTime, laDateString } from "./time";

describe("time helpers (America/Los_Angeles)", () => {
  it("uses the San Diego calendar day, not UTC", () => {
    // 2026-10-14 03:30 UTC is still Oct 13 in San Diego (PDT, UTC-7).
    expect(laDateString(new Date("2026-10-14T03:30:00Z"))).toBe("2026-10-13");
    expect(laDateString(new Date("2026-10-14T07:00:00Z"))).toBe("2026-10-14");
  });

  it("formats wall-clock time across the DST change", () => {
    expect(formatTime("2026-11-01T16:00:00Z")).toBe("8:00 AM"); // PST
    expect(formatTime("2026-10-31T16:00:00Z")).toBe("9:00 AM"); // PDT
  });

  it("adds calendar days", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

import { laMinutesOfDay, laWallTimeToUtc, weekdayOf, daysBetween } from "./time";

describe("laWallTimeToUtc", () => {
  it("handles PDT and PST", () => {
    expect(new Date(laWallTimeToUtc("2026-07-04", 9 * 60)).toISOString()).toBe("2026-07-04T16:00:00.000Z");
    expect(new Date(laWallTimeToUtc("2026-12-01", 9 * 60)).toISOString()).toBe("2026-12-01T17:00:00.000Z");
  });

  it("handles the DST transition days", () => {
    // Spring forward: Sun 2026-03-08 at 02:00 PST → 03:00 PDT.
    expect(new Date(laWallTimeToUtc("2026-03-08", 1 * 60)).toISOString()).toBe("2026-03-08T09:00:00.000Z");
    expect(new Date(laWallTimeToUtc("2026-03-08", 9 * 60)).toISOString()).toBe("2026-03-08T16:00:00.000Z");
    // Fall back: Sun 2026-11-01 at 02:00 PDT → 01:00 PST.
    expect(new Date(laWallTimeToUtc("2026-11-01", 0)).toISOString()).toBe("2026-11-01T07:00:00.000Z");
    expect(new Date(laWallTimeToUtc("2026-11-01", 9 * 60)).toISOString()).toBe("2026-11-01T17:00:00.000Z");
  });

  it("round-trips with laMinutesOfDay and laDateString", () => {
    const ms = laWallTimeToUtc("2026-11-01", 15 * 60 + 30);
    expect(laMinutesOfDay(ms)).toBe(15 * 60 + 30);
    expect(laDateString(new Date(ms))).toBe("2026-11-01");
  });

  it("computes weekdays and day spans", () => {
    expect(weekdayOf("2026-10-13")).toBe(2); // Tuesday
    expect(daysBetween("2026-10-13", "2026-11-02")).toBe(20);
  });
});
