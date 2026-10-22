import "server-only";
import { z } from "zod";
import { addressInputSchema, verifyAddress } from "@/lib/booking/address";
import { BookingError } from "@/lib/booking/checkout";
import { resolvePaymentId } from "@/lib/booking/manage";
import { cancellationOutcome } from "@/lib/booking/policy";
import { notifyCancelled, notifyManualBooking, notifyPaymentRequest, notifyReassigned, safely } from "@/lib/notifications/events";
import { paymentsGateway } from "@/lib/payments/gateway";
import { refundPayment, RefundError } from "@/lib/payments/refunds";
import { loadCatalog } from "@/lib/pricing/catalog";
import { PricingError, quoteLesson } from "@/lib/pricing/quote";
import { createAdminClient } from "@/lib/supabase/admin";
import { siteUrl } from "@/lib/env";
import { formatDateTime } from "@/lib/time";
import { one } from "@/lib/utils";

/**
 * The owner's booking tools: refunds, cancellations, reassignments and manual
 * bookings. Callers are admin-only server actions; every change is written to
 * audit_log with the admin as actor. The database still enforces the hard
 * rules (no double booking, travel buffers unless overridden, San Diego County
 * addresses).
 */

const LIVE = ["pending_payment", "pending_instructor", "confirmed"];

async function audit(actorId: string, action: string, entityType: string, entityId: string, bookingId: string | null, metadata: Record<string, unknown>) {
  const admin = createAdminClient();
  await admin.from("audit_log").insert({ actor_id: actorId, actor_role: "admin", action, entity_type: entityType, entity_id: entityId, booking_id: bookingId, metadata });
}

/** Postgres scheduling errors → words the owner can act on. */
export function scheduleErrorMessage(err: { code?: string; message?: string } | null): string | null {
  if (!err) return null;
  if (err.code === "SB001") return "That instructor has another lesson too close to this time (travel buffer). Tick “ignore travel buffer” to book it anyway.";
  if (err.code === "23P01") return "That instructor already has a lesson at that time.";
  if (err.code === "23514" && /county|postal|zip/i.test(err.message ?? "")) return "That address isn't in San Diego County.";
  return err.message ?? "Something went wrong.";
}

// -----------------------------------------------------------------------------
// Refunds
// -----------------------------------------------------------------------------

export async function adminRefund(actorId: string, paymentId: string, amountCents: number, reason: string | null) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new BookingError("invalid_amount", "Enter an amount greater than $0.");
  const admin = createAdminClient();
  const { count } = await admin.from("audit_log").select("id", { count: "exact", head: true }).eq("action", "admin.refund").eq("entity_id", paymentId);
  try {
    // One idempotency key per refund attempt: a double-click (same count) refunds once.
    const result = await refundPayment(paymentId, amountCents, `admin-refund-${paymentId}-${count ?? 0}`, { reason: reason ?? "" });
    await audit(actorId, "admin.refund", "payment", paymentId, null, { amount_cents: result.refundedCents, refund_id: result.refundId, reason });
    return result;
  } catch (err) {
    if (err instanceof RefundError) throw new BookingError("refund_unavailable", err.message);
    throw err;
  }
}

// -----------------------------------------------------------------------------
// Cancel (owner decides the refund)
// -----------------------------------------------------------------------------

