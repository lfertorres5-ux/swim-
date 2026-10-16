import "server-only";
import { notifyCancelled, notifyRescheduled, safely } from "@/lib/notifications/events";
import { paymentsGateway } from "@/lib/payments/gateway";
import { ageInMonths } from "@/lib/scheduling/engine";
import { offerNextInstructor } from "@/lib/scheduling/offers";
import { schedulerForInstant } from "@/lib/scheduling/service";
import type { SwimLevel } from "@/lib/scheduling/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { laDateString } from "@/lib/time";
import { BookingError } from "./checkout";
import { canReschedule, cancellationOutcome, type CancellationPolicy } from "./policy";

const ACTIVE = ["pending_instructor", "confirmed"];

async function loadPolicy(): Promise<CancellationPolicy & { minNoticeHours: number }> {
  const admin = createAdminClient();
  const { data } = await admin.from("platform_settings").select("cancellation_window_hours, late_cancel_refund_pct, min_booking_notice_hours").single();
  return {
    cancellationWindowHours: data!.cancellation_window_hours,
    lateCancelRefundPct: Number(data!.late_cancel_refund_pct),
    minNoticeHours: data!.min_booking_notice_hours,
  };
}

async function loadOwnedBooking(parentId: string, bookingId: string) {
  const admin = createAdminClient();
  const { data: booking } = await admin
    .from("bookings")
    .select("id, parent_id, instructor_id, status, starts_at, ends_at, zone_id, package_id, payment_id, series_id, kind, booking_pricing(total_cents), booking_children(child:children(birth_date, swim_level))")
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking || booking.parent_id !== parentId) throw new BookingError("not_found", "Lesson not found.");

  // Bookings made through checkout carry payment_id. Admin-created or imported
  // ones may only be linked from the payment side (payments.booking_id / series).
  let paymentId = booking.payment_id as string | null;
  if (!paymentId && !booking.package_id) {
    const { data: byBooking } = await admin.from("payments").select("id").eq("booking_id", bookingId).in("status", ["succeeded", "partially_refunded"]).limit(1).maybeSingle();
    paymentId = byBooking?.id ?? null;
    if (!paymentId && booking.series_id) {
      const { data: bySeries } = await admin.from("payments").select("id").eq("series_id", booking.series_id).is("booking_id", null).in("status", ["succeeded", "partially_refunded"]).limit(1).maybeSingle();
      paymentId = bySeries?.id ?? null;
    }
  }
  return { ...booking, payment_id: paymentId };
}

/** What cancelling would do right now — shown to the parent before they confirm. */
export async function previewCancellation(parentId: string, bookingId: string, now = Date.now()) {
  const booking = await loadOwnedBooking(parentId, bookingId);
  const policy = await loadPolicy();
  const pricing = Array.isArray(booking.booking_pricing) ? booking.booking_pricing[0] : booking.booking_pricing;
  return {
    ...cancellationOutcome({ startsAt: Date.parse(booking.starts_at), paidCents: booking.payment_id ? (pricing?.total_cents ?? 0) : 0, paidWithCredit: Boolean(booking.package_id) }, policy, now),
    policy,
    cancellable: ACTIVE.includes(booking.status) && Date.parse(booking.starts_at) > now,
  };
}

export async function cancelBooking(parentId: string, bookingId: string, reason: string | null, now = Date.now()) {
  const admin = createAdminClient();
  const booking = await loadOwnedBooking(parentId, bookingId);
  if (!ACTIVE.includes(booking.status) || Date.parse(booking.starts_at) <= now) throw new BookingError("not_cancellable", "This lesson can't be cancelled.");

  const preview = await previewCancellation(parentId, bookingId, now);
  let refundId: string | null = null;

  if (preview.refundCents > 0 && booking.payment_id) {
    const { data: payment } = await admin.from("payments").select("id, status, amount_cents, refunded_cents, stripe_payment_intent_id, stripe_refund_ids").eq("id", booking.payment_id).single();
    if (!payment?.stripe_payment_intent_id || !["succeeded", "partially_refunded"].includes(payment.status)) {
      throw new BookingError("refund_unavailable", "We couldn't find the payment for this lesson — please contact us.");
    }
    const amount = Math.min(preview.refundCents, payment.amount_cents - payment.refunded_cents);
    if (amount > 0) {
      const refund = await paymentsGateway().refund({
        paymentIntentId: payment.stripe_payment_intent_id,
        amountCents: amount,
        idempotencyKey: `cancel-${bookingId}`,
        metadata: { booking_id: bookingId, payment_id: payment.id },
      });
      refundId = refund.refundId;
      const refunded = payment.refunded_cents + amount;
      await admin
        .from("payments")
        .update({
          refunded_cents: refunded,
          status: refunded >= payment.amount_cents ? "refunded" : "partially_refunded",
          stripe_refund_ids: [...payment.stripe_refund_ids, refund.refundId],
        })
        .eq("id", payment.id);
    }
  }

  if (preview.restoreCredit && booking.package_id) await admin.rpc("restore_package_credit", { p_package_id: booking.package_id });

  await admin
    .from("bookings")
    .update({ status: "cancelled", cancelled_at: new Date(now).toISOString(), cancelled_by: parentId, cancellation_reason: reason?.slice(0, 500) ?? null, needs_attention: false })
    .eq("id", bookingId);
  await admin.from("booking_offers").update({ status: "superseded" }).eq("booking_id", bookingId).eq("status", "pending");
  await admin.from("open_shifts").update({ status: "cancelled" }).eq("booking_id", bookingId).in("status", ["open", "pending_approval"]);

  await admin.from("audit_log").insert({
    actor_id: parentId,
    actor_role: "parent",
    action: "parent.cancel_booking",
    entity_type: "booking",
    entity_id: bookingId,
    booking_id: bookingId,
    metadata: { on_time: preview.onTime, refund_cents: preview.refundCents, refund_id: refundId, credit_restored: preview.restoreCredit },
  });
  await safely("cancelled", () => notifyCancelled(bookingId, { refundCents: preview.refundCents, creditRestored: preview.restoreCredit }));
  // TODO(phase 6): booking.cancelled webhook.
  return { ...preview, refundId };
}

