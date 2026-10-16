import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, laDateString } from "@/lib/time";
import { clientAs, configureServerEnv, enabled, ids } from "./setup";

/**
 * Notifications end to end with the "log" providers (no Resend/Twilio keys):
 * every message lands in public.notifications as sent/provider=log.
 */
const db = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
const PRIYA = "00000000-0000-4000-a000-000000000203";
const kids = { mia: "00000000-0000-4000-c000-000000000004", leo: "00000000-0000-4000-c000-000000000005", zoe: "00000000-0000-4000-c000-000000000006" };
const priyaAddress = { line1: "1820 Ocean Bluff Way", city: "Del Mar", postalCode: "92014" };

let checkout: typeof import("@/lib/booking/checkout");
let manage: typeof import("@/lib/booking/manage");
let events: typeof import("@/lib/notifications/events");
let service: typeof import("@/lib/scheduling/service");

beforeAll(async () => {
  configureServerEnv();
  process.env.PAYMENTS_DEV_MODE = "true";
  process.env.ADMIN_ALERT_EMAIL = "owner@example.com";
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.RESEND_API_KEY;
  delete process.env.TWILIO_ACCOUNT_SID;
  checkout = await import("@/lib/booking/checkout");
  manage = await import("@/lib/booking/manage");
  events = await import("@/lib/notifications/events");
  service = await import("@/lib/scheduling/service");
});
afterAll(() => db.end());

const messages = async (bookingId: string) =>
  (await db.query("select template, channel, to_address, status, provider, subject, body_text from public.notifications where booking_id = $1 order by created_at, template", [bookingId])).rows;

async function paidBooking(fromDays: number, instructorId: string | null = null) {
  const from = addDays(laDateString(), fromDays);
  const swimmers = [{ ageMonths: 74, level: "advanced_beginner" as const }, { ageMonths: 50, level: "beginner" as const }, { ageMonths: 110, level: "intermediate" as const }];
  const { slots } = await service.getAvailability({ zoneId: ids.zoneA, durationMinutes: 60, swimmers, fromDate: from, toDate: addDays(from, 6) });
  // With a chosen instructor, pick a time they AND someone else can teach (so a decline can be re-offered).
  const slot = instructorId ? slots.find((s) => s.candidates.some((c) => c.instructorId === instructorId) && s.candidates.length > 1) : slots[0];
  if (!slot) throw new Error("no suitable slot in the seed calendar");
  const r = await checkout.createBookingCheckout(PRIYA, { address: priyaAddress, durationMinutes: 60, childIds: [kids.mia, kids.leo, kids.zoe], instructorId, plan: { kind: "single" }, start: new Date(slot.start).toISOString() });
  if (r.kind !== "redirect") throw new Error("expected redirect");
  await checkout.fulfillPayment({ paymentId: r.paymentId, sessionId: `dev_cs_n_${r.paymentId}`, paymentIntentId: `dev_pi_n_${r.paymentId}`, amountTotal: null, receiptUrl: null, chargeId: null });
  return r.bookingIds[0];
}