export async function adminCancelBooking(
  actorId: string,
  bookingId: string,
  opts: { refundCents: number; restoreCredit: boolean; reason: string | null; notify: boolean },
) {
  const admin = createAdminClient();
  const { data: booking } = await admin.from("bookings").select("id, status, package_id, payment_id, series_id").eq("id", bookingId).single();
  if (!booking || !LIVE.includes(booking.status)) throw new BookingError("not_cancellable", "Only upcoming lessons can be cancelled.");

  // Resolve the payment before touching anything, so a missing payment fails cleanly.
  const paymentId = opts.refundCents > 0 ? await resolvePaymentId(booking) : null;
  if (opts.refundCents > 0 && !paymentId) throw new BookingError("refund_unavailable", "There's no card payment linked to this lesson. Cancel without a refund, or refund from Payments.");

  // Claim the cancellation atomically first: whoever moves the lesson out of a
  // live status (owner or family) is the only one who refunds or restores.
  const { data: claimed, error } = await admin
    .from("bookings")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancelled_by: actorId, cancellation_reason: opts.reason?.slice(0, 500) ?? null, needs_attention: false, attention_reason: null })
    .eq("id", bookingId)
    .in("status", LIVE)
    .select("id");
  if (error) throw new Error(error.message);
  if (!claimed?.length) throw new BookingError("not_cancellable", "This lesson was already cancelled.");

  let refund = { refundedCents: 0, refundId: null as string | null };
  const restore = opts.restoreCredit && Boolean(booking.package_id);
  try {
    if (paymentId) {
      try {
        // Same key as a family cancellation, so a lesson is refunded once however it's cancelled.
        refund = await refundPayment(paymentId, opts.refundCents, `cancel-${bookingId}`, { booking_id: bookingId });
      } catch (err) {
        if (err instanceof RefundError) throw new BookingError("refund_unavailable", err.message);
        throw err;
      }
    }
    if (restore) await admin.rpc("restore_package_credit", { p_package_id: booking.package_id });
  } catch (err) {
    await admin.from("bookings").update({ status: booking.status, cancelled_at: null, cancelled_by: null, cancellation_reason: null }).eq("id", bookingId).eq("status", "cancelled");
    throw err;
  }
  await admin.from("booking_offers").update({ status: "superseded" }).eq("booking_id", bookingId).eq("status", "pending");

  await audit(actorId, "admin.cancel_booking", "booking", bookingId, bookingId, { refund_cents: refund.refundedCents, refund_id: refund.refundId, credit_restored: restore, reason: opts.reason });
  if (opts.notify) await safely("admin cancelled", () => notifyCancelled(bookingId, { refundCents: refund.refundedCents, creditRestored: restore }));
  return { refundedCents: refund.refundedCents, creditRestored: restore };
}

// -----------------------------------------------------------------------------
// Reassign to another instructor (confirms the lesson)
// -----------------------------------------------------------------------------

export async function adminReassign(actorId: string, bookingId: string, instructorId: string, opts: { ignoreBuffer: boolean; notify: boolean }) {
  const admin = createAdminClient();
  const { data: booking } = await admin.from("bookings").select("id, status, instructor_id").eq("id", bookingId).single();
  if (!booking || !["pending_instructor", "confirmed"].includes(booking.status)) throw new BookingError("not_reassignable", "Only upcoming paid lessons can be reassigned.");
  if (booking.instructor_id === instructorId && booking.status === "confirmed") return { changed: false };
  const { data: instructor } = await admin.from("instructors").select("id, is_active").eq("id", instructorId).single();
  if (!instructor?.is_active) throw new BookingError("inactive_instructor", "That instructor isn't active.");

  await admin.from("booking_offers").update({ status: "superseded" }).eq("booking_id", bookingId).eq("status", "pending");
  const { error } = await admin
    .from("bookings")
    .update({ instructor_id: instructorId, status: "confirmed", confirmed_at: new Date().toISOString(), needs_attention: false, attention_reason: null, buffer_override: opts.ignoreBuffer })
    .eq("id", bookingId);
  if (error) throw new BookingError("conflict", scheduleErrorMessage(error)!);

  await audit(actorId, "admin.reassign_booking", "booking", bookingId, bookingId, { from: booking.instructor_id, to: instructorId, ignore_buffer: opts.ignoreBuffer });
  if (opts.notify) {
    // Same time, different instructor: the family hears "new instructor", the old instructor hears "cancelled".
    await safely("reassigned", () => notifyReassigned(bookingId, booking.instructor_id === instructorId ? null : booking.instructor_id));
  }
  return { changed: true };
}

// -----------------------------------------------------------------------------
// Manual booking
// -----------------------------------------------------------------------------

export const manualBookingSchema = z.object({
  parentId: z.guid(),
  childIds: z.array(z.guid()).min(1, "Pick at least one swimmer").max(12),
  instructorId: z.guid({ message: "Pick an instructor" }),
  start: z.iso.datetime({ offset: true, message: "Pick a date and time" }),
  durationMinutes: z.number().int().min(15).max(240),
  address: addressInputSchema.optional(),
  payment: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("comp") }),
    z.object({ kind: z.literal("link"), amountCents: z.number().int().min(50).optional() }),
    z.object({ kind: z.literal("offline"), amountCents: z.number().int().min(0), note: z.string().trim().max(200).optional() }),
  ]),
  ignoreBuffer: z.boolean().default(false),
  notify: z.boolean().default(true),
});
export type ManualBookingInput = z.input<typeof manualBookingSchema>;

export async function suggestedPrice(durationMinutes: number, childrenCount: number, zoneId: string) {
  const admin = createAdminClient();
  const [{ data: zone }, catalog] = await Promise.all([admin.from("zones").select("id, code, travel_fee_cents, min_booking_minutes, is_bookable").eq("id", zoneId).single(), loadCatalog()]);
  if (!zone) return null;
  try {
    return quoteLesson(
      { durationMinutes, childrenCount, zone: { id: zone.id, code: zone.code, travelFeeCents: zone.travel_fee_cents, minBookingMinutes: 0, isBookable: true }, plan: { kind: "single" } },
      catalog,
    ).totalCents;
  } catch (err) {
    if (err instanceof PricingError) return null;
    throw err;
  }
}

