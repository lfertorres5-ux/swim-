import { describe, expect, it } from "vitest";
import { laWallTimeToUtc } from "@/lib/time";
import { certState } from "./certs";
import { netRevenue, utilization, zoneHeatmap } from "./metrics";

// 2026-10-19 is a Monday.
const rule = (instructorId: string, weekday: number, startTime: string, endTime: string) => ({ instructorId, weekday, startTime, endTime, effectiveFrom: "2026-01-01", effectiveUntil: null });
const at = (date: string, hh: number, mm = 0) => laWallTimeToUtc(date, hh * 60 + mm);

describe("utilization", () => {
  it("booked ÷ available minutes across the range, honoring blackouts", () => {
    const rules = [rule("maya", 1, "09:00", "13:00"), rule("maya", 2, "09:00", "13:00")]; // Mon + Tue, 4 h each
    const overrides = [{ instructorId: "maya", date: "2026-10-20", kind: "blackout" as const, startTime: null, endTime: null }];
    const booked = [{ instructorId: "maya", start: at("2026-10-19", 9), end: at("2026-10-19", 11) }];
    const [u] = utilization(["maya"], rules, overrides, booked, "2026-10-19", "2026-10-25");
    expect(u).toEqual({ instructorId: "maya", availableMinutes: 240, bookedMinutes: 120, pct: 50 });
  });

  it("counts only the part of a lesson inside the range, caps at 100%, and reports no hours as null", () => {
    const rules = [rule("jo", 1, "09:00", "10:00")];
    const booked = [
      { instructorId: "jo", start: at("2026-10-18", 23, 30), end: at("2026-10-19", 0, 30) }, // 30 min falls on the 19th
      { instructorId: "jo", start: at("2026-10-19", 9), end: at("2026-10-19", 11) },
    ];
    const [jo, sam] = utilization(["jo", "sam"], rules, [], booked, "2026-10-19", "2026-10-19");
    expect(jo.bookedMinutes).toBe(150);
    expect(jo.pct).toBe(100);
    expect(sam).toEqual({ instructorId: "sam", availableMinutes: 0, bookedMinutes: 0, pct: null });
  });
});

describe("zone heatmap", () => {
  it("counts lessons per zone per local weekday with relative intensity", () => {
    const grid = zoneHeatmap(
      [
        { zoneId: "A", startsAt: "2026-10-20T01:00:00Z" }, // Mon 6 PM in San Diego (Tue in UTC)
        { zoneId: "A", startsAt: "2026-10-19T17:00:00Z" }, // Mon 10 AM
        { zoneId: "B", startsAt: "2026-10-24T17:00:00Z" }, // Sat
        { zoneId: "Z", startsAt: "2026-10-24T17:00:00Z" }, // unknown zone ignored
      ],
      ["A", "B"],
    );
    expect(grid.A[1]).toEqual({ count: 2, intensity: 1 });
    expect(grid.A[2].count).toBe(0);
    expect(grid.B[6]).toEqual({ count: 1, intensity: 0.5 });
    expect(Object.keys(grid)).toEqual(["A", "B"]);
  });
});

describe("net revenue", () => {
  it("collected minus refunds, ignoring unpaid and void payments", () => {
    expect(
      netRevenue([
        { amount_cents: 9000, refunded_cents: 0, status: "succeeded" },
        { amount_cents: 6500, refunded_cents: 3250, status: "partially_refunded" },
        { amount_cents: 6500, refunded_cents: 6500, status: "refunded" },
        { amount_cents: 13000, refunded_cents: 0, status: "pending" },
        { amount_cents: 13000, refunded_cents: 0, status: "cancelled" },
      ]),
    ).toEqual({ grossCents: 22000, refundsCents: 9750, netCents: 12250 });
  });
});

describe("certification state", () => {
  it("flags expired, expiring within 30 days, fine, and no-expiry", () => {
    expect(certState("2026-10-15", "2026-10-16")).toEqual({ state: "expired", days: -1 });
    expect(certState("2026-10-16", "2026-10-16")).toEqual({ state: "expiring", days: 0 });
    expect(certState("2026-11-15", "2026-10-16")).toEqual({ state: "expiring", days: 30 });
    expect(certState("2026-11-16", "2026-10-16").state).toBe("ok");
    expect(certState(null, "2026-10-16")).toEqual({ state: "no_expiry", days: null });
  });
});
