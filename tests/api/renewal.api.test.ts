import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, laDateString } from "@/lib/time";
import { configureServerEnv, enabled, ids } from "./setup";

/**
 * Package auto-renew: opt-in at checkout, saved card, 3-day notice, renewal
 * after the last lesson, turn-off, and declined cards.
 */
const db = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
const PRIYA = "00000000-0000-4000-a000-000000000203";
const MIA = "00000000-0000-4000-c000-000000000004";
const addr = { line1: "1820 Ocean Bluff Way", city: "Del Mar", postalCode: "92014" };
const DAY = 86_400_000;

let checkout: typeof import("@/lib/booking/checkout");
let renewal: typeof import("@/lib/packages/renewal");
let service: typeof import("@/lib/scheduling/service");

beforeAll(async () => {
  configureServerEnv();
  process.env.PAYMENTS_DEV_MODE = "true";
  process.env.ADMIN_ALERT_EMAIL = "owner@example.com";
  checkout = await import("@/lib/booking/checkout");
  renewal = await import("@/lib/packages/renewal");
  service = await import("@/lib/scheduling/service");
});
afterAll(async () => {
  await db.end();
});

async function slot(fromDays: number) {
  const from = addDays(laDateString(), fromDays);
  const { slots } = await service.getAvailability({ zoneId: ids.zoneA, durationMinutes: 30, swimmers: [{ ageMonths: 50, level: "beginner" }], fromDate: from, toDate: addDays(from, 6) });
  return new Date(slots[0].start).toISOString();
}

const templates = async (like: string) =>
  (await db.query("select template, to_address from public.notifications where dedupe_key like $1 and channel = 'email' order by created_at", [like])).rows.map(
    (r) => `${r.template}:${r.to_address}`,
  );

/** A used-up auto-renew package whose last lesson ended `lastEndedDaysAgo` days ago. */
async function usedUpPackage(opts: { paymentMethod: string; lastEndedDaysAgo: number }) {
  await db.query("update public.parents set stripe_customer_id = coalesce(stripe_customer_id, 'dev_cus_priya') where id = $1", [PRIYA]);
  const { rows } = await db.query(
    `insert into public.packages (parent_id, lesson_count, lessons_remaining, duration_minutes, children_count, zone_id, unit_price_cents, discount_pct, total_cents, status,
                                  purchased_at, auto_renew, auto_renew_consented_at, renewal_amount_cents, renewal_payment_method_id)
     values ($1, 6, 0, 30, 1, $2, 6000, 5, 30000, 'exhausted', now() - interval '60 days', true, now() - interval '60 days', 34200, $3) returning id`,
    [PRIYA, ids.zoneA, opts.paymentMethod],
  );
  const pkgId = rows[0].id as string;
  await db.query(
    `insert into public.bookings (parent_id, zone_id, neighborhood, starts_at, ends_at, status, kind, package_id, children_count)
     values ($1, $2, 'Del Mar', now() - make_interval(days => $3) - interval '30 minutes', now() - make_interval(days => $3), 'completed', 'package', $4, 1)`,
    [PRIYA, ids.zoneA, opts.lastEndedDaysAgo, pkgId],
  );
  return pkgId;
}
const pkgRow = async (id: string) => (await db.query("select * from public.packages where id = $1", [id])).rows[0];

