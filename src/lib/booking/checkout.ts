import "server-only";
import { z } from "zod";
import { siteUrl } from "@/lib/env";
import { paymentsGateway } from "@/lib/payments/gateway";
import { createTruemedSession, truemedConfigured } from "@/lib/payments/truemed";
import { loadCatalog, lookupPromo } from "@/lib/pricing/catalog";
import { PricingError, quoteLesson, type Plan, type PlanKind, type Quote } from "@/lib/pricing/quote";
import { ageInMonths } from "@/lib/scheduling/engine";
import { notifyBookingReceived, safely } from "@/lib/notifications/events";
import { openBookingRequest } from "@/lib/scheduling/offers";
import { schedulerForInstant } from "@/lib/scheduling/service";
import { SchedulingError, type SwimLevel } from "@/lib/scheduling/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { addDays, formatDateTime, laDateString, laMinutesOfDay, laWallTimeToUtc, formatTimeOfDay, weekdayOf } from "@/lib/time";
import { addressInputSchema, verifyAddress } from "./address";

export const planSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("single") }),
  z.object({ kind: z.literal("package"), offeringId: z.guid() }),
  z.object({ kind: z.literal("recurring"), weeks: z.number().int().min(2).max(26) }),
  z.object({ kind: z.literal("package_credit"), packageId: z.guid() }),
]);

export const checkoutInputSchema = z.object({
  address: addressInputSchema,
  saveAsHome: z.boolean().optional(),
  durationMinutes: z.number().int().positive(),
  childIds: z.array(z.guid()).min(1).max(10),
  instructorId: z.guid().nullable(),
  plan: planSchema,
  start: z.iso.datetime({ offset: true }),
  promoCode: z.string().max(40).optional(),
  /** "hsa_fsa" pays through Truemed (only when enabled); everything else is a card via Stripe. */
  paymentMethod: z.enum(["card", "hsa_fsa"]).optional(),
});
export type CheckoutInput = z.infer<typeof checkoutInputSchema>;

export class BookingError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "BookingError";
  }
}

export type CheckoutResult =
  | { kind: "redirect"; url: string; paymentId: string; bookingIds: string[] }
  | { kind: "confirmed"; url: string; bookingIds: string[] };

const SLOT_TAKEN = new Set(["23P01", "SB001"]);

/**
 * Turn a parent's selection into held bookings + a Stripe Checkout session.
 * Everything the client sent is re-derived or re-checked here: zone (from the
 * address), swimmers (must be theirs), slot availability and instructor
 * (scheduling engine), and the price (pricing engine).
 */
