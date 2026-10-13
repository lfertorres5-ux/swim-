import { describe, expect, it } from "vitest";
import { canReschedule, cancellationOutcome } from "./policy";

const H = 3_600_000;
const now = Date.parse("2026-10-13T12:00:00Z");
const policy = { cancellationWindowHours: 24, lateCancelRefundPct: 0 };

describe("cancellation policy", () => {
  it("full refund at or beyond the window", () => {
    expect(cancellationOutcome({ startsAt: now + 24 * H, paidCents: 9000, paidWithCredit: false }, policy, now)).toEqual({ onTime: true, refundCents: 9000, restoreCredit: false });
  });

  it("late cancellations refund the configured percentage", () => {
    expect(cancellationOutcome({ startsAt: now + 23 * H, paidCents: 9000, paidWithCredit: false }, policy, now).refundCents).toBe(0);
    expect(cancellationOutcome({ startsAt: now + 2 * H, paidCents: 9000, paidWithCredit: false }, { ...policy, lateCancelRefundPct: 50 }, now).refundCents).toBe(4500);
  });

  it("package lessons get the credit back only when on time", () => {
    expect(cancellationOutcome({ startsAt: now + 48 * H, paidCents: 0, paidWithCredit: true }, policy, now).restoreCredit).toBe(true);
    expect(cancellationOutcome({ startsAt: now + 5 * H, paidCents: 0, paidWithCredit: true }, policy, now).restoreCredit).toBe(false);
  });

  it("window is configurable", () => {
    expect(canReschedule(now + 13 * H, { ...policy, cancellationWindowHours: 12 }, now)).toBe(true);
    expect(canReschedule(now + 13 * H, policy, now)).toBe(false);
  });
});