describe.skipIf(!enabled)("notifications", () => {
  let bookingId: string;

  it("payment → family gets 'booking received' (email + text); instructor gets the request", async () => {
    bookingId = await paidBooking(15);
    const rows = await messages(bookingId);
    const templates = rows.map((r) => `${r.template}/${r.channel}`);
    expect(templates).toEqual(expect.arrayContaining(["parent.booking_received/email", "instructor.new_request/email", "instructor.new_request/sms"]));
    expect(rows.every((r) => r.status === "sent" && r.provider === "log")).toBe(true);
    // Priya has a phone + SMS opt-in, but "received" is email-only.
    expect(templates).not.toContain("parent.booking_received/sms");

    const request = rows.find((r) => r.template === "instructor.new_request" && r.channel === "email")!;
    expect(request.body_text).toMatch(/Del Mar/);
    expect(request.body_text).not.toMatch(/Shah|priya@example\.com|Ocean Bluff/); // no parent PII / address
  });

  it("acceptance → 'confirmed'; firing the event twice still sends once", async () => {
    const { rows } = await db.query("select o.id, o.instructor_id from public.booking_offers o where o.booking_id = $1 and o.status = 'pending'", [bookingId]);
    const instructor = clientAs(rows[0].instructor_id);
    expect((await instructor.rpc("respond_to_booking_offer", { p_offer_id: rows[0].id, p_accept: true })).data).toBe("accepted");
    await events.notifyAccepted(bookingId);
    await events.notifyAccepted(bookingId);
    const confirmed = (await messages(bookingId)).filter((r) => r.template === "parent.booking_confirmed");
    expect(confirmed.map((r) => r.channel).sort()).toEqual(["email", "sms"]);
    expect(confirmed.find((r) => r.channel === "email")!.subject).toMatch(/^Confirmed: \w+ on /);
  });

  it("24h reminders go to both sides, once", async () => {
    const { rows } = await db.query("select starts_at from public.bookings where id = $1", [bookingId]);
    const fakeNow = Date.parse(rows[0].starts_at) - 20 * 3_600_000;
    await events.enqueueReminders(fakeNow);
    await events.enqueueReminders(fakeNow);
    const reminders = (await messages(bookingId)).filter((r) => r.template.endsWith(".reminder"));
    expect(reminders.map((r) => `${r.template}/${r.channel}`).sort()).toEqual(["instructor.reminder/email", "instructor.reminder/sms", "parent.reminder/email", "parent.reminder/sms"]);
    const instructorReminder = reminders.find((r) => r.template === "instructor.reminder" && r.channel === "email")!;
    expect(instructorReminder.body_text).toContain("address shows up in the app");
    expect(instructorReminder.body_text).not.toMatch(/Ocean Bluff/);
  });

  it("respects opt-outs: no email when email is off, no text when SMS is off", async () => {
    await db.query("update public.users set email_opt_in = false, sms_opt_in = false where id = $1", [PRIYA]);
    try {
      const id = await paidBooking(22);
      expect((await messages(id)).filter((r) => r.template.startsWith("parent."))).toEqual([]);
    } finally {
      await db.query("update public.users set email_opt_in = true, sms_opt_in = true where id = $1", [PRIYA]);
    }
  });

  it("cancellation → family hears about the refund; the instructor hears the time is free", async () => {
    await manage.cancelBooking(PRIYA, bookingId, "Trip");
    const rows = (await messages(bookingId)).filter((r) => r.template.endsWith("booking_cancelled"));
    expect(rows.map((r) => `${r.template}/${r.channel}`).sort()).toEqual(["instructor.booking_cancelled/email", "instructor.booking_cancelled/sms", "parent.booking_cancelled/email", "parent.booking_cancelled/sms"]);
    expect(rows.find((r) => r.template === "parent.booking_cancelled" && r.channel === "email")!.body_text).toMatch(/refunded \$\d+/);
  });

  it("a progress note reaches the family with the skills checklist", async () => {
    const { rows } = await db.query(
      `insert into public.bookings (parent_id, instructor_id, zone_id, neighborhood, starts_at, ends_at, status, buffer_override)
       values ($1, $2, $3, 'Del Mar', now() - interval '2 hours', now() - interval '1 hour', 'confirmed', true) returning id`,
      [PRIYA, ids.sofia, ids.zoneA],
    );
    const id = rows[0].id as string;
    await db.query("insert into public.booking_children (booking_id, child_id) values ($1, $2), ($1, $3)", [id, kids.mia, kids.leo]);

    const sofia = clientAs(ids.sofia);
    const { data, error } = await sofia.rpc("submit_lesson_note", {
      p_booking_id: id,
      p_skills: { Mia: { "Rhythmic breathing": "progressing" }, Leo: { "Flutter kick": "mastered" } },
      p_summary: "Both kids were brave today.",
      p_next_focus: "Back floats",
    });
    expect(error).toBeNull();
    expect(data).toBe(true);
    await events.notifyLessonCompleted(id);

    const done = (await messages(id)).find((r) => r.template === "parent.lesson_completed" && r.channel === "email")!;
    expect(done.subject).toBe("How Leo & Mia did today");
    expect(done.body_text).toContain("“Both kids were brave today.”");
    expect(done.body_text).toContain("Leo: Flutter kick (Got it!)");
    expect(done.body_text).toContain("Next time: Back floats");
  });

  it("no instructor available → family is told and the owner gets an alert", async () => {
    const { rows } = await db.query(
      `insert into public.bookings (parent_id, instructor_id, zone_id, starts_at, ends_at, status) values ($1, null, $2, now() + interval '90 minutes', now() + interval '150 minutes', 'pending_instructor') returning id`,
      [PRIYA, ids.zoneA],
    );
    await db.query("insert into public.booking_children (booking_id, child_id) values ($1, $2)", [rows[0].id, kids.mia]);
    const { offerNextInstructor } = await import("@/lib/scheduling/offers");
    expect((await offerNextInstructor(rows[0].id)).status).toBe("unmatched");
    const t = (await messages(rows[0].id)).map((r) => `${r.template}:${r.to_address}`);
    expect(t).toContain("admin.unmatched:owner@example.com");
    expect(t).toContain("parent.unmatched:priya@example.com");
  });

  it("the family's chosen instructor declines → someone else accepts → 'new instructor' message", async () => {
    const id = await paidBooking(30, ids.maya);
    const maya = clientAs(ids.maya);
    const { data: offer } = await maya.from("booking_offers").select("id").eq("booking_id", id).eq("status", "pending").single();
    await maya.rpc("respond_to_booking_offer", { p_offer_id: offer!.id, p_accept: false, p_reason: "Out of town" });

    const { offerNextInstructor } = await import("@/lib/scheduling/offers");
    const next = await offerNextInstructor(id);
    expect(next.status).toBe("offered");
    if (next.status !== "offered") return;
    expect(next.instructorId).not.toBe(ids.maya);
    await clientAs(next.instructorId).rpc("respond_to_booking_offer", { p_offer_id: next.offerId, p_accept: true });
    await events.notifyAccepted(id);

    const changed = (await messages(id)).find((r) => r.template === "parent.instructor_changed" && r.channel === "email")!;
    expect(changed.body_text).toContain("Maya can't make it");
    expect((await messages(id)).some((r) => r.template === "parent.booking_confirmed")).toBe(false);
  });
});