export async function createManualBooking(actorId: string, raw: ManualBookingInput) {
  const input = manualBookingSchema.parse(raw);
  const admin = createAdminClient();

  const [{ data: parent }, { data: children }, { data: instructor }] = await Promise.all([
    admin.from("parents").select("id, address_line1, address_line2, city, postal_code, access_notes, user:users!inner(role)").eq("id", input.parentId).maybeSingle(),
    admin.from("children").select("id").eq("parent_id", input.parentId).in("id", input.childIds),
    admin.from("instructors").select("id, is_active").eq("id", input.instructorId).maybeSingle(),
  ]);
  if (!parent) throw new BookingError("not_parent", "Family not found.");
  if ((children ?? []).length !== new Set(input.childIds).size) throw new BookingError("invalid_swimmers", "Those swimmers don't belong to this family.");
  if (!instructor?.is_active) throw new BookingError("inactive_instructor", "That instructor isn't active.");

  const addressInput = input.address ?? (parent.address_line1 ? { line1: parent.address_line1, line2: parent.address_line2 ?? undefined, city: parent.city ?? undefined, postalCode: parent.postal_code ?? undefined, accessNotes: parent.access_notes ?? undefined } : null);
  if (!addressInput) throw new BookingError("no_address", "This family has no address on file — enter one.");
  const check = await verifyAddress(addressInput);
  // The owner may book outside the bookable zones, but never outside the county.
  if (!check.ok) throw new BookingError(check.reason, check.message);
  const address = check.address;

  const start = Date.parse(input.start);
  const end = start + input.durationMinutes * 60_000;
  const amountCents =
    input.payment.kind === "comp" ? 0 : (input.payment.amountCents ?? (await suggestedPrice(input.durationMinutes, input.childIds.length, address.zone.id)) ?? 0);

  const { data: booking, error } = await admin
    .from("bookings")
    .insert({
      parent_id: input.parentId,
      instructor_id: input.instructorId,
      zone_id: address.zone.id,
      neighborhood: address.neighborhood,
      starts_at: new Date(start).toISOString(),
      ends_at: new Date(end).toISOString(),
      status: "confirmed",
      kind: "manual",
      source: "admin",
      children_count: input.childIds.length,
      created_by: actorId,
      confirmed_at: new Date().toISOString(),
      buffer_override: input.ignoreBuffer,
    })
    .select("id")
    .single();
  if (error || !booking) throw new BookingError("conflict", scheduleErrorMessage(error) ?? "Couldn't create the booking.");
  const bookingId = booking.id as string;

  try {
    const writes = await Promise.all([
      admin.from("booking_children").insert(input.childIds.map((id) => ({ booking_id: bookingId, child_id: id }))),
      admin.from("booking_locations").insert({
        booking_id: bookingId,
        address_line1: address.line1,
        address_line2: address.line2,
        city: address.city,
        postal_code: address.postalCode,
        lat: address.lat,
        lng: address.lng,
        google_place_id: address.placeId,
        access_notes: address.accessNotes,
      }),
      admin.from("booking_pricing").insert({ booking_id: bookingId, base_cents: amountCents, total_cents: amountCents, snapshot: { manual: true, payment: input.payment.kind, by: actorId } }),
    ]);
    const failed = writes.find((w) => w.error);
    if (failed) throw new BookingError("invalid", scheduleErrorMessage(failed.error) ?? "Couldn't save the booking.");
  } catch (err) {
    await admin.from("bookings").delete().eq("id", bookingId);
    throw err;
  }

  let paymentUrl: string | null = null;
  if (input.payment.kind === "offline" && amountCents > 0) {
    const { data: p } = await admin
      .from("payments")
      .insert({ parent_id: input.parentId, booking_id: bookingId, amount_cents: amountCents, status: "succeeded", kind: "booking", description: `Recorded by owner${input.payment.note ? `: ${input.payment.note}` : ""}` })
      .select("id")
      .single();
    if (p) await admin.from("bookings").update({ payment_id: p.id }).eq("id", bookingId);
  }

  await audit(actorId, "admin.create_booking", "booking", bookingId, bookingId, { payment: input.payment.kind, amount_cents: amountCents, ignore_buffer: input.ignoreBuffer });
  if (input.notify) await safely("manual booking", () => notifyManualBooking(bookingId));
  if (input.payment.kind === "link" && amountCents > 0) paymentUrl = (await sendPaymentLink(actorId, bookingId, amountCents, input.notify)).url;
  return { bookingId, amountCents, paymentUrl };
}

