import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, laDateString } from "@/lib/time";
import { clientAs, configureServerEnv, enabled, ids } from "./setup";

/**
 * The full money path through the real API, with the dev payments gateway
 * standing in for Stripe: hold → checkout → fulfillment → instructor request →
 * cancel/refund → reschedule. Prices asserted here are the spec defaults.
 */
const db = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
const PRIYA = "00000000-0000-4000-a000-000000000203";
const DANIEL = "00000000-0000-4000-a000-000000000202";
const EMILY = ids.emily;
const kids = { mia: "00000000-0000-4000-c000-000000000004", leo: "00000000-0000-4000-c000-000000000005", zoe: "00000000-0000-4000-c000-000000000006", noah: "00000000-0000-4000-c000-000000000003", lucas: "00000000-0000-4000-c000-000000000001", ava: "00000000-0000-4000-c000-000000000002" };
const addr = {
  priya: { line1: "1820 Ocean Bluff Way", city: "Del Mar", postalCode: "92014" },
  daniel: { line1: "5510 Seagrove Ct", city: "San Diego", postalCode: "92130" },
  emily: { line1: "742 Neptune Ave", city: "Encinitas", postalCode: "92024", accessNotes: "Side gate code 4821" },
};

type Mod = typeof import("@/lib/booking/checkout");
let checkout: Mod;
let manage: typeof import("@/lib/booking/manage");
let service: typeof import("@/lib/scheduling/service");

beforeAll(async () => {
  configureServerEnv();
  process.env.PAYMENTS_DEV_MODE = "true";
  delete process.env.STRIPE_SECRET_KEY;
  checkout = await import("@/lib/booking/checkout");
  manage = await import("@/lib/booking/manage");
  service = await import("@/lib/scheduling/service");
});
afterAll(() => db.end());

const used = new Set<string>();
/** A bookable slot (ISO start) that no earlier test picked. */
async function freeSlot(opts: { durationMinutes: number; swimmers: { ageMonths: number; level: "beginner" | "intermediate" | "advanced_beginner" | "water_acclimation" }[]; zoneId?: string; from?: number; weeks?: number; instructorId?: string }) {
  const from = addDays(laDateString(), opts.from ?? 3);
  const req = { zoneId: opts.zoneId ?? ids.zoneA, durationMinutes: opts.durationMinutes, swimmers: opts.swimmers, fromDate: from, toDate: addDays(from, 6), instructorId: opts.instructorId };
  let result;
  if (opts.weeks) {
    const { scheduler } = await service.schedulerForInstant(Date.parse(`${from}T20:00:00Z`), Date.now(), { weeks: opts.weeks + 1 });
    result = scheduler.findRecurringSlots(req, opts.weeks);
  } else {
    result = await service.getAvailability(req);
  }
  const slot = result.slots.find((s) => !used.has(`${s.candidates[0].instructorId}|${s.date}`));
  if (!slot) throw new Error("no free slot for test");
  used.add(`${slot.candidates[0].instructorId}|${slot.date}`);
  return { start: new Date(slot.start).toISOString(), slot };
}

async function bookingsFor(paymentId: string) {
  const { rows } = await db.query(
    `select b.id, b.status, b.instructor_id, b.hold_expires_at, p.total_cents from public.bookings b join public.booking_pricing p on p.booking_id = b.id
     where b.payment_id = $1 order by b.starts_at`,
    [paymentId],
  );
  return rows;
}

