import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, laDateString, laWallTimeToUtc } from "@/lib/time";
import { clientAs, configureServerEnv, enabled, ids } from "./setup";

/**
 * The owner's day-to-day tools through the real API: manual bookings (comp,
 * payment link, paid offline), refunds, cancellations, reassignment, the sub
 * board end to end, and day-pass inquiries — with the notifications each sends.
 */
const db = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
const ADMIN = "00000000-0000-4000-a000-000000000001";
const LUCAS = "00000000-0000-4000-c000-000000000001";

let adminBookings: typeof import("@/lib/admin/bookings");
let subBoard: typeof import("@/lib/sub-board");
let dayPass: typeof import("@/lib/day-pass");
let checkout: typeof import("@/lib/booking/checkout");

beforeAll(async () => {
  configureServerEnv();
  process.env.PAYMENTS_DEV_MODE = "true";
  process.env.ADMIN_ALERT_EMAIL = "owner@example.com";
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.RESEND_API_KEY;
  delete process.env.TWILIO_ACCOUNT_SID;
  adminBookings = await import("@/lib/admin/bookings");
  subBoard = await import("@/lib/sub-board");
  dayPass = await import("@/lib/day-pass");
  checkout = await import("@/lib/booking/checkout");
});
afterAll(() => db.end());

const messages = async (where: string, params: unknown[]) =>
  (await db.query(`select template, channel, to_address, subject, body_text from public.notifications where ${where} order by created_at`, params)).rows;
/** An early-morning start `days` out — outside everyone's seeded lessons. */
const earlyStart = (days: number, hour = 6) => new Date(laWallTimeToUtc(addDays(laDateString(), days), hour * 60)).toISOString();