/** Email the family a card-payment link for a lesson (new link each time; the previous one is voided). */
export async function sendPaymentLink(actorId: string, bookingId: string, amountCents: number, notify = true) {
  const admin = createAdminClient();
  const { data: b } = await admin
    .from("bookings")
    .select("id, parent_id, starts_at, ends_at, payment_id, parent:parents(stripe_customer_id, user:users(email, first_name, last_name))")
    .eq("id", bookingId)
    .single();
  if (!b) throw new BookingError("not_found", "Lesson not found.");
  const parent = Array.isArray(b.parent) ? b.parent[0] : b.parent;
  const user = parent && (Array.isArray(parent.user) ? parent.user[0] : parent.user);
  if (!user) throw new BookingError("not_parent", "Family not found.");

  // Void an earlier unpaid link.
  if (b.payment_id) await admin.from("payments").update({ status: "cancelled" }).eq("id", b.payment_id).eq("status", "pending");

  const { data: payment, error } = await admin
    .from("payments")
    .insert({ parent_id: b.parent_id, booking_id: bookingId, amount_cents: amountCents, status: "pending", kind: "booking", description: `Swim lesson ${formatDateTime(b.starts_at)}` })
    .select("id")
    .single();
  if (error || !payment) throw new Error(error?.message ?? "could not create payment");

  const gateway = paymentsGateway();
  const customerId = await gateway.ensureCustomer({ parentId: b.parent_id, email: user.email, name: [user.first_name, user.last_name].filter(Boolean).join(" ") || null, existingCustomerId: parent?.stripe_customer_id ?? null });
  if (!parent?.stripe_customer_id) await admin.from("parents").update({ stripe_customer_id: customerId }).eq("id", b.parent_id);
  const session = await gateway.createCheckout({
    paymentId: payment.id,
    customerId,
    title: "Swim lesson",
    description: `Lesson on ${formatDateTime(b.starts_at)}`,
    amountCents,
    currency: "usd",
    successUrl: `${siteUrl()}/parent/lessons/${bookingId}?paid=1`,
    cancelUrl: `${siteUrl()}/parent/lessons/${bookingId}`,
    expiresAt: new Date(Date.now() + 23 * 3_600_000), // Stripe's maximum is 24 h
  });
  await Promise.all([
    admin.from("payments").update({ stripe_checkout_session_id: session.sessionId }).eq("id", payment.id),
    admin.from("bookings").update({ payment_id: payment.id }).eq("id", bookingId),
  ]);
  await audit(actorId, "admin.send_payment_link", "payment", payment.id, bookingId, { amount_cents: amountCents });
  if (notify) await safely("payment link", () => notifyPaymentRequest(bookingId, amountCents, session.url, payment.id));
  return { url: session.url, paymentId: payment.id as string };
}


/** What the cancellation policy would refund right now, as a starting point for the owner. */
export async function adminCancellationPreview(bookingId: string, now = Date.now()) {
  const admin = createAdminClient();
  const [{ data: b }, { data: s }] = await Promise.all([
    admin.from("bookings").select("id, starts_at, package_id, payment_id, series_id, booking_pricing(total_cents)").eq("id", bookingId).single(),
    admin.from("platform_settings").select("cancellation_window_hours, late_cancel_refund_pct").single(),
  ]);
  if (!b || !s) return null;
  const paymentId = await resolvePaymentId(b);
  let paidCents = 0;
  let refundableCents = 0;
  if (paymentId) {
    const { data: p } = await admin.from("payments").select("amount_cents, refunded_cents, status").eq("id", paymentId).single();
    if (p && ["succeeded", "partially_refunded"].includes(p.status)) {
      paidCents = Math.min(one(b.booking_pricing)?.total_cents ?? p.amount_cents, p.amount_cents);
      refundableCents = p.amount_cents - p.refunded_cents;
    }
  }
  const outcome = cancellationOutcome({ startsAt: Date.parse(b.starts_at), paidCents, paidWithCredit: Boolean(b.package_id) }, { cancellationWindowHours: s.cancellation_window_hours, lateCancelRefundPct: Number(s.late_cancel_refund_pct) }, now);
  return { ...outcome, refundCents: Math.min(outcome.refundCents, refundableCents), paidCents, refundableCents, paymentId, hasPackage: Boolean(b.package_id), started: Date.parse(b.starts_at) <= now };
}