describe.skipIf(!enabled)("booking + payments through the real API", () => {
  let single: { paymentId: string; bookingIds: string[]; start: string };

  it("holds a single lesson at the server-computed price (3 swimmers = $90 + $25)", async () => {
    const { start, slot } = await freeSlot({ durationMinutes: 60, swimmers: [{ ageMonths: 74, level: "advanced_beginner" }, { ageMonths: 50, level: "beginner" }, { ageMonths: 110, level: "intermediate" }] });
    const result = await checkout.createBookingCheckout(PRIYA, {
      address: addr.priya,
      durationMinutes: 60,
      childIds: [kids.mia, kids.leo, kids.zoe],
      instructorId: null,
      plan: { kind: "single" },
      start,
    });
    expect(result.kind).toBe("redirect");
    if (result.kind !== "redirect") return;
    expect(result.url).toMatch(/\/dev\/checkout\?session=dev_cs_/);
    single = { paymentId: result.paymentId, bookingIds: result.bookingIds, start };

    const [b] = await bookingsFor(result.paymentId);
    const expected = 11500 - (slot.isNeighborhoodSlot ? 500 : 0);
    expect(b).toMatchObject({ status: "pending_payment", total_cents: expected });
    expect(b.hold_expires_at).not.toBeNull();
    const { rows } = await db.query("select amount_cents, status from public.payments where id = $1", [result.paymentId]);
    expect(rows[0]).toEqual({ amount_cents: expected, status: "pending" });
    const loc = await db.query("select address_line1, postal_code from public.booking_locations where booking_id = $1", [b.id]);
    expect(loc.rows[0]).toEqual({ address_line1: addr.priya.line1, postal_code: "92014" });
  });

  it("a held slot can't be double-booked with the same instructor", async () => {
    const [held] = await bookingsFor(single.paymentId);
    await expect(
      checkout.createBookingCheckout(EMILY, { address: addr.emily, durationMinutes: 60, childIds: [kids.lucas], instructorId: held.instructor_id, plan: { kind: "single" }, start: single.start }),
    ).rejects.toMatchObject({ code: "slot_unavailable" });
  });

  it("rejects swimmers from another family and out-of-county addresses", async () => {
    await expect(
      checkout.createBookingCheckout(EMILY, { address: addr.emily, durationMinutes: 60, childIds: [kids.noah], instructorId: null, plan: { kind: "single" }, start: single.start }),
    ).rejects.toMatchObject({ code: "invalid_swimmers" });
    await expect(
      checkout.createBookingCheckout(EMILY, { address: { line1: "1 Main St", city: "Temecula", postalCode: "92590" }, durationMinutes: 60, childIds: [kids.lucas], instructorId: null, plan: { kind: "single" }, start: single.start }),
    ).rejects.toMatchObject({ code: "outside_county" });
  });

  it("payment → instructor request; webhook retries are harmless", async () => {
    const details = { paymentId: single.paymentId, sessionId: `dev_cs_${single.paymentId}`, paymentIntentId: `dev_pi_${single.paymentId}`, amountTotal: null, receiptUrl: null, chargeId: null };
    const first = await checkout.fulfillPayment(details);
    expect(first.fulfilled).toBe(true);
    const again = await checkout.fulfillPayment(details);
    expect(again.fulfilled).toBe(false);

    const [b] = await bookingsFor(single.paymentId);
    expect(b.status).toBe("pending_instructor");
    const { rows } = await db.query("select instructor_id, status from public.booking_offers where booking_id = $1", [b.id]);
    expect(rows).toEqual([{ instructor_id: b.instructor_id, status: "pending" }]);
  });

  it("the parent sees their booking, price and address under RLS — the instructor sees none of it until accepting", async () => {
    const [b] = await bookingsFor(single.paymentId);
    const parent = clientAs(PRIYA);
    const { data } = await parent.from("bookings").select("id, status, booking_pricing(total_cents), booking_locations(address_line1)").eq("id", b.id).single();
    expect(data).toMatchObject({ status: "pending_instructor" });

    const instructor = clientAs(b.instructor_id);
    expect((await instructor.from("booking_pricing").select("*").eq("booking_id", b.id)).data).toEqual([]);
    expect((await instructor.from("booking_locations").select("*").eq("booking_id", b.id)).data).toEqual([]);
  });

  it("an abandoned checkout releases the slot", async () => {
    const { start } = await freeSlot({ durationMinutes: 30, swimmers: [{ ageMonths: 60, level: "beginner" }] });
    const r = await checkout.createBookingCheckout(EMILY, { address: addr.emily, durationMinutes: 30, childIds: [kids.lucas], instructorId: null, plan: { kind: "single" }, start });
    if (r.kind !== "redirect") throw new Error("expected redirect");
    const [held] = await bookingsFor(r.paymentId);
    expect(await checkout.releaseCheckout(r.paymentId)).toBe(1);
    expect((await bookingsFor(r.paymentId))[0].status).toBe("expired");
    // Same instructor + time is bookable again.
    const again = await checkout.createBookingCheckout(EMILY, { address: addr.emily, durationMinutes: 30, childIds: [kids.lucas], instructorId: held.instructor_id, plan: { kind: "single" }, start });
    expect(again.kind).toBe("redirect");
    if (again.kind === "redirect") await checkout.releaseCheckout(again.paymentId);
  });

  it("4-lesson package: pays 4 × 5% off, books the first lesson, then books with a credit for $0", async () => {
    const { data: offering } = await clientAs("anon").from("package_offerings").select("id").eq("lesson_count", 4).single();
    const { start } = await freeSlot({ durationMinutes: 30, swimmers: [{ ageMonths: 60, level: "beginner" }, { ageMonths: 40, level: "water_acclimation" }] });
    const r = await checkout.createBookingCheckout(EMILY, { address: addr.emily, durationMinutes: 30, childIds: [kids.lucas, kids.ava], instructorId: null, plan: { kind: "package", offeringId: offering!.id }, start });
    if (r.kind !== "redirect") throw new Error("expected redirect");
    const pay = await db.query("select amount_cents, package_id from public.payments where id = $1", [r.paymentId]);
    expect(pay.rows[0].amount_cents).toBe(4 * Math.round(6500 * 0.95)); // 24,700

    await checkout.fulfillPayment({ paymentId: r.paymentId, sessionId: "dev_cs_pkg", paymentIntentId: "dev_pi_pkg", amountTotal: null, receiptUrl: null, chargeId: null });
    const pkg = await db.query("select status, lessons_remaining from public.packages where id = $1", [pay.rows[0].package_id]);
    expect(pkg.rows[0]).toEqual({ status: "active", lessons_remaining: 3 });
    const first = await db.query("select status from public.bookings where package_id = $1", [pay.rows[0].package_id]);
    expect(first.rows.map((x) => x.status)).toEqual(["pending_instructor"]);

    const { start: next } = await freeSlot({ durationMinutes: 30, swimmers: [{ ageMonths: 60, level: "beginner" }, { ageMonths: 40, level: "water_acclimation" }], from: 10 });
    const credit = await checkout.createBookingCheckout(EMILY, { address: addr.emily, durationMinutes: 30, childIds: [kids.lucas, kids.ava], instructorId: null, plan: { kind: "package_credit", packageId: pay.rows[0].package_id }, start: next });
    expect(credit.kind).toBe("confirmed");
    const after = await db.query("select lessons_remaining from public.packages where id = $1", [pay.rows[0].package_id]);
    expect(after.rows[0].lessons_remaining).toBe(2);
    const priced = await db.query("select total_cents from public.booking_pricing where booking_id = $1", [credit.bookingIds[0]]);
    expect(priced.rows[0].total_cents).toBe(0);

    // A credit can't be used for a different lesson length.
    await expect(
      checkout.createBookingCheckout(EMILY, { address: addr.emily, durationMinutes: 60, childIds: [kids.lucas, kids.ava], instructorId: null, plan: { kind: "package_credit", packageId: pay.rows[0].package_id }, start: next }),
    ).rejects.toMatchObject({ code: "invalid_credit" });
  });

  it("weekly series: books every week with one instructor at 10% off", async () => {
    const { start, slot } = await freeSlot({ durationMinutes: 60, swimmers: [{ ageMonths: 98, level: "intermediate" }], weeks: 4, from: 4 });
    const r = await checkout.createBookingCheckout(DANIEL, { address: addr.daniel, durationMinutes: 60, childIds: [kids.noah], instructorId: null, plan: { kind: "recurring", weeks: 4 }, start });
    if (r.kind !== "redirect") throw new Error("expected redirect");
    const rows = await bookingsFor(r.paymentId);
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((x) => x.instructor_id)).size).toBe(1);
    expect(rows.every((x) => x.total_cents === 8100)).toBe(true);
    const pay = await db.query("select amount_cents, series_id from public.payments where id = $1", [r.paymentId]);
    expect(pay.rows[0].amount_cents).toBe(4 * 8100);
    const series = await db.query("select weekday, status from public.booking_series where id = $1", [pay.rows[0].series_id]);
    expect(series.rows[0].status).toBe("pending_payment");
    expect(slot.candidates.length).toBeGreaterThan(0);
    await checkout.releaseCheckout(r.paymentId);
  });

  it("promo codes are validated and applied server-side", async () => {
    const { start, slot } = await freeSlot({ durationMinutes: 60, swimmers: [{ ageMonths: 98, level: "intermediate" }], from: 5 });
    const r = await checkout.createBookingCheckout(DANIEL, { address: addr.daniel, durationMinutes: 60, childIds: [kids.noah], instructorId: null, plan: { kind: "single" }, start, promoCode: "welcome10" });
    if (r.kind !== "redirect") throw new Error("expected redirect");
    const base = 9000 - (slot.isNeighborhoodSlot ? 500 : 0);
    expect((await db.query("select amount_cents from public.payments where id = $1", [r.paymentId])).rows[0].amount_cents).toBe(base - Math.round(base * 0.1));
    await checkout.releaseCheckout(r.paymentId);
    await expect(
      checkout.createBookingCheckout(DANIEL, { address: addr.daniel, durationMinutes: 60, childIds: [kids.noah], instructorId: null, plan: { kind: "single" }, start, promoCode: "NOPE" }),
    ).rejects.toMatchObject({ code: "invalid_promo" });
  });

  it("cancelling 24h+ ahead refunds in full and frees the instructor", async () => {
    const [b] = await bookingsFor(single.paymentId);
    const result = await manage.cancelBooking(PRIYA, b.id, "Schedule change");
    expect(result).toMatchObject({ onTime: true, refundCents: b.total_cents });
    expect(result.refundId).toMatch(/^dev_re_/);
    const pay = await db.query("select status, refunded_cents from public.payments where id = $1", [single.paymentId]);
    expect(pay.rows[0]).toEqual({ status: "refunded", refunded_cents: b.total_cents });
    const offers = await db.query("select status from public.booking_offers where booking_id = $1", [b.id]);
    expect(offers.rows.map((o) => o.status)).toEqual(["superseded"]);
    await expect(manage.cancelBooking(PRIYA, b.id, null)).rejects.toMatchObject({ code: "not_cancellable" });
  });

  it("late cancellations follow the policy (0% refund by default)", async () => {
    const { rows } = await db.query(
      `insert into public.payments (parent_id, amount_cents, status, stripe_payment_intent_id) values ($1, 9000, 'succeeded', 'dev_pi_late') returning id`,
      [DANIEL],
    );
    const b = await db.query(
      `insert into public.bookings (parent_id, instructor_id, zone_id, starts_at, ends_at, status, payment_id, buffer_override)
       values ($1, null, $2, now() + interval '5 hours', now() + interval '6 hours', 'confirmed', $3, true) returning id`,
      [DANIEL, ids.zoneA, rows[0].id],
    );
    await db.query("insert into public.booking_pricing (booking_id, total_cents) values ($1, 9000)", [b.rows[0].id]);
    const preview = await manage.previewCancellation(DANIEL, b.rows[0].id);
    expect(preview).toMatchObject({ onTime: false, refundCents: 0 });
    await manage.cancelBooking(DANIEL, b.rows[0].id, null);
    expect((await db.query("select status, refunded_cents from public.payments where id = $1", [rows[0].id])).rows[0]).toEqual({ status: "succeeded", refunded_cents: 0 });
    // Inside the window you also can't reschedule.
    await expect(manage.rescheduleBooking(DANIEL, b.rows[0].id, new Date(Date.now() + 5 * 86_400_000).toISOString())).rejects.toMatchObject({ code: "not_reschedulable" });
  });

  it("parents can only manage their own lessons", async () => {
    const { rows } = await db.query("select id from public.bookings where parent_id = $1 and status = 'confirmed' limit 1", [EMILY]);
    await expect(manage.cancelBooking(PRIYA, rows[0].id, null)).rejects.toMatchObject({ code: "not_found" });
  });

  it("rescheduling keeps the instructor when they're free at the new time", async () => {
    const { start, slot } = await freeSlot({ durationMinutes: 60, swimmers: [{ ageMonths: 98, level: "intermediate" }], from: 6 });
    const r = await checkout.createBookingCheckout(DANIEL, { address: addr.daniel, durationMinutes: 60, childIds: [kids.noah], instructorId: null, plan: { kind: "single" }, start });
    if (r.kind !== "redirect") throw new Error("expected redirect");
    await checkout.fulfillPayment({ paymentId: r.paymentId, sessionId: "dev_cs_resched", paymentIntentId: "dev_pi_resched", amountTotal: null, receiptUrl: null, chargeId: null });
    const { rows: st } = await db.query("select status, instructor_id from public.bookings where id = $1", [r.bookingIds[0]]);
    expect(st[0].status).toBe("pending_instructor");
    const instructorId = st[0].instructor_id as string;
    expect(instructorId).toBe(slot.candidates[0].instructorId);
    // Move it 1 hour later on the same day if the instructor is free then; else a later slot of theirs.
    const later = await service.getAvailability({ zoneId: ids.zoneA, durationMinutes: 60, swimmers: [{ ageMonths: 98, level: "intermediate" }], fromDate: addDays(laDateString(), 12), toDate: addDays(laDateString(), 18), instructorId });
    const target = later.slots[0];
    const moved = await manage.rescheduleBooking(DANIEL, r.bookingIds[0], new Date(target.start).toISOString());
    expect(moved.keptInstructor).toBe(true);
    const { rows } = await db.query("select starts_at, instructor_id from public.bookings where id = $1", [r.bookingIds[0]]);
    expect(Date.parse(rows[0].starts_at)).toBe(target.start);
    expect(rows[0].instructor_id).toBe(instructorId);
  });

  it("a payment update that fails is an error, never a silent 'already done'", async () => {
    const { start } = await freeSlot({ durationMinutes: 30, swimmers: [{ ageMonths: 60, level: "beginner" }], from: 8 });
    const r = await checkout.createBookingCheckout(EMILY, { address: addr.emily, durationMinutes: 30, childIds: [kids.lucas], instructorId: null, plan: { kind: "single" }, start });
    if (r.kind !== "redirect") throw new Error("expected redirect");
    // Reuse another payment's session id → unique violation on update.
    await expect(
      checkout.fulfillPayment({ paymentId: r.paymentId, sessionId: "dev_cs_pkg", paymentIntentId: "dev_pi_conflict", amountTotal: null, receiptUrl: null, chargeId: null }),
    ).rejects.toThrow(/could not update payment/);
    expect((await db.query("select status from public.payments where id = $1", [r.paymentId])).rows[0].status).toBe("pending");
    await checkout.releaseCheckout(r.paymentId);
  });

  it("Stripe events: paid sessions fulfill once (duplicates ignored); expired sessions release the hold", async () => {
    const { handleStripeEvent } = await import("@/lib/payments/webhook");
    const mk = async (from: number) => {
      const { start } = await freeSlot({ durationMinutes: 30, swimmers: [{ ageMonths: 60, level: "beginner" }], from });
      const r = await checkout.createBookingCheckout(EMILY, { address: addr.emily, durationMinutes: 30, childIds: [kids.lucas], instructorId: null, plan: { kind: "single" }, start });
      if (r.kind !== "redirect") throw new Error("expected redirect");
      return r;
    };
    const event = (id: string, type: string, paymentId: string) =>
      ({ id, type, object: "event", data: { object: { id: `dev_cs_${paymentId}`, payment_status: "paid", metadata: { payment_id: paymentId } } } }) as never;

    const paid = await mk(9);
    const evtId = `evt_${paid.paymentId.slice(0, 8)}`;
    expect(await handleStripeEvent(event(evtId, "checkout.session.completed", paid.paymentId))).toEqual({ handled: true });
    expect(await handleStripeEvent(event(evtId, "checkout.session.completed", paid.paymentId))).toEqual({ handled: false, duplicate: true });
    expect((await bookingsFor(paid.paymentId))[0].status).toBe("pending_instructor");

    const abandoned = await mk(11);
    await handleStripeEvent(event(`evt_x_${abandoned.paymentId.slice(0, 8)}`, "checkout.session.expired", abandoned.paymentId));
    expect((await bookingsFor(abandoned.paymentId))[0].status).toBe("expired");
    expect((await db.query("select status from public.payments where id = $1", [abandoned.paymentId])).rows[0].status).toBe("cancelled");
  });

  it("refunds bookings linked only from the payment side (admin-created / imported)", async () => {
    const b = await db.query(
      `insert into public.bookings (parent_id, instructor_id, zone_id, starts_at, ends_at, status, buffer_override)
       values ($1, null, $2, now() + interval '9 days', now() + interval '9 days 1 hour', 'confirmed', true) returning id`,
      [DANIEL, ids.zoneA],
    );
    await db.query("insert into public.booking_pricing (booking_id, total_cents) values ($1, 9000)", [b.rows[0].id]);
    const p = await db.query(
      `insert into public.payments (parent_id, booking_id, amount_cents, status, stripe_payment_intent_id) values ($1, $2, 9000, 'succeeded', 'dev_pi_legacy') returning id`,
      [DANIEL, b.rows[0].id],
    );
    expect(await manage.previewCancellation(DANIEL, b.rows[0].id)).toMatchObject({ onTime: true, refundCents: 9000 });
    await manage.cancelBooking(DANIEL, b.rows[0].id, null);
    expect((await db.query("select status, refunded_cents from public.payments where id = $1", [p.rows[0].id])).rows[0]).toEqual({ status: "refunded", refunded_cents: 9000 });
  });
});