describe.skipIf(!enabled)("package auto-renew", () => {
  it("is opt-in at checkout: consent, regular price and the saved card are recorded only when ticked", async () => {
    const { rows: off } = await db.query("select id from public.package_offerings where lesson_count = 6");
    const plan = { kind: "package" as const, offeringId: off[0].id };

    const optedIn = await checkout.createBookingCheckout(PRIYA, { address: addr, durationMinutes: 30, childIds: [MIA], instructorId: null, plan, start: await slot(30), autoRenew: true });
    if (optedIn.kind !== "redirect") throw new Error("expected redirect");
    await checkout.fulfillPayment({ paymentId: optedIn.paymentId, sessionId: "dev_cs_ar1", paymentIntentId: "dev_pi_ar1", amountTotal: null, receiptUrl: null, chargeId: null, paymentMethodId: "dev_pm_ar1" });
    const { rows: a } = await db.query(
      "select pk.auto_renew, pk.auto_renew_consented_at is not null as consented, pk.renewal_amount_cents, pk.total_cents, pk.renewal_payment_method_id from public.packages pk join public.payments p on p.package_id = pk.id where p.id = $1",
      [optedIn.paymentId],
    );
    expect(a[0]).toMatchObject({ auto_renew: true, consented: true, renewal_payment_method_id: "dev_pm_ar1" });
    expect(a[0].renewal_amount_cents).toBe(a[0].total_cents);

    const notTicked = await checkout.createBookingCheckout(PRIYA, { address: addr, durationMinutes: 30, childIds: [MIA], instructorId: null, plan, start: await slot(37) });
    if (notTicked.kind !== "redirect") throw new Error("expected redirect");
    await checkout.fulfillPayment({ paymentId: notTicked.paymentId, sessionId: "dev_cs_ar2", paymentIntentId: "dev_pi_ar2", amountTotal: null, receiptUrl: null, chargeId: null, paymentMethodId: "dev_pm_ar2" });
    const { rows: b } = await db.query("select pk.auto_renew, pk.renewal_payment_method_id from public.packages pk join public.payments p on p.package_id = pk.id where p.id = $1", [notTicked.paymentId]);
    expect(b[0]).toEqual({ auto_renew: false, renewal_payment_method_id: null });
  });

  it("emails first, charges only 3 full days later, then adds the same package set to renew again", async () => {
    const id = await usedUpPackage({ paymentMethod: "dev_pm_ok", lastEndedDaysAgo: 1 });
    const now = Date.now();

    await renewal.runPackageRenewals(now);
    expect((await pkgRow(id)).renewal_reminded_at).not.toBeNull();
    expect(await templates(`renewal:${id}:%`)).toEqual(["parent.package_renewal_reminder:priya@example.com"]);

    // Two days later: still within the notice period, nothing charged.
    await renewal.runPackageRenewals(now + 2 * DAY);
    expect((await pkgRow(id)).renewed_to_package_id).toBeNull();

    await renewal.runPackageRenewals(now + 3 * DAY + 60_000);
    const old = await pkgRow(id);
    expect(old.renewed_to_package_id).not.toBeNull();
    const next = await pkgRow(old.renewed_to_package_id);
    expect(next).toMatchObject({ status: "active", lesson_count: 6, lessons_remaining: 6, total_cents: 34200, auto_renew: true, renewal_payment_method_id: "dev_pm_ok", renewed_from_package_id: id });
    const pay = (await db.query("select status, amount_cents, stripe_payment_intent_id from public.payments where package_id = $1", [next.id])).rows[0];
    expect(pay).toEqual({ status: "succeeded", amount_cents: 34200, stripe_payment_intent_id: `dev_pi_renew-${id}` });
    expect(await templates(`renewal:${next.id}:%`)).toEqual(["parent.package_renewed:priya@example.com"]);

    // Running again never charges twice.
    await renewal.runPackageRenewals(now + 4 * DAY);
    expect((await db.query("select count(*)::int as n from public.packages where renewed_from_package_id = $1", [id])).rows[0].n).toBe(1);
  });

  it("never charges before the last lesson has happened", async () => {
    const id = await usedUpPackage({ paymentMethod: "dev_pm_ok", lastEndedDaysAgo: -10 }); // last lesson is 10 days away
    const now = Date.now();
    await renewal.runPackageRenewals(now);
    expect((await pkgRow(id)).renewal_reminded_at).toBeNull(); // too early even to remind
    await renewal.runPackageRenewals(now + 7 * DAY);
    expect((await pkgRow(id)).renewal_reminded_at).not.toBeNull();
    await renewal.runPackageRenewals(now + 9 * DAY);
    expect((await pkgRow(id)).renewed_to_package_id).toBeNull();
    await renewal.runPackageRenewals(now + 11 * DAY);
    expect((await pkgRow(id)).renewed_to_package_id).not.toBeNull();
  });

  it("turning it off after the reminder means no charge", async () => {
    const id = await usedUpPackage({ paymentMethod: "dev_pm_ok", lastEndedDaysAgo: 1 });
    const now = Date.now();
    await renewal.runPackageRenewals(now);
    expect((await renewal.setAutoRenew(PRIYA, id, false)).ok).toBe(true);
    await renewal.runPackageRenewals(now + 5 * DAY);
    expect(await pkgRow(id)).toMatchObject({ auto_renew: false, renewed_to_package_id: null, renewal_charge_at: null });
    // Someone else can't switch it back on.
    expect((await renewal.setAutoRenew("00000000-0000-4000-a000-000000000202", id, true)).ok).toBe(false);
  });

  it("a declined card turns auto-renew off and tells the family and the owner", async () => {
    const id = await usedUpPackage({ paymentMethod: "dev_pm_declined", lastEndedDaysAgo: 1 });
    const now = Date.now();
    await renewal.runPackageRenewals(now);
    await renewal.runPackageRenewals(now + 3 * DAY + 60_000);
    const row = await pkgRow(id);
    expect(row).toMatchObject({ auto_renew: false, renewed_to_package_id: null });
    expect(row.renewal_failed_at).not.toBeNull();
    const failed = await db.query("select p.status from public.payments p join public.packages pk on pk.id = p.package_id where pk.renewed_from_package_id = $1", [id]);
    expect(failed.rows.map((r) => r.status)).toEqual(["failed"]);
    expect(await templates(`renewal:${id}:failed%`)).toEqual(expect.arrayContaining(["parent.package_renewal_failed:priya@example.com", "admin.package_renewal_failed:owner@example.com"]));
  });

  it("a cancelled last lesson (credit back) un-schedules the renewal", async () => {
    const id = await usedUpPackage({ paymentMethod: "dev_pm_ok", lastEndedDaysAgo: 1 });
    await db.query("update public.packages set renewal_charge_at = now() + interval '3 days', status = 'active', lessons_remaining = 1 where id = $1", [id]);
    await renewal.runPackageRenewals(Date.now());
    expect(await pkgRow(id)).toMatchObject({ renewal_charge_at: null, renewed_to_package_id: null, auto_renew: true });
  });
});