describe.skipIf(!enabled)("manual bookings", () => {
  let compId: string;

  it("comp booking: confirmed with the chosen instructor at the family's address; both sides hear about it", async () => {
    const r = await adminBookings.createManualBooking(ADMIN, { parentId: ids.emily, childIds: [LUCAS], instructorId: ids.maya, start: earlyStart(11), durationMinutes: 60, payment: { kind: "comp" } });
    compId = r.bookingId;
    const { rows } = await db.query(
      "select b.status, b.kind, b.source, b.instructor_id, b.created_by, l.address_line1, l.postal_code, p.total_cents from public.bookings b join public.booking_locations l on l.booking_id = b.id join public.booking_pricing p on p.booking_id = b.id where b.id = $1",
      [compId],
    );
    expect(rows[0]).toMatchObject({ status: "confirmed", kind: "manual", source: "admin", instructor_id: ids.maya, created_by: ADMIN, address_line1: "742 Neptune Ave", postal_code: "92024", total_cents: 0 });
    const t = (await messages("booking_id = $1", [compId])).map((m) => `${m.template}:${m.to_address}`);
    expect(t).toContain("parent.booking_confirmed:emily@example.com");
    expect(t).toContain("instructor.shift_filled:maya@example.com");
    const audit = await db.query("select actor_id, actor_role from public.audit_log where action = 'admin.create_booking' and entity_id = $1", [compId]);
    expect(audit.rows[0]).toEqual({ actor_id: ADMIN, actor_role: "admin" });
  });

  it("refuses to double-book; 'ignore travel buffer' allows back-to-back but never an overlap", async () => {
    const overlap = adminBookings.createManualBooking(ADMIN, { parentId: ids.marcus, childIds: [ids.childEli], instructorId: ids.maya, start: earlyStart(11), durationMinutes: 30, payment: { kind: "comp" }, notify: false });
    await expect(overlap).rejects.toThrow(/already has a lesson|too close/);
    const backToBack = { parentId: ids.marcus, childIds: [ids.childEli], instructorId: ids.maya, start: earlyStart(11, 7), durationMinutes: 30, payment: { kind: "comp" as const }, notify: false };
    await expect(adminBookings.createManualBooking(ADMIN, backToBack)).rejects.toThrow(/travel buffer/);
    const ok = await adminBookings.createManualBooking(ADMIN, { ...backToBack, ignoreBuffer: true });
    expect(ok.bookingId).toBeTruthy();
    await expect(adminBookings.createManualBooking(ADMIN, { ...backToBack, start: earlyStart(11, 6.5), ignoreBuffer: true })).rejects.toThrow(/already has a lesson/);
  });

  it("refuses an address outside San Diego County", async () => {
    await expect(
      adminBookings.createManualBooking(ADMIN, { parentId: ids.emily, childIds: [LUCAS], instructorId: ids.maya, start: earlyStart(12), durationMinutes: 60, payment: { kind: "comp" }, address: { line1: "1 Main St", city: "Temecula", postalCode: "92590" } }),
    ).rejects.toThrow(/San Diego County/);
  });

  it("payment link: standard price, emailed; paying it doesn't disturb the confirmed booking", async () => {
    const r = await adminBookings.createManualBooking(ADMIN, { parentId: ids.emily, childIds: [LUCAS], instructorId: ids.jordan, start: earlyStart(13), durationMinutes: 60, payment: { kind: "link" } });
    expect(r.amountCents).toBe(9000);
    expect(r.paymentUrl).toMatch(/\/dev\/checkout\?session=dev_cs_/);
    const { rows } = await db.query("select b.status, p.id, p.status as pay_status, p.amount_cents from public.bookings b join public.payments p on p.id = b.payment_id where b.id = $1", [r.bookingId]);
    expect(rows[0]).toMatchObject({ status: "confirmed", pay_status: "pending", amount_cents: 9000 });
    const req = (await messages("booking_id = $1 and template = 'parent.payment_request' and channel = 'email'", [r.bookingId]))[0];
    expect(req.body_text).toContain("The total is $90");
    expect(req.body_text).toContain(r.paymentUrl!);

    await checkout.fulfillPayment({ paymentId: rows[0].id, sessionId: `dev_cs_${rows[0].id}`, paymentIntentId: `dev_pi_${rows[0].id}`, amountTotal: 9000, receiptUrl: null, chargeId: null });
    const after = await db.query("select b.status, b.instructor_id, p.status as pay_status from public.bookings b join public.payments p on p.id = b.payment_id where b.id = $1", [r.bookingId]);
    expect(after.rows[0]).toEqual({ status: "confirmed", instructor_id: ids.jordan, pay_status: "succeeded" });
  });

  it("paid offline: recorded as a succeeded payment with the note", async () => {
    const r = await adminBookings.createManualBooking(ADMIN, { parentId: ids.emily, childIds: [LUCAS], instructorId: ids.jordan, start: earlyStart(14), durationMinutes: 30, payment: { kind: "offline", amountCents: 6500, note: "Check #1042" }, notify: false });
    const { rows } = await db.query("select p.status, p.amount_cents, p.description from public.bookings b join public.payments p on p.id = b.payment_id where b.id = $1", [r.bookingId]);
    expect(rows[0]).toEqual({ status: "succeeded", amount_cents: 6500, description: "Recorded by owner: Check #1042" });
  });

  it("reassign: the family meets the new instructor; the old one hears it's off their schedule", async () => {
    await adminBookings.adminReassign(ADMIN, compId, ids.sofia, { ignoreBuffer: false, notify: true });
    expect((await db.query("select instructor_id, status from public.bookings where id = $1", [compId])).rows[0]).toEqual({ instructor_id: ids.sofia, status: "confirmed" });
    const t = (await messages("booking_id = $1", [compId])).map((m) => `${m.template}:${m.to_address}`);
    expect(t).toContain("parent.instructor_changed:emily@example.com");
    expect(t).toContain("instructor.shift_filled:sofia@example.com");
    expect(t).toContain("instructor.booking_cancelled:maya@example.com");
    const changed = (await messages("booking_id = $1 and template = 'parent.instructor_changed' and channel = 'email'", [compId]))[0];
    expect(changed.body_text).toContain("Maya can't make it, so Sofia will teach Lucas");
  });
});

