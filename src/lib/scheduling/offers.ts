import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { laDateString } from "@/lib/time";
import { ageInMonths } from "./engine";
import { schedulerForInstant } from "./service";
import type { SwimLevel } from "./types";

export type OfferOutcome =
  | { status: "offered"; instructorId: string; offerId: string }
  | { status: "unmatched"; reason: string }
  | { status: "noop"; reason: string };

const RACE_CODES = new Set(["SB001", "SB003", "23P01"]);

/**
 * Offer a booking request to the best-ranked instructor who hasn't seen it yet.
 * Called after payment (first offer), after a decline, and by the cron when an
 * offer expires. The parent's chosen/favorite instructor ranks first; everyone
 * who already declined or let it expire is excluded.
 */
export async function offerNextInstructor(bookingId: string, now = Date.now()): Promise<OfferOutcome> {
  const admin = createAdminClient();
  const { data: booking, error } = await admin
    .from("bookings")
    .select(
      "id, status, instructor_id, requested_instructor_id, zone_id, neighborhood, starts_at, ends_at, parent:parents(favorite_instructor_id), zone:zones(code), booking_children(child:children(birth_date, swim_level))",
    )
    .eq("id", bookingId)
    .single();
  if (error || !booking) throw new Error(`booking ${bookingId} not found: ${error?.message}`);
  if (booking.status !== "pending_instructor") return { status: "noop", reason: `booking is ${booking.status}` };
  if (booking.instructor_id) return { status: "noop", reason: "already offered to an instructor" };

  const start = Date.parse(booking.starts_at);
  const durationMinutes = Math.round((Date.parse(booking.ends_at) - start) / 60_000);
  const lessonDate = laDateString(new Date(start));
  const children = (booking.booking_children ?? [])
    .map((bc) => (Array.isArray(bc.child) ? bc.child[0] : bc.child))
    .filter(Boolean) as { birth_date: string | null; swim_level: SwimLevel }[];
  const swimmers = children.map((c) => ({ ageMonths: c.birth_date ? ageInMonths(c.birth_date, lessonDate) : null, level: c.swim_level }));
  const parent = Array.isArray(booking.parent) ? booking.parent[0] : booking.parent;
  const zone = Array.isArray(booking.zone) ? booking.zone[0] : booking.zone;

  const { data: priorOffers } = await admin.from("booking_offers").select("instructor_id").eq("booking_id", bookingId);
  const exclude = (priorOffers ?? []).map((o) => o.instructor_id as string);

  const { scheduler, data } = await schedulerForInstant(start, now);
  const leadMs = data.settings.offerMinLeadMinutes * 60_000;
  const latestDeadline = start - leadMs;
  if (latestDeadline <= now) {
    return markUnmatched(bookingId, "Lesson is too soon to find another instructor");
  }
  const expiresAt = new Date(Math.min(now + data.settings.bookingRequestWindowHours * 3_600_000, latestDeadline)).toISOString();

  const ranked = scheduler.rankInstructorsForSlot({
    zoneId: booking.zone_id,
    durationMinutes,
    swimmers,
    start,
    excludeInstructorIds: exclude,
    favoriteInstructorId: booking.requested_instructor_id ?? parent?.favorite_instructor_id ?? null,
  });

  // Ages + levels only. No names until the instructor accepts.
  const lessonSummary = {
    zone: zone?.code,
    neighborhood: booking.neighborhood,
    duration_minutes: durationMinutes,
    swimmers: swimmers.map((s) => ({ age: s.ageMonths === null ? null : Math.floor(s.ageMonths / 12), swim_level: s.level })),
  };

  for (const candidate of ranked) {
    const { data: offerId, error: offerError } = await admin.rpc("assign_booking_offer", {
      p_booking_id: bookingId,
      p_instructor_id: candidate.instructorId,
      p_expires_at: expiresAt,
      p_lesson_summary: lessonSummary,
    });
    if (!offerError) {
      // TODO(phase 4): notify the instructor (email + SMS) of the new request.
      return { status: "offered", instructorId: candidate.instructorId, offerId: offerId as string };
    }
    if (offerError.code === "SB002") return { status: "noop", reason: offerError.message };
    if (!RACE_CODES.has(offerError.code ?? "")) throw new Error(`assign_booking_offer failed: ${offerError.message}`);
    // Someone else just took that time — try the next candidate.
  }

  return markUnmatched(bookingId, exclude.length ? "Every matching instructor declined or didn't respond" : "No instructor is available for this time");
}

async function markUnmatched(bookingId: string, reason: string): Promise<OfferOutcome> {
  const admin = createAdminClient();
  await admin.from("bookings").update({ needs_attention: true, attention_reason: reason }).eq("id", bookingId);
  await admin.from("audit_log").insert({ action: "system.booking_unmatched", entity_type: "booking", entity_id: bookingId, booking_id: bookingId, metadata: { reason } });
  // TODO(phase 4): alert the admin; TODO(phase 3): offer the parent a reschedule or refund.
  return { status: "unmatched", reason };
}

/** Cron: expire lapsed offers and payment holds, then keep every open request moving. */
export async function runSchedulingMaintenance(now = Date.now()) {
  const admin = createAdminClient();
  const [{ data: holds, error: holdsError }, { data: expired, error: expiredError }] = await Promise.all([
    admin.rpc("expire_payment_holds"),
    admin.rpc("expire_stale_offers"),
  ]);
  if (holdsError) throw new Error(holdsError.message);
  if (expiredError) throw new Error(expiredError.message);

  const { data: awaiting, error: awaitingError } = await admin.rpc("bookings_awaiting_offer");
  if (awaitingError) throw new Error(awaitingError.message);

  const results: Record<string, OfferOutcome["status"]> = {};
  for (const id of (awaiting ?? []) as string[]) {
    try {
      results[id] = (await offerNextInstructor(id, now)).status;
    } catch (err) {
      console.error("offerNextInstructor failed", id, err);
    }
  }
  return {
    expiredHolds: ((holds ?? []) as string[]).length,
    expiredOffers: ((expired ?? []) as string[]).length,
    offers: results,
  };
}