export async function createBookingCheckout(parentId: string, raw: CheckoutInput, now = Date.now()): Promise<CheckoutResult> {
  const input = checkoutInputSchema.parse(raw);
  const admin = createAdminClient();

  // Address → zone (server-side only).
  const check = await verifyAddress(input.address);
  if (!check.ok) throw new BookingError(check.reason, check.message);
  const address = check.address;

  // Family + swimmers.
  const [{ data: user }, { data: parent }, { data: children }] = await Promise.all([
    admin.from("users").select("email, first_name, last_name, role").eq("id", parentId).single(),
    admin.from("parents").select("stripe_customer_id, favorite_instructor_id").eq("id", parentId).single(),
    admin.from("children").select("id, birth_date, swim_level").eq("parent_id", parentId).eq("is_active", true).in("id", input.childIds),
  ]);
  if (!user || user.role !== "parent" || !parent) throw new BookingError("not_parent", "Only family accounts can book lessons.");
  if (!children || children.length !== new Set(input.childIds).size) throw new BookingError("invalid_swimmers", "Please choose your swimmers again.");

  const start = Date.parse(input.start);
  const lessonDate = laDateString(new Date(start));
  const startMinutes = laMinutesOfDay(start);
  const swimmers = children.map((c) => ({ ageMonths: c.birth_date ? ageInMonths(c.birth_date, lessonDate) : null, level: c.swim_level as SwimLevel }));
  const weeks = input.plan.kind === "recurring" ? input.plan.weeks : 1;

  // Plan (validated before the slot so credit/package errors are specific).
  const catalog = await loadCatalog();
  let plan: Plan;
  let creditPackage: { id: string } | null = null;
  switch (input.plan.kind) {
    case "single":
      plan = { kind: "single" };
      break;
    case "recurring":
      plan = { kind: "recurring", weeks };
      break;
    case "package": {
      const planId = input.plan.offeringId;
      const offering = catalog.offerings.find((o) => o.id === planId);
      if (!offering) throw new BookingError("invalid_plan", "That package isn't available.");
      plan = { kind: "package", offering };
      break;
    }
    case "package_credit": {
      const { data: pkg } = await admin
        .from("packages")
        .select("id, status, lessons_remaining, duration_minutes, children_count, zone_id, expires_at")
        .eq("id", input.plan.packageId)
        .eq("parent_id", parentId)
        .maybeSingle();
      const usable =
        pkg && pkg.status === "active" && pkg.lessons_remaining > 0 && (!pkg.expires_at || Date.parse(pkg.expires_at) > now) &&
        pkg.duration_minutes === input.durationMinutes && pkg.children_count === children.length && (!pkg.zone_id || pkg.zone_id === address.zone.id);
      if (!usable) throw new BookingError("invalid_credit", "That package can't be used for this lesson (length, swimmers or area differ, or no credits left).");
      plan = { kind: "package_credit" };
      creditPackage = { id: pkg.id };
      break;
    }
  }
  // Slot + instructor.
  const { scheduler, data } = await schedulerForInstant(start, now, { weeks });
  if (start < now + data.settings.minNoticeHours * 3_600_000) throw new BookingError("too_soon", `Lessons must be booked at least ${data.settings.minNoticeHours} hours ahead.`);
  let ranked;
  try {
    ranked = scheduler.rankInstructorsForSlot({
      zoneId: address.zone.id,
      durationMinutes: input.durationMinutes,
      swimmers,
      start,
      instructorId: input.instructorId,
      favoriteInstructorId: input.instructorId ?? parent.favorite_instructor_id,
    });
  } catch (err) {
    if (err instanceof SchedulingError) throw new BookingError(err.code, err.message);
    throw err;
  }
  const occurrenceDates = Array.from({ length: weeks }, (_, k) => addDays(lessonDate, 7 * k));
  ranked = ranked.filter((c) => occurrenceDates.slice(1).every((d) => scheduler.isFree(c.instructorId, d, startMinutes, input.durationMinutes, address.zone.id)));
  const chosen = ranked[0];
  if (!chosen) throw new BookingError("slot_unavailable", "Sorry — that time was just taken. Please pick another.");

  // Price.
  const promoKind: PlanKind | null = plan.kind === "package_credit" ? null : plan.kind;
  let promo = null;
  if (input.promoCode && promoKind) {
    const found = await lookupPromo(input.promoCode, promoKind, now);
    if (!found.ok) throw new BookingError("invalid_promo", found.message);
    promo = found.promo;
  }

  let quote: Quote;
  try {
    quote = quoteLesson(
      {
        durationMinutes: input.durationMinutes,
        childrenCount: children.length,
        zone: { ...address.zone, isBookable: true },
        isNeighborhoodSlot: chosen.isNeighborhoodSlot,
        plan,
        promo,
      },
      catalog,
    );
  } catch (err) {
    if (err instanceof PricingError) throw new BookingError(err.code, err.message);
    throw err;
  }

  // Lessons to hold. A package books its first lesson now; the series books every week.
  const occurrences = (input.plan.kind === "recurring" ? occurrenceDates : [lessonDate]).map((date, i) => {
    const s = laWallTimeToUtc(date, startMinutes);
    const promoShare = quote.promoPerLessonCents[i] ?? 0;
    const per = quote.perLesson;
    const lessonTotal = input.plan.kind === "package" ? Math.round(quote.totalCents / quote.lessonCount) : per.totalCents - promoShare;
    return {
      starts_at: new Date(s).toISOString(),
      ends_at: new Date(s + input.durationMinutes * 60_000).toISOString(),
      is_neighborhood_slot: per.neighborhoodDiscountCents > 0,
      pricing: {
        base_cents: per.baseCents,
        extra_children_cents: per.extraChildrenCents,
        travel_fee_cents: per.travelFeeCents,
        neighborhood_discount_cents: per.neighborhoodDiscountCents,
        package_discount_cents: plan.kind === "package" ? per.planDiscountCents : 0,
        series_discount_cents: plan.kind === "recurring" ? per.planDiscountCents : 0,
        promo_discount_cents: input.plan.kind === "package" ? 0 : promoShare,
        total_cents: plan.kind === "package_credit" ? 0 : lessonTotal,
      },
    };
  });

  const title = describeOrder(quote, input.durationMinutes, children.length, start, address.zone.code);
  const { data: hold, error: holdError } = await admin.rpc("create_booking_hold", {
    p: {
      parent_id: parentId,
      kind: input.plan.kind,
      instructor_id: chosen.instructorId,
      requested_instructor_id: input.instructorId,
      zone_id: address.zone.id,
      neighborhood: address.neighborhood,
      child_ids: input.childIds,
      location: {
        address_line1: address.line1,
        address_line2: address.line2,
        city: address.city,
        postal_code: address.postalCode,
        lat: address.lat,
        lng: address.lng,
        google_place_id: address.placeId,
        access_notes: address.accessNotes,
      },
      occurrences,
      amount_cents: quote.totalCents,
      currency: quote.currency,
      description: title,
      discount_code_id: promo?.id ?? null,
      pricing_snapshot: { config: catalog.config, quote: { lines: quote.lines, totalCents: quote.totalCents, kind: quote.kind } },
      package:
        plan.kind === "package"
          ? {
              offering_id: plan.offering.id,
              lesson_count: plan.offering.lessonCount,
              duration_minutes: input.durationMinutes,
              unit_price_cents: quote.perLesson.totalCents,
              discount_pct: plan.offering.discountPct,
              total_cents: quote.totalCents,
            }
          : undefined,
      series:
        plan.kind === "recurring"
          ? {
              weekday: weekdayOf(lessonDate),
              start_time: formatTimeOfDay(startMinutes),
              duration_minutes: input.durationMinutes,
              starts_on: lessonDate,
              ends_on: occurrenceDates[occurrenceDates.length - 1],
              discount_pct: catalog.config.recurringDiscountPct,
            }
          : undefined,
      package_id: creditPackage?.id,
    },
  });
  if (holdError) {
    if (SLOT_TAKEN.has(holdError.code)) throw new BookingError("slot_unavailable", "Sorry — that time was just taken. Please pick another.");
    if (holdError.code === "SB004") throw new BookingError("invalid_credit", "No package credits left.");
    throw new Error(`create_booking_hold failed: ${holdError.message}`);
  }
  const { payment_id: paymentId, booking_ids: bookingIds } = hold as { payment_id: string | null; booking_ids: string[] };

  if (input.saveAsHome) {
    await admin
      .from("parents")
      .update({
        address_line1: address.line1,
        address_line2: address.line2,
        city: address.city,
        postal_code: address.postalCode,
        lat: address.lat,
        lng: address.lng,
        google_place_id: address.placeId,
        zone_id: address.zone.id,
        neighborhood: address.neighborhood,
        access_notes: address.accessNotes,
      })
      .eq("id", parentId);
  }

  await admin.from("audit_log").insert({
    actor_id: parentId,
    actor_role: "parent",
    action: "parent.booking_checkout",
    entity_type: "payment",
    entity_id: paymentId,
    booking_id: bookingIds[0],
    metadata: { kind: input.plan.kind, booking_ids: bookingIds, total_cents: quote.totalCents, instructor_id: chosen.instructorId },
  });

  // Nothing to pay (package credit or 100% promo): confirm right away.
  if (!paymentId) {
    for (const id of bookingIds) await openBookingRequest(id, now);
    await safely("booking received", () => notifyBookingReceived(bookingIds));
    return { kind: "confirmed", url: `/parent/bookings/confirmed?booking=${bookingIds[0]}`, bookingIds };
  }

  // HSA/FSA through Truemed (hosted checkout; fulfilled by Truemed's webhook).
  if (input.paymentMethod === "hsa_fsa") {
    if (!(await hsaFsaAvailable())) {
      await admin.rpc("release_booking_hold", { p_payment_id: paymentId });
      throw new BookingError("hsa_fsa_unavailable", "HSA/FSA payment isn't available right now. Please pay by card.");
    }
    try {
      const session = await createTruemedSession({
        paymentId,
        amountCents: quote.totalCents,
        items: [{ id: paymentId, name: title, amountCents: quote.totalCents, quantity: 1 }],
        customerEmail: user.email,
        customerName: [user.first_name, user.last_name].filter(Boolean).join(" ") || null,
        successUrl: `${siteUrl()}/parent/bookings/confirmed?payment=${paymentId}`,
        failureUrl: `${siteUrl()}/book/cancelled?payment=${paymentId}`,
      });
      // The eligibility survey takes a few minutes longer than card checkout.
      const holdUntil = new Date(now + Math.max(60, data.settings.paymentHoldMinutes) * 60_000).toISOString();
      await Promise.all([
        admin.from("payments").update({ processor: "truemed", processor_session_id: session.sessionId }).eq("id", paymentId),
        admin.from("bookings").update({ hold_expires_at: holdUntil }).eq("payment_id", paymentId).eq("status", "pending_payment"),
      ]);
      return { kind: "redirect", url: session.url, paymentId, bookingIds };
    } catch (err) {
      await admin.rpc("release_booking_hold", { p_payment_id: paymentId });
      if (err instanceof BookingError) throw err;
      console.error("Truemed checkout failed", err);
      throw new BookingError("hsa_fsa_unavailable", "We couldn't start HSA/FSA checkout. Please try again or pay by card.");
    }
  }

  // Stripe Checkout.
  const gateway = paymentsGateway();
  try {
    const customerId = await gateway.ensureCustomer({
      parentId,
      email: user.email,
      name: [user.first_name, user.last_name].filter(Boolean).join(" ") || null,
      existingCustomerId: parent.stripe_customer_id,
    });
    if (customerId !== parent.stripe_customer_id) await admin.from("parents").update({ stripe_customer_id: customerId }).eq("id", parentId);

    const holdMinutes = Math.max(31, data.settings.paymentHoldMinutes) - 1;
    const session = await gateway.createCheckout({
      paymentId,
      customerId,
      title,
      description: quote.lines.map((l) => `${l.label}: ${(l.cents / 100).toFixed(2)}`).join(" · "),
      amountCents: quote.totalCents,
      currency: quote.currency,
      successUrl: `${siteUrl()}/parent/bookings/confirmed?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${siteUrl()}/book/cancelled?payment=${paymentId}`,
      expiresAt: new Date(now + holdMinutes * 60_000),
    });
    await admin.from("payments").update({ stripe_checkout_session_id: session.sessionId }).eq("id", paymentId);
    return { kind: "redirect", url: session.url, paymentId, bookingIds };
  } catch (err) {
    await admin.rpc("release_booking_hold", { p_payment_id: paymentId });
    throw err;
  }
}