describe.skipIf(!enabled)("refunds and cancellations", () => {
  let bookingId: string;
  let paymentId: string;

  beforeAll(async () => {
    const r = await adminBookings.createManualBooking(ADMIN, { parentId: ids.marcus, childIds: [ids.childEli], instructorId: ids.jordan, start: earlyStart(16), durationMinutes: 60, payment: { kind: "link", amountCents: 9000 }, notify: false });
    bookingId = r.bookingId;
    paymentId = (await db.query("select payment_id from public.bookings where id = $1", [bookingId])).rows[0].payment_id;
    await checkout.fulfillPayment({ paymentId, sessionId: `dev_cs_${paymentId}`, paymentIntentId: `dev_pi_${paymentId}`, amountTotal: 9000, receiptUrl: null, chargeId: null });
  });

  it("partial refund, then a second refund capped at what's left", async () => {
    expect((await adminBookings.adminRefund(ADMIN, paymentId, 2500, "Late start")).refundedCents).toBe(2500);
    let p = (await db.query("select status, refunded_cents, array_length(stripe_refund_ids, 1) as n from public.payments where id = $1", [paymentId])).rows[0];
    expect(p).toEqual({ status: "partially_refunded", refunded_cents: 2500, n: 1 });
    const preview = await adminBookings.adminCancellationPreview(bookingId);
    expect(preview).toMatchObject({ onTime: true, paidCents: 9000, refundableCents: 6500, refundCents: 6500 });

    expect((await adminBookings.adminRefund(ADMIN, paymentId, 10_000, null)).refundedCents).toBe(6500);
    p = (await db.query("select status, refunded_cents from public.payments where id = $1", [paymentId])).rows[0];
    expect(p).toEqual({ status: "refunded", refunded_cents: 9000 });
    await expect(adminBookings.adminRefund(ADMIN, paymentId, 100, null)).rejects.toThrow(/can't be refunded/);
    const audit = await db.query("select metadata->>'amount_cents' as amt from public.audit_log where action = 'admin.refund' and entity_id = $1 order by id", [paymentId]);
    expect(audit.rows.map((r) => r.amt)).toEqual(["2500", "6500"]);
  });

  it("owner cancels with the refund they choose; the family is told", async () => {
    const r = await adminBookings.createManualBooking(ADMIN, { parentId: ids.marcus, childIds: [ids.childEli], instructorId: ids.jordan, start: earlyStart(17), durationMinutes: 60, payment: { kind: "link", amountCents: 9000 }, notify: false });
    const pid = (await db.query("select payment_id from public.bookings where id = $1", [r.bookingId])).rows[0].payment_id;
    await checkout.fulfillPayment({ paymentId: pid, sessionId: `dev_cs_${pid}`, paymentIntentId: `dev_pi_${pid}`, amountTotal: 9000, receiptUrl: null, chargeId: null });

    const out = await adminBookings.adminCancelBooking(ADMIN, r.bookingId, { refundCents: 4500, restoreCredit: false, reason: "Pool closed", notify: true });
    expect(out.refundedCents).toBe(4500);
    expect((await db.query("select status, cancelled_by, cancellation_reason from public.bookings where id = $1", [r.bookingId])).rows[0]).toEqual({ status: "cancelled", cancelled_by: ADMIN, cancellation_reason: "Pool closed" });
    const fam = (await messages("booking_id = $1 and template = 'parent.booking_cancelled' and channel = 'email'", [r.bookingId]))[0];
    expect(fam.body_text).toContain("refunded $45");
    await expect(adminBookings.adminCancelBooking(ADMIN, r.bookingId, { refundCents: 0, restoreCredit: false, reason: null, notify: false })).rejects.toThrow(/Only upcoming/);
  });
});

describe.skipIf(!enabled)("sub board, end to end", () => {
  it("Tyler's posted lesson: Jordan claims → owner gets an alert → approve → everyone hears", async () => {
    const { rows } = await db.query("select id, booking_id from public.open_shifts where released_by = $1 and status = 'open'", [ids.tyler]);
    const shift = rows[0];
    const jordan = clientAs(ids.jordan);
    const { data: board } = await jordan.rpc("sub_board_shifts");
    expect(board.find((b: { id: string }) => b.id === shift.id)?.can_claim).toBe(true);

    const claim = await subBoard.claimShift(jordan, shift.id);
    expect(claim).toEqual({ ok: true, value: "pending_approval" });
    const alert = (await messages("template = 'admin.shift_approval' and booking_id = $1", [shift.booking_id]))[0];
    expect(alert.to_address).toBe("owner@example.com");
    expect(alert.subject).toMatch(/^Approve sub: Jordan for Tyler/);

    // Only an admin can decide.
    expect((await subBoard.decideShift(jordan, shift.id, true, null)).ok).toBe(false);
    expect(await subBoard.decideShift(clientAs(ADMIN), shift.id, true, null)).toEqual({ ok: true, value: undefined });

    expect((await db.query("select instructor_id from public.bookings where id = $1", [shift.booking_id])).rows[0].instructor_id).toBe(ids.jordan);
    const t = await messages("booking_id = $1 and channel = 'email'", [shift.booking_id]);
    const family = t.find((m) => m.template === "parent.instructor_changed")!;
    expect(family.body_text).toContain("Tyler can't make it, so Jordan will teach");
    expect(t.find((m) => m.template === "instructor.shift_filled")?.to_address).toBe("jordan@example.com");
    expect(t.find((m) => m.template === "instructor.shift_covered")?.body_text).toContain("Jordan is teaching");
    // Messages to instructors never carry the family's surname, email or street address.
    for (const m of t.filter((x) => x.template.startsWith("instructor."))) {
      const { rows: fam } = await db.query("select u.last_name, u.email, l.address_line1 from public.bookings b join public.users u on u.id = b.parent_id join public.booking_locations l on l.booking_id = b.id where b.id = $1", [shift.booking_id]);
      for (const secret of Object.values(fam[0]).filter(Boolean)) expect(m.body_text).not.toContain(secret);
    }
  });

  it("posting a lesson tells every free, qualified instructor in the zone", async () => {
    const r = await adminBookings.createManualBooking(ADMIN, { parentId: ids.emily, childIds: [LUCAS], instructorId: ids.maya, start: earlyStart(18, 8), durationMinutes: 60, payment: { kind: "comp" }, notify: false });
    const posted = await subBoard.releaseLesson(clientAs(ids.maya), r.bookingId, "Family wedding");
    expect(posted.ok).toBe(true);
    if (!posted.ok) return;
    const t = await messages("template = 'instructor.shift_available' and channel = 'email' and dedupe_key like $1", [`shift:${posted.value}:%`]);
    const to = t.map((m) => m.to_address).sort();
    expect(to).not.toContain("maya@example.com");
    expect(to.length).toBeGreaterThan(0);
    expect(t[0].body_text).not.toContain("Lucas");
    expect(t[0].body_text).toMatch(/\d+-year-old/);

    // Withdraw → nobody can claim it any more.
    expect((await subBoard.withdrawShift(clientAs(ids.maya), posted.value)).ok).toBe(true);
    expect((await subBoard.claimShift(clientAs(ids.jordan), posted.value)).ok).toBe(false);
  });
});

describe.skipIf(!enabled)("day pass inquiries", () => {
  const base = { contactName: "Rosa Diaz", contactEmail: "rosa.diaz@example.com", adults: 2, children: 2, preferredDates: [addDays(laDateString(), 10)], interestLevel: "ready_to_book" as const, message: "Birthday!" };

  it("saves the inquiry and alerts the owner; a signed-out visitor's typed email gets nothing automatic", async () => {
    const r = await dayPass.submitDayPassInquiry({ ...base, contactEmail: "Rosa.Diaz@example.com" }, null);
    expect(r.ok).toBe(true);
    if (!r.ok || !r.id) return;
    const { rows } = await db.query("select contact_email, adults_count, children_count, interest_level, status from public.day_pass_inquiries where id = $1", [r.id]);
    expect(rows[0]).toEqual({ contact_email: "rosa.diaz@example.com", adults_count: 2, children_count: 2, interest_level: "ready_to_book", status: "new" });
    const t = (await messages("dedupe_key like $1", [`daypass:${r.id}:%`])).map((m) => `${m.template}:${m.to_address}`);
    expect(t).toEqual(["admin.day_pass_inquiry:owner@example.com"]);
  });

  it("a signed-in parent using their own account email gets the thank-you", async () => {
    const { rows } = await db.query("select id from public.users where email = 'emily@example.com'");
    const r = await dayPass.submitDayPassInquiry({ ...base, contactName: "Emily", contactEmail: "emily@example.com" }, rows[0].id);
    if (!r.ok || !r.id) throw new Error("expected ok");
    const t = (await messages("dedupe_key like $1", [`daypass:${r.id}:%`])).map((m) => `${m.template}:${m.to_address}`);
    expect(t).toEqual(expect.arrayContaining(["parent.day_pass_received:emily@example.com", "admin.day_pass_inquiry:owner@example.com"]));
  });

  it("one network can't flood the form with different emails", async () => {
    const opts = { clientKey: "test-client-key" };
    for (let i = 0; i < 5; i++) expect((await dayPass.submitDayPassInquiry({ ...base, contactEmail: `flood${i}@example.com` }, null, opts)).ok).toBe(true);
    expect(await dayPass.submitDayPassInquiry({ ...base, contactEmail: "flood5@example.com" }, null, opts)).toEqual({ ok: false, error: expect.stringMatching(/already have your inquiry/) });
    expect((await dayPass.submitDayPassInquiry({ ...base, contactEmail: "flood5@example.com" }, null, { clientKey: "someone-else" })).ok).toBe(true);
  });

  it("bots (honeypot) are silently dropped; the same email is limited per day", async () => {
    const before = (await db.query("select count(*)::int as n from public.day_pass_inquiries")).rows[0].n;
    expect(await dayPass.submitDayPassInquiry({ ...base, website: "http://spam" }, null)).toEqual({ ok: true, id: null });
    expect((await db.query("select count(*)::int as n from public.day_pass_inquiries")).rows[0].n).toBe(before);

    await dayPass.submitDayPassInquiry(base, null);
    await dayPass.submitDayPassInquiry(base, null);
    const fourth = await dayPass.submitDayPassInquiry(base, null);
    expect(fourth).toEqual({ ok: false, error: expect.stringMatching(/already have your inquiry/) });
  });

  it("rejects past dates, nobody coming, and works only while enabled", async () => {
    expect((await dayPass.submitDayPassInquiry({ ...base, contactEmail: "a@example.com", preferredDates: ["2020-01-01"] }, null)).ok).toBe(false);
    expect((await dayPass.submitDayPassInquiry({ ...base, contactEmail: "b@example.com", adults: 0, children: 0 }, null)).ok).toBe(false);
    await db.query("update public.platform_settings set day_pass_enabled = false");
    try {
      expect(await dayPass.submitDayPassInquiry({ ...base, contactEmail: "c@example.com" }, null)).toEqual({ ok: false, error: expect.stringMatching(/paused/) });
    } finally {
      await db.query("update public.platform_settings set day_pass_enabled = true");
    }
  });

  it("owner quotes and sends the Stripe payment link", async () => {
    const { rows } = await db.query("select id from public.day_pass_inquiries where contact_email = 'priya@example.com'");
    const id = rows[0].id;
    await db.query("update public.platform_settings set partner_club_name = 'Rancho Santa Fe Golf Club'");
    const r = await dayPass.updateInquiry(ADMIN, { id, status: "approved", quotedAmountCents: 18000, paymentLinkUrl: "https://buy.stripe.com/test_abc", adminNotes: "Club OK'd the 12th", sendLink: true, messageToFamily: "Lunch is included." });
    expect(r.status).toBe("payment_link_sent");
    const q = (await db.query("select status, quoted_amount_cents, handled_by from public.day_pass_inquiries where id = $1", [id])).rows[0];
    expect(q).toEqual({ status: "payment_link_sent", quoted_amount_cents: 18000, handled_by: ADMIN });
    const email = (await messages("template = 'parent.day_pass_payment_link' and to_address = 'priya@example.com'", []))[0];
    expect(email.subject).toBe("Your Rancho Santa Fe Golf Club day pass: $180");
    expect(email.body_text).toContain("https://buy.stripe.com/test_abc");
    expect(email.body_text).toContain("Lunch is included.");
    await expect(dayPass.updateInquiry(ADMIN, { id, status: "approved", quotedAmountCents: null, paymentLinkUrl: null, adminNotes: null, sendLink: true })).rejects.toThrow(/payment link first/);
  });
});
