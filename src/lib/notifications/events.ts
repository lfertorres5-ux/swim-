import "server-only";
import { siteUrl } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SkillsBySwimmer } from "@/lib/skills";
import { enqueue, type Recipient } from "./outbox";
import * as t from "./templates";

/**
 * Business events → notifications. Every function here is best-effort: a
 * notification problem must never break a booking, payment or cancellation,
 * so callers wrap them with `safely()`.
 */
export async function safely(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (err) {
    console.error(`notification "${label}" failed`, err);
  }
}

type Person = Recipient & { firstName: string | null };

async function person(userId: string | null): Promise<Person | null> {
  if (!userId) return null;
  const admin = createAdminClient();
  const { data } = await admin.from("users").select("id, email, phone, first_name, email_opt_in, sms_opt_in").eq("id", userId).maybeSingle();
  if (!data) return null;
  return { userId: data.id, email: data.email, phone: data.phone, firstName: data.first_name, emailOptIn: data.email_opt_in, smsOptIn: data.sms_opt_in };
}

async function lessonContext(bookingId: string) {
  const admin = createAdminClient();
  const { data: b } = await admin
    .from("bookings")
    .select(
      "id, parent_id, instructor_id, requested_instructor_id, package_id, status, starts_at, ends_at, neighborhood, booking_children(child:children(first_name, birth_date)), booking_locations(access_notes), instructor:instructors!bookings_instructor_id_fkey(first_name)",
    )
    .eq("id", bookingId)
    .single();
  if (!b) throw new Error(`booking ${bookingId} not found`);
  const children = ((b.booking_children ?? []).map((bc) => (Array.isArray(bc.child) ? bc.child[0] : bc.child)).filter(Boolean) as { first_name: string; birth_date: string | null }[]).sort((x, y) =>
    x.first_name.localeCompare(y.first_name),
  );
  const instructor = Array.isArray(b.instructor) ? b.instructor[0] : b.instructor;
  const location = Array.isArray(b.booking_locations) ? b.booking_locations[0] : b.booking_locations;
  const lesson: t.LessonInfo = {
    start: b.starts_at,
    end: b.ends_at,
    durationMinutes: Math.round((Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60_000),
    swimmers: children.map((c) => c.first_name),
    neighborhood: b.neighborhood,
    instructorFirstName: instructor?.first_name ?? null,
  };
  const ages = children.map((c) => (c.birth_date ? Math.floor((Date.parse(b.starts_at) - Date.parse(`${c.birth_date}T00:00:00Z`)) / (365.25 * 86_400_000)) : null));
  return { booking: b, lesson, ages, accessNotes: location?.access_notes ?? null };
}

const parentLessonUrl = (id: string) => `${siteUrl()}/parent/lessons/${id}`;

export async function notifyBookingReceived(bookingIds: string[]) {
  if (!bookingIds.length) return;
  const contexts = await Promise.all(bookingIds.map(lessonContext));
  const parent = await person(contexts[0].booking.parent_id);
  if (!parent) return;
  await enqueue(parent, "parent.booking_received", t.bookingReceived({ parentFirstName: parent.firstName, lessons: contexts.map((c) => c.lesson), url: `${siteUrl()}/parent` }), {
    bookingId: bookingIds[0],
    dedupeKey: `received:${bookingIds[0]}`,
  });
}

export async function notifyNewRequest(bookingId: string, instructorId: string, offerId: string, deadline: string) {
  const { lesson, ages } = await lessonContext(bookingId);
  const instructor = await person(instructorId);
  if (!instructor) return;
  await enqueue(instructor, "instructor.new_request", t.instructorNewRequest({ lesson, ages, deadline, url: `${siteUrl()}/instructor/requests` }), {
    bookingId,
    dedupeKey: `request:${offerId}`,
  });
}

/** Instructor accepted. Parents hear "confirmed", or "new instructor" if someone other than who they picked took it. */
export async function notifyAccepted(bookingId: string) {
  const { booking, lesson } = await lessonContext(bookingId);
  const parent = await person(booking.parent_id);
  if (!parent) return;
  const url = parentLessonUrl(bookingId);
  const changed = booking.requested_instructor_id && booking.requested_instructor_id !== booking.instructor_id;
  if (changed) {
    const previous = await person(booking.requested_instructor_id);
    await enqueue(parent, "parent.instructor_changed", t.instructorChanged({ lesson, previousFirstName: previous?.firstName ?? null, url }), {
      bookingId,
      dedupeKey: `accepted:${bookingId}:${booking.instructor_id}`,
    });
  } else {
    await enqueue(parent, "parent.booking_confirmed", t.bookingConfirmed({ lesson, url, contactUnlocked: Boolean(booking.package_id) }), {
      bookingId,
      dedupeKey: `accepted:${bookingId}:${booking.instructor_id}`,
    });
  }
}

export async function notifyCancelled(bookingId: string, outcome: { refundCents: number; creditRestored: boolean }) {
  const { booking, lesson } = await lessonContext(bookingId);
  const [parent, instructor] = await Promise.all([person(booking.parent_id), person(booking.instructor_id)]);
  if (parent) {
    await enqueue(parent, "parent.booking_cancelled", t.parentCancelled({ lesson, ...outcome, url: `${siteUrl()}/book` }), { bookingId, dedupeKey: `cancelled:${bookingId}:parent` });
  }
  if (instructor) {
    await enqueue(instructor, "instructor.booking_cancelled", t.instructorCancelled({ lesson, url: `${siteUrl()}/instructor` }), { bookingId, dedupeKey: `cancelled:${bookingId}:instructor` });
  }
}

export async function notifyRescheduled(bookingId: string, previousStart: string, keptInstructor: boolean, previousInstructorId: string | null) {
  const { booking, lesson } = await lessonContext(bookingId);
  const key = `resched:${bookingId}:${booking.starts_at}`;
  const parent = await person(booking.parent_id);
  if (parent) {
    await enqueue(parent, "parent.rescheduled", t.parentRescheduled({ lesson, previousStart, keptInstructor, url: parentLessonUrl(bookingId) }), { bookingId, dedupeKey: `${key}:parent` });
  }
  if (keptInstructor) {
    const instructor = await person(booking.instructor_id);
    if (instructor) await enqueue(instructor, "instructor.rescheduled", t.instructorRescheduled({ lesson, previousStart, url: `${siteUrl()}/instructor` }), { bookingId, dedupeKey: `${key}:instructor` });
  } else if (previousInstructorId) {
    // The old instructor loses the lesson; to them it's a cancellation.
    const previous = await person(previousInstructorId);
    if (previous) await enqueue(previous, "instructor.booking_cancelled", t.instructorCancelled({ lesson: { ...lesson, start: previousStart }, url: `${siteUrl()}/instructor` }), { bookingId, dedupeKey: `${key}:previous` });
  }
}

export async function notifyUnmatched(bookingId: string, reason: string) {
  const { booking, lesson } = await lessonContext(bookingId);
  const parent = await person(booking.parent_id);
  if (parent) await enqueue(parent, "parent.unmatched", t.parentUnmatched({ lesson, url: `${siteUrl()}/book` }), { bookingId, dedupeKey: `unmatched:${bookingId}:parent` });
  const ownerEmail = process.env.ADMIN_ALERT_EMAIL;
  if (ownerEmail) {
    await enqueue({ userId: null, email: ownerEmail, phone: null, emailOptIn: true, smsOptIn: false }, "admin.unmatched", t.adminUnmatched({ lesson, reason, url: `${siteUrl()}/admin` }), {
      bookingId,
      dedupeKey: `unmatched:${bookingId}:admin`,
    });
  }
}

export async function notifyLessonCompleted(bookingId: string) {
  const admin = createAdminClient();
  const { booking, lesson } = await lessonContext(bookingId);
  const { data: note } = await admin.from("lesson_notes").select("summary, next_focus, skills").eq("booking_id", bookingId).single();
  const parent = await person(booking.parent_id);
  if (!parent || !note) return;
  await enqueue(
    parent,
    "parent.lesson_completed",
    t.lessonCompleted({ lesson, summary: note.summary ?? "", nextFocus: note.next_focus, skills: (note.skills ?? {}) as SkillsBySwimmer, url: `${siteUrl()}/parent/progress` }),
    { bookingId, dedupeKey: `completed:${bookingId}` },
  );
}

/** Cron: reminders for confirmed lessons starting within the reminder window (once per lesson time). */
export async function enqueueReminders(now = Date.now()) {
  const admin = createAdminClient();
  const { data: settings } = await admin.from("platform_settings").select("reminder_hours_before").single();
  const hours = settings?.reminder_hours_before ?? 24;
  const { data: due } = await admin
    .from("bookings")
    .select("id, starts_at, parent_id, instructor_id")
    .eq("status", "confirmed")
    .gt("starts_at", new Date(now + 60 * 60_000).toISOString())
    .lte("starts_at", new Date(now + hours * 3_600_000).toISOString());

  let count = 0;
  for (const b of due ?? []) {
    await safely(`reminder ${b.id}`, async () => {
      const { lesson, accessNotes } = await lessonContext(b.id);
      const [parent, instructor] = await Promise.all([person(b.parent_id), person(b.instructor_id)]);
      const key = `reminder:${b.id}:${b.starts_at}`;
      if (parent) await enqueue(parent, "parent.reminder", t.parentReminder({ lesson, accessNotes, url: parentLessonUrl(b.id) }), { bookingId: b.id, dedupeKey: `${key}:parent` });
      if (instructor) await enqueue(instructor, "instructor.reminder", t.instructorReminder({ lesson, url: `${siteUrl()}/instructor` }), { bookingId: b.id, dedupeKey: `${key}:instructor` });
      count++;
    });
  }
  return count;
}

// --- Sub board -----------------------------------------------------------------

async function shiftContext(shiftId: string) {
  const admin = createAdminClient();
  const { data: s } = await admin
    .from("open_shifts")
    .select("id, booking_id, status, released_by, claimed_by, starts_at, ends_at, neighborhood, lesson_summary, decision_note")
    .eq("id", shiftId)
    .single();
  if (!s) throw new Error(`open shift ${shiftId} not found`);
  const summary = (s.lesson_summary ?? {}) as { duration_minutes?: number; swimmers?: { age: number | null }[] };
  const shift: t.ShiftInfo = {
    start: s.starts_at,
    end: s.ends_at,
    durationMinutes: summary.duration_minutes ?? Math.round((Date.parse(s.ends_at) - Date.parse(s.starts_at)) / 60_000),
    neighborhood: s.neighborhood,
    ages: (summary.swimmers ?? []).map((x) => x.age ?? null),
  };
  return { row: s, shift };
}

const adminAlertRecipient = (): Recipient | null => {
  const email = process.env.ADMIN_ALERT_EMAIL;
  return email ? { userId: null, email, phone: null, emailOptIn: true, smsOptIn: false } : null;
};

/** Posted → tell every instructor who's free and qualified. */
export async function notifyShiftPosted(shiftId: string) {
  const admin = createAdminClient();
  const { shift } = await shiftContext(shiftId);
  const { data: ids } = await admin.rpc("open_shift_candidates", { p_shift_id: shiftId });
  for (const id of (ids ?? []) as string[]) {
    const p = await person(id);
    if (p) await enqueue(p, "instructor.shift_available", t.instructorShiftAvailable({ shift, url: `${siteUrl()}/instructor/sub-board` }), { dedupeKey: `shift:${shiftId}:posted:${id}` });
  }
}

/** Claimed and waiting on approval → owner alert. */
export async function notifyShiftClaimed(shiftId: string) {
  const { row, shift } = await shiftContext(shiftId);
  const owner = adminAlertRecipient();
  if (!owner || row.status !== "pending_approval") return;
  const [from, to] = await Promise.all([person(row.released_by), person(row.claimed_by)]);
  await enqueue(owner, "admin.shift_approval", t.adminShiftNeedsApproval({ shift, fromFirstName: from?.firstName ?? null, toFirstName: to?.firstName ?? null, url: `${siteUrl()}/admin/sub-board` }), {
    bookingId: row.booking_id,
    dedupeKey: `shift:${shiftId}:claimed:${row.claimed_by}`,
  });
}

/** Filled → family meets the sub; the sub gets the lesson; the original instructor is off the hook. */
export async function notifyShiftFilled(shiftId: string) {
  const { row } = await shiftContext(shiftId);
  if (row.status !== "filled") return;
  const { booking, lesson } = await lessonContext(row.booking_id);
  const [parent, sub, original] = await Promise.all([person(booking.parent_id), person(row.claimed_by), person(row.released_by)]);
  const key = `shift:${shiftId}:filled`;
  if (parent) await enqueue(parent, "parent.instructor_changed", t.instructorChanged({ lesson, previousFirstName: original?.firstName ?? null, url: parentLessonUrl(row.booking_id) }), { bookingId: row.booking_id, dedupeKey: `${key}:parent` });
  if (sub) await enqueue(sub, "instructor.shift_filled", t.instructorShiftFilled({ lesson, url: `${siteUrl()}/instructor` }), { bookingId: row.booking_id, dedupeKey: `${key}:sub` });
  if (original) await enqueue(original, "instructor.shift_covered", t.instructorShiftCovered({ lesson, subFirstName: sub?.firstName ?? null, url: `${siteUrl()}/instructor` }), { bookingId: row.booking_id, dedupeKey: `${key}:original` });
}

export async function notifyClaimDeclined(shiftId: string, claimerId: string) {
  const { row, shift } = await shiftContext(shiftId);
  const claimer = await person(claimerId);
  if (claimer) {
    await enqueue(claimer, "instructor.claim_declined", t.instructorClaimDeclined({ shift, note: row.decision_note, url: `${siteUrl()}/instructor/sub-board` }), {
      bookingId: row.booking_id,
      dedupeKey: `shift:${shiftId}:declined:${claimerId}:${Date.now()}`,
    });
  }
}

// --- Admin-originated ----------------------------------------------------------

export async function notifyInstructorInvite(inviteId: string, email: string) {
  await enqueue({ userId: null, email, phone: null, emailOptIn: true, smsOptIn: false }, "instructor.invite", t.instructorInvite({ url: `${siteUrl()}/login?email=${encodeURIComponent(email)}` }), {
    dedupeKey: `invite:${inviteId}`,
  });
}

export async function notifyPaymentRequest(bookingId: string, amountCents: number, url: string, paymentId: string) {
  const { booking, lesson } = await lessonContext(bookingId);
  const parent = await person(booking.parent_id);
  if (parent) await enqueue(parent, "parent.payment_request", t.parentPaymentRequest({ lesson, amountCents, url }), { bookingId, dedupeKey: `payreq:${paymentId}` });
}

/** Owner confirmed a lesson directly (manual booking) → same "confirmed" message plus the instructor's heads-up. */
export async function notifyManualBooking(bookingId: string) {
  const { booking, lesson } = await lessonContext(bookingId);
  const [parent, instructor] = await Promise.all([person(booking.parent_id), person(booking.instructor_id)]);
  if (parent) await enqueue(parent, "parent.booking_confirmed", t.bookingConfirmed({ lesson, url: parentLessonUrl(bookingId), contactUnlocked: false }), { bookingId, dedupeKey: `manual:${bookingId}:parent` });
  if (instructor) await enqueue(instructor, "instructor.shift_filled", t.instructorShiftFilled({ lesson, url: `${siteUrl()}/instructor` }), { bookingId, dedupeKey: `manual:${bookingId}:instructor:${booking.instructor_id}` });
}

// --- Day pass --------------------------------------------------------------------

async function clubName() {
  const admin = createAdminClient();
  const { data } = await admin.from("platform_settings").select("partner_club_name").single();
  return data?.partner_club_name || "Partner Club";
}

export async function notifyDayPassInquiry(inquiryId: string) {
  const admin = createAdminClient();
  const { data: q } = await admin.from("day_pass_inquiries").select("*").eq("id", inquiryId).single();
  if (!q) return;
  const club = await clubName();
  const family: Recipient = { userId: q.parent_id, email: q.contact_email, phone: null, emailOptIn: true, smsOptIn: false };
  await enqueue(family, "parent.day_pass_received", t.dayPassReceived({ name: q.contact_name, clubName: club, url: `${siteUrl()}/day-pass` }), { dedupeKey: `daypass:${inquiryId}:received` });
  const owner = adminAlertRecipient();
  if (owner) {
    await enqueue(
      owner,
      "admin.day_pass_inquiry",
      t.adminDayPassInquiry({
        inquiry: { name: q.contact_name, adults: q.adults_count, children: q.children_count, dates: q.preferred_dates ?? [], interest: q.interest_level, message: q.message },
        url: `${siteUrl()}/admin/day-pass`,
      }),
      { dedupeKey: `daypass:${inquiryId}:admin` },
    );
  }
}

export async function notifyDayPassPaymentLink(inquiryId: string, note: string | null) {
  const admin = createAdminClient();
  const { data: q } = await admin.from("day_pass_inquiries").select("*").eq("id", inquiryId).single();
  if (!q?.stripe_payment_link_url) return;
  const club = await clubName();
  await enqueue(
    { userId: q.parent_id, email: q.contact_email, phone: null, emailOptIn: true, smsOptIn: false },
    "parent.day_pass_payment_link",
    t.dayPassPaymentLink({ name: q.contact_name, clubName: club, amountCents: q.quoted_amount_cents, dates: q.preferred_dates ?? [], url: q.stripe_payment_link_url, note }),
    { dedupeKey: `daypass:${inquiryId}:link:${q.stripe_payment_link_url}` },
  );
}

/** Owner moved a lesson to another instructor (same time). */
export async function notifyReassigned(bookingId: string, previousInstructorId: string | null) {
  const { booking, lesson } = await lessonContext(bookingId);
  const [parent, next, previous] = await Promise.all([person(booking.parent_id), person(booking.instructor_id), person(previousInstructorId)]);
  const key = `reassign:${bookingId}:${booking.instructor_id}`;
  if (parent) {
    const template = previous ? "parent.instructor_changed" : "parent.booking_confirmed";
    const rendered = previous
      ? t.instructorChanged({ lesson, previousFirstName: previous.firstName, url: parentLessonUrl(bookingId) })
      : t.bookingConfirmed({ lesson, url: parentLessonUrl(bookingId), contactUnlocked: false });
    await enqueue(parent, template, rendered, { bookingId, dedupeKey: `${key}:parent` });
  }
  if (next) await enqueue(next, "instructor.shift_filled", t.instructorShiftFilled({ lesson, url: `${siteUrl()}/instructor` }), { bookingId, dedupeKey: `${key}:next` });
  if (previous) await enqueue(previous, "instructor.booking_cancelled", t.instructorCancelled({ lesson, url: `${siteUrl()}/instructor` }), { bookingId, dedupeKey: `${key}:previous` });
}
