/**
 * Pricing engine — pure functions; every number comes from admin config.
 *
 * Per lesson:
 *   base (by length, covers `includedChildren` swimmers)
 * + extra swimmers × extraChildCents
 * + zone travel fee
 * − neighborhood discount (single lessons only, slot adjacent to a same-zone lesson)
 * − plan discount (package or weekly-series %, applied to the lesson price, not the travel fee)
 * Promo codes apply last, to the order total, if the code covers the plan kind.
 */

export type PricingConfig = {
  currency: string;
  includedChildren: number;
  extraChildCents: number;
  recurringDiscountPct: number;
  neighborhoodDiscountCents: number;
};

export type LessonPrice = { durationMinutes: number; priceCents: number };
export type PackageOffering = { id: string; name: string; lessonCount: number; discountPct: number; validityDays: number };
export type ZonePricing = { id: string; code: string; name?: string; travelFeeCents: number; minBookingMinutes: number; isBookable: boolean };
export type PromoCode = {
  id: string;
  code: string;
  percentOff: number | null;
  amountOffCents: number | null;
  appliesTo: PlanKind[];
};

export type PlanKind = "single" | "package" | "recurring";

export type Plan =
  | { kind: "single" }
  | { kind: "package"; offering: PackageOffering }
  | { kind: "recurring"; weeks: number }
  /** A lesson booked with a credit from a package already paid for. */
  | { kind: "package_credit" };

export type Catalog = { config: PricingConfig; prices: LessonPrice[]; offerings: PackageOffering[] };

export type LessonBreakdown = {
  baseCents: number;
  extraChildrenCents: number;
  travelFeeCents: number;
  neighborhoodDiscountCents: number;
  planDiscountCents: number;
  totalCents: number;
};

export type Quote = {
  kind: Plan["kind"];
  lessonCount: number;
  perLesson: LessonBreakdown;
  subtotalCents: number;
  promoDiscountCents: number;
  /** Promo discount spread across lessons (sums to promoDiscountCents) — used for per-lesson refunds. */
  promoPerLessonCents: number[];
  totalCents: number;
  currency: string;
  lines: { label: string; cents: number }[];
};

export type PricingErrorCode = "unsupported_duration" | "below_zone_minimum" | "zone_not_bookable" | "invalid_children" | "invalid_plan";

export class PricingError extends Error {
  constructor(
    readonly code: PricingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PricingError";
  }
}

const dollars = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;
const pct = (amount: number, percent: number) => Math.round((amount * percent) / 100);

export function quoteLesson(
  input: { durationMinutes: number; childrenCount: number; zone: ZonePricing; isNeighborhoodSlot?: boolean; plan: Plan; promo?: PromoCode | null },
  catalog: Catalog,
): Quote {
  const { config } = catalog;
  const { zone, durationMinutes, childrenCount, plan } = input;

  if (!zone.isBookable) throw new PricingError("zone_not_bookable", `Zone ${zone.code} isn't bookable`);
  if (durationMinutes < zone.minBookingMinutes) {
    throw new PricingError("below_zone_minimum", `Zone ${zone.code} requires at least ${zone.minBookingMinutes} minutes`);
  }
  const price = catalog.prices.find((p) => p.durationMinutes === durationMinutes);
  if (!price) throw new PricingError("unsupported_duration", `${durationMinutes}-minute lessons aren't offered`);
  if (!Number.isInteger(childrenCount) || childrenCount < 1) throw new PricingError("invalid_children", "At least one swimmer is required");

  const baseCents = price.priceCents;
  const extraChildren = Math.max(0, childrenCount - config.includedChildren);
  const extraChildrenCents = extraChildren * config.extraChildCents;
  const travelFeeCents = zone.travelFeeCents;
  const lessonCents = baseCents + extraChildrenCents;

  let lessonCount = 1;
  let planDiscountCents = 0;
  let planLabel: string | null = null;
  switch (plan.kind) {
    case "single":
      break;
    case "package":
      if (!catalog.offerings.some((o) => o.id === plan.offering.id)) throw new PricingError("invalid_plan", "Unknown package");
      lessonCount = plan.offering.lessonCount;
      planDiscountCents = pct(lessonCents, plan.offering.discountPct);
      planLabel = `${plan.offering.name} (${plan.offering.discountPct}% off)`;
      break;
    case "recurring":
      if (!Number.isInteger(plan.weeks) || plan.weeks < 2) throw new PricingError("invalid_plan", "A weekly series needs at least 2 weeks");
      lessonCount = plan.weeks;
      planDiscountCents = pct(lessonCents, config.recurringDiscountPct);
      planLabel = `Weekly series (${config.recurringDiscountPct}% off)`;
      break;
    case "package_credit":
      break;
  }

  const neighborhoodDiscountCents =
    plan.kind === "single" && input.isNeighborhoodSlot ? Math.min(config.neighborhoodDiscountCents, lessonCents + travelFeeCents) : 0;

  const perLessonTotal = plan.kind === "package_credit" ? 0 : lessonCents + travelFeeCents - neighborhoodDiscountCents - planDiscountCents;
  const perLesson: LessonBreakdown = {
    baseCents,
    extraChildrenCents,
    travelFeeCents,
    neighborhoodDiscountCents,
    planDiscountCents,
    totalCents: perLessonTotal,
  };
  const subtotalCents = perLessonTotal * lessonCount;

  let promoDiscountCents = 0;
  const promoKind: PlanKind | null = plan.kind === "package_credit" ? null : plan.kind;
  if (input.promo && promoKind && input.promo.appliesTo.includes(promoKind)) {
    promoDiscountCents = input.promo.percentOff
      ? pct(subtotalCents, input.promo.percentOff)
      : Math.min(input.promo.amountOffCents ?? 0, subtotalCents);
  }

  const n = lessonCount;
  const lines: Quote["lines"] = [];
  if (plan.kind !== "package_credit") {
    const each = n > 1 ? ` × ${n}` : "";
    lines.push({ label: `${durationMinutes}-minute lesson (up to ${config.includedChildren} swimmers)${each}`, cents: baseCents * n });
    if (extraChildrenCents) lines.push({ label: `${extraChildren} additional swimmer${extraChildren > 1 ? "s" : ""} (${dollars(config.extraChildCents)} each)${each}`, cents: extraChildrenCents * n });
    if (travelFeeCents) lines.push({ label: `Zone ${zone.code} travel fee${each}`, cents: travelFeeCents * n });
    if (neighborhoodDiscountCents) lines.push({ label: "Neighborhood slot discount", cents: -neighborhoodDiscountCents });
    if (planDiscountCents && planLabel) lines.push({ label: planLabel, cents: -planDiscountCents * n });
    if (promoDiscountCents) lines.push({ label: `Promo ${input.promo!.code}`, cents: -promoDiscountCents });
  } else {
    lines.push({ label: "Paid with a package credit", cents: 0 });
  }

  return {
    kind: plan.kind,
    lessonCount: n,
    perLesson,
    subtotalCents,
    promoDiscountCents,
    promoPerLessonCents: allocate(promoDiscountCents, n),
    totalCents: subtotalCents - promoDiscountCents,
    currency: config.currency,
    lines,
  };
}

/** Split `total` cents into `n` integer parts that sum exactly to `total`. */
export function allocate(total: number, n: number): number[] {
  const base = Math.floor(total / n);
  const remainder = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < remainder ? 1 : 0));
}

export function formatMoney(cents: number, currency = "usd"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
}