/**
 * Move a lesson to a new time. Keeps the same instructor when they're free;
 * otherwise the lesson goes back to the request queue for the next match.
 */
export async function rescheduleBooking(parentId: string, bookingId: string, newStartIso: string, now = Date.now()) {
  const admin = createAdminClient();
  const booking = await loadOwnedBooking(parentId, bookingId);
  const policy = await loadPolicy();
  if (!ACTIVE.includes(booking.status)) throw new BookingError("not_reschedulable", "This lesson can't be rescheduled.");
  if (!canReschedule(Date.parse(booking.starts_at), policy, now)) {
    throw new BookingError("inside_window", `Lessons can be rescheduled up to ${policy.cancellationWindowHours} hours before they start.`);
  }

  const newStart = Date.parse(newStartIso);
  if (!Number.isFinite(newStart) || newStart < now + policy.minNoticeHours * 3_600_000) throw new BookingError("too_soon", "Please choose a later time.");
  const duration = Date.parse(booking.ends_at) - Date.parse(booking.starts_at);
  const date = laDateString(new Date(newStart));
  const swimmers = (booking.booking_children ?? [])
    .map((bc) => (Array.isArray(bc.child) ? bc.child[0] : bc.child))
    .filter(Boolean)
    .map((c) => ({ ageMonths: c!.birth_date ? ageInMonths(c!.birth_date, date) : null, level: c!.swim_level as SwimLevel }));

  const { scheduler } = await schedulerForInstant(newStart, now, { excludeBookingIds: [bookingId] });
  const ranked = scheduler.rankInstructorsForSlot({
    zoneId: booking.zone_id,
    durationMinutes: Math.round(duration / 60_000),
    swimmers,
    start: newStart,
    favoriteInstructorId: booking.instructor_id,
  });
  if (!ranked.length) throw new BookingError("slot_unavailable", "That time isn't available. Please pick another.");

  const keepInstructor = booking.instructor_id && ranked.some((c) => c.instructorId === booking.instructor_id);
  const times = { starts_at: new Date(newStart).toISOString(), ends_at: new Date(newStart + duration).toISOString() };

  if (keepInstructor) {
    const { error } = await admin.from("bookings").update(times).eq("id", bookingId);
    if (error) throw new BookingError("slot_unavailable", "That time was just taken. Please pick another.");
  } else {
    // Different instructor needed → release and re-offer.
    await admin.from("booking_offers").update({ status: "superseded" }).eq("booking_id", bookingId).eq("status", "pending");
    const { error } = await admin.from("bookings").update({ ...times, instructor_id: null, status: "pending_instructor", confirmed_at: null }).eq("id", bookingId);
    if (error) throw new BookingError("slot_unavailable", "That time was just taken. Please pick another.");
    await offerNextInstructor(bookingId, now);
  }

  await admin.from("audit_log").insert({
    actor_id: parentId,
    actor_role: "parent",
    action: "parent.reschedule_booking",
    entity_type: "booking",
    entity_id: bookingId,
    booking_id: bookingId,
    metadata: { from: booking.starts_at, to: times.starts_at, kept_instructor: Boolean(keepInstructor) },
  });
  await safely("rescheduled", () => notifyRescheduled(bookingId, booking.starts_at, Boolean(keepInstructor), booking.instructor_id));
  return { keptInstructor: Boolean(keepInstructor) };
}
