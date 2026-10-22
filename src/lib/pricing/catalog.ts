import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Catalog, PlanKind, PromoCode } from "./quote";

export async function loadCatalog(): Promise<Catalog> {
  const admin = createAdminClient();
  const [{ data: config, error: e1 }, { data: prices, error: e2 }, { data: offerings, error: e3 }] = await Promise.all([
    admin.from("pricing_config").select("*").single(),
    admin.from("lesson_prices").select("duration_minutes, price_cents").eq("is_active", true).order("sort_order"),
    admin.from("package_offerings").select("id, name, lesson_count, discount_pct, validity_days").eq("is_active", true).order("sort_order"),
  ]);
  if (e1 || e2 || e3) throw new Error((e1 ?? e2 ?? e3)!.message);
  return {
    config: {
      currency: config.currency,
      includedChildren: config.included_children,
      extraChildCents: config.extra_child_cents,
      recurringDiscountPct: Number(config.recurring_discount_pct),
      neighborhoodDiscountCents: config.neighborhood_discount_cents,
    },
    prices: prices.map((p) => ({ durationMinutes: p.duration_minutes, priceCents: p.price_cents })),
    offerings: offerings.map((o) => ({ id: o.id, name: o.name, lessonCount: o.lesson_count, discountPct: Number(o.discount_pct), validityDays: o.validity_days })),
  };
}

/** Same alphabet the admin form allows when creating codes. */
export const PROMO_CODE_FORMAT = /^[A-Z0-9_-]{3,30}$/;

export type PromoLookup = { ok: true; promo: PromoCode } | { ok: false; message: string };

/** Validate a promo code server-side for a plan kind. */
export async function lookupPromo(code: string, kind: PlanKind, now = Date.now()): Promise<PromoLookup> {
  const normalized = code.trim().toUpperCase();
  if (!normalized) return { ok: false, message: "Enter a code" };
  const invalid = { ok: false as const, message: "That code isn't valid." };
  // Exact match only: codes are stored uppercase, and anything outside this
  // alphabet (e.g. % or _ wildcards) can never match a real code.
  if (!PROMO_CODE_FORMAT.test(normalized)) return invalid;
  const admin = createAdminClient();
  const { data } = await admin
    .from("discount_codes")
    .select("id, code, percent_off, amount_off_cents, applies_to, is_active, valid_from, valid_until, max_redemptions, redemptions")
    .eq("code", normalized)
    .maybeSingle();
  if (!data || !data.is_active) return invalid;
  if (data.valid_from && Date.parse(data.valid_from) > now) return invalid;
  if (data.valid_until && Date.parse(data.valid_until) < now) return { ok: false, message: "That code has expired." };
  if (data.max_redemptions !== null && data.redemptions >= data.max_redemptions) return { ok: false, message: "That code has been fully redeemed." };
  if (!(data.applies_to as string[]).includes(kind)) return { ok: false, message: "That code doesn't apply to this kind of booking." };
  return {
    ok: true,
    promo: {
      id: data.id,
      code: data.code,
      percentOff: data.percent_off === null ? null : Number(data.percent_off),
      amountOffCents: data.amount_off_cents,
      appliesTo: data.applies_to as PlanKind[],
    },
  };
}