/** HSA/FSA checkout is offered when Truemed is configured and the owner has switched it on. */
export async function hsaFsaAvailable(): Promise<boolean> {
  if (!truemedConfigured()) return false;
  const { data } = await createAdminClient().from("platform_settings").select("hsa_fsa_enabled").single();
  return Boolean(data?.hsa_fsa_enabled);
}

function describeOrder(quote: Quote, duration: number, swimmers: number, start: number, zone: string) {
  const who = `${swimmers} swimmer${swimmers > 1 ? "s" : ""}`;
  const when = formatDateTime(new Date(start));
  switch (quote.kind) {
    case "package":
      return `${quote.lessonCount}-lesson package · ${duration} min · ${who} · first lesson ${when}`;
    case "recurring":
      return `Weekly swim lessons × ${quote.lessonCount} · ${duration} min · ${who} · starting ${when}`;
    default:
      return `Swim lesson · ${duration} min · ${who} · ${when} · Zone ${zone}`;
  }
}

/**
 * Stripe says the Checkout Session was paid. Idempotent: the first caller flips
 * the payment to succeeded; later deliveries are no-ops.
 */
export async function fulfillPayment(checkout: { paymentId: string; sessionId: string; paymentIntentId: string | null; amountTotal: number | null; receiptUrl: string | null; chargeId: string | null }, now = Date.now()) {
  const admin = createAdminClient();
  const { data: payment, error: updateError } = await admin
    .from("payments")
    .update({
      status: "succeeded",
      stripe_checkout_session_id: checkout.sessionId,
      stripe_payment_intent_id: checkout.paymentIntentId,
      stripe_charge_id: checkout.chargeId,
      receipt_url: checkout.receiptUrl,
    })
    .eq("id", checkout.paymentId)
    .eq("status", "pending")
    .select("id, parent_id, amount_cents, package_id, series_id")
    .maybeSingle();
  // Never treat a failed write as "already fulfilled" — throw so Stripe retries.
  if (updateError) throw new Error(`fulfillPayment: could not update payment ${checkout.paymentId}: ${updateError.message}`);

  if (!payment) {
    // Already fulfilled — or the hold expired and was released before payment
    // arrived (rare: the session outlived the hold). Flag the latter for admin.
    const { data: existing } = await admin.from("payments").select("status").eq("id", checkout.paymentId).maybeSingle();
    if (existing?.status === "cancelled") {
      await admin.from("audit_log").insert({
        action: "system.payment_after_release",
        entity_type: "payment",
        entity_id: checkout.paymentId,
        metadata: { session_id: checkout.sessionId, note: "Paid after the hold was released — refund or rebook manually." },
      });
    }
    return { fulfilled: false as const };
  }

  if (checkout.amountTotal !== null && checkout.amountTotal !== payment.amount_cents) {
    await admin.from("audit_log").insert({
      action: "system.payment_amount_mismatch",
      entity_type: "payment",
      entity_id: payment.id,
      metadata: { expected: payment.amount_cents, received: checkout.amountTotal },
    });
  }

  if (payment.package_id) {
    const { data: pkg } = await admin.from("packages").select("offering:package_offerings(validity_days)").eq("id", payment.package_id).single();
    const offering = Array.isArray(pkg?.offering) ? pkg?.offering[0] : pkg?.offering;
    const validity = offering?.validity_days ?? 180;
    await admin
      .from("packages")
      .update({ status: "active", purchased_at: new Date(now).toISOString(), expires_at: new Date(now + validity * 86_400_000).toISOString() })
      .eq("id", payment.package_id);
  }
  if (payment.series_id) await admin.from("booking_series").update({ status: "active" }).eq("id", payment.series_id);

  const { data: bookings } = await admin
    .from("bookings")
    .select("id, booking_pricing(discount_code_id)")
    .or(payment.package_id ? `payment_id.eq.${payment.id},package_id.eq.${payment.package_id}` : `payment_id.eq.${payment.id}`)
    .eq("status", "pending_payment");

  const codeId = bookings?.flatMap((b) => (Array.isArray(b.booking_pricing) ? b.booking_pricing : [b.booking_pricing])).find((p) => p?.discount_code_id)?.discount_code_id;
  if (codeId) await admin.rpc("redeem_discount_code", { p_code_id: codeId });

  for (const b of bookings ?? []) await openBookingRequest(b.id, now);
  await safely("booking received", () => notifyBookingReceived((bookings ?? []).map((b) => b.id as string)));

  await admin.from("audit_log").insert({
    actor_id: payment.parent_id,
    actor_role: "parent",
    action: "payment.succeeded",
    entity_type: "payment",
    entity_id: payment.id,
    metadata: { amount_cents: payment.amount_cents, booking_ids: (bookings ?? []).map((b) => b.id) },
  });
  // TODO(phase 6): booking.created webhook.
  return { fulfilled: true as const, bookingIds: (bookings ?? []).map((b) => b.id as string) };
}

/** Checkout abandoned / expired: free the held slots. */
export async function releaseCheckout(paymentId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("release_booking_hold", { p_payment_id: paymentId });
  if (error) throw new Error(error.message);
  return data as number;
}
