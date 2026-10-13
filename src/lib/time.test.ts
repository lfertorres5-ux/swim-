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
