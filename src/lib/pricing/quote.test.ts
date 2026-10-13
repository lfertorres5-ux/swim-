import { describe, expect, it } from "vitest";
import { allocate, PricingError, quoteLesson, type Catalog, type ZonePricing } from "./quote";

// The spec's defaults (all editable in admin).
const catalog: Catalog = {
  config: { currency: "usd", includedChildren: 2, extraChildCents: 2500, recurringDiscountPct: 10, neighborhoodDiscountCents: 500 },
  prices: [
    { durationMinutes: 30, priceCents: 6500 },
    { durationMinutes: 60, priceCents: 9000 },
    { durationMinutes: 90, priceCents: 13000 },
  ],
  offerings: [
    { id: "p6", name: "6-Lesson Package", lessonCount: 6, discountPct: 5, validityDays: 150 },
    { id: "p8", name: "8-Lesson Package", lessonCount: 8, discountPct: 10, validityDays: 180 },
    { id: "p14", name: "14-Lesson Package", lessonCount: 14, discountPct: 15, validityDays: 270 },
  ],
};
const A: ZonePricing = { id: "a", code: "A", travelFeeCents: 0, minBookingMinutes: 0, isBookable: true };
const B: ZonePricing = { id: "b", code: "B", travelFeeCents: 1000, minBookingMinutes: 0, isBookable: true };
const C: ZonePricing = { id: "c", code: "C", travelFeeCents: 2000, minBookingMinutes: 60, isBookable: true };
const single = { kind: "single" as const };

const total = (over: Partial<Parameters<typeof quoteLesson>[0]>) =>
  quoteLesson({ durationMinutes: 60, childrenCount: 1, zone: A, plan: single, ...over }, catalog).totalCents;

describe("base prices (1–2 kids)", () => {
  it.each([
    [30, 6500],
    [60, 9000],
    [90, 13000],
  ])("%i min → %i cents", (durationMinutes, cents) => {
    expect(total({ durationMinutes, childrenCount: 1 })).toBe(cents);
    expect(total({ durationMinutes, childrenCount: 2 })).toBe(cents);
  });
});

describe("group pricing", () => {
  it("adds $25 per lesson for each child beyond 2", () => {
    expect(total({ childrenCount: 3 })).toBe(11500);
    expect(total({ childrenCount: 5 })).toBe(16500);
  });
});

describe("travel zones", () => {
  it("Zone A no fee, Zone B +$10, Zone C +$20", () => {
    expect(total({ zone: A })).toBe(9000);
    expect(total({ zone: B })).toBe(10000);
    expect(total({ zone: C })).toBe(11000);
  });

  it("Zone C requires at least 60 minutes", () => {
    expect(() => total({ zone: C, durationMinutes: 30 })).toThrowError(PricingError);
    expect(total({ zone: C, durationMinutes: 90 })).toBe(15000);
  });

  it("outside-zone / non-bookable is not priced", () => {
    expect(() => total({ zone: { ...A, isBookable: false } })).toThrow(/isn't bookable/);
  });
});

describe("neighborhood slot discount", () => {
  it("takes $5 off a single lesson", () => {
    expect(total({ isNeighborhoodSlot: true })).toBe(8500);
    expect(total({ isNeighborhoodSlot: true, zone: B, childrenCount: 3 })).toBe(12000);
  });

  it("doesn't stack with package or series pricing", () => {
    const q = quoteLesson({ durationMinutes: 60, childrenCount: 1, zone: A, isNeighborhoodSlot: true, plan: { kind: "recurring", weeks: 4 } }, catalog);
    expect(q.perLesson.neighborhoodDiscountCents).toBe(0);
  });
});

describe("packages and recurring series", () => {
  it("6-pack is 5% off, 8-pack 10% off, 14-pack 15% off", () => {
    const q = (i: number) => quoteLesson({ durationMinutes: 60, childrenCount: 1, zone: A, plan: { kind: "package", offering: catalog.offerings[i] } }, catalog);
    expect(q(0)).toMatchObject({ lessonCount: 6, totalCents: 6 * 8550 });
    expect(q(1).totalCents).toBe(64800);
    expect(q(2)).toMatchObject({ lessonCount: 14, totalCents: 14 * 7650 });
  });

  it("weekly series is 10% off the lesson price; travel fee isn't discounted", () => {
    const q = quoteLesson({ durationMinutes: 30, childrenCount: 2, zone: B, plan: { kind: "recurring", weeks: 4 } }, catalog);
    expect(q.perLesson).toMatchObject({ planDiscountCents: 650, travelFeeCents: 1000, totalCents: 6500 - 650 + 1000 });
    expect(q.totalCents).toBe(4 * 6850);
  });

  it("package credits cost nothing at booking time", () => {
    expect(total({ plan: { kind: "package_credit" } })).toBe(0);
  });
});

describe("promo codes", () => {
  const pct10 = { id: "x", code: "WELCOME10", percentOff: 10, amountOffCents: null, appliesTo: ["single" as const] };
  const off20 = { id: "y", code: "TWENTY", percentOff: null, amountOffCents: 2000, appliesTo: ["single" as const, "package" as const, "recurring" as const] };

  it("applies after other discounts", () => {
    expect(total({ promo: pct10, isNeighborhoodSlot: true })).toBe(8500 - 850);
    expect(total({ promo: off20 })).toBe(7000);
  });

  it("only applies to the plan kinds it covers", () => {
    const q = quoteLesson({ durationMinutes: 60, childrenCount: 1, zone: A, plan: { kind: "recurring", weeks: 4 }, promo: pct10 }, catalog);
    expect(q.promoDiscountCents).toBe(0);
  });

  it("never goes negative and spreads across lessons for refunds", () => {
    expect(total({ promo: { ...off20, amountOffCents: 999999 } })).toBe(0);
    const q = quoteLesson({ durationMinutes: 60, childrenCount: 1, zone: A, plan: { kind: "recurring", weeks: 3 }, promo: off20 }, catalog);
    expect(q.promoPerLessonCents).toEqual([667, 667, 666]);
    expect(q.promoPerLessonCents.reduce((a, b) => a + b, 0)).toBe(2000);
  });
});

describe("quote lines", () => {
  it("itemize the order and sum to the total", () => {
    const q = quoteLesson({ durationMinutes: 60, childrenCount: 3, zone: B, isNeighborhoodSlot: true, plan: single, promo: null }, catalog);
    expect(q.lines.reduce((sum, l) => sum + l.cents, 0)).toBe(q.totalCents);
    expect(q.lines.map((l) => l.label)).toEqual([
      "60-minute lesson (up to 2 swimmers)",
      "1 additional swimmer ($25 each)",
      "Zone B travel fee",
      "Neighborhood slot discount",
    ]);
  });
});

it("allocate splits exactly", () => {
  expect(allocate(10, 4)).toEqual([3, 3, 2, 2]);
  expect(allocate(0, 2)).toEqual([0, 0]);
});
