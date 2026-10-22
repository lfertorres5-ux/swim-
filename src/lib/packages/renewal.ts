import "server-only";
import { notifyRenewalFailed, notifyRenewalReminder, notifyRenewed, safely } from "@/lib/notifications/events";
import { paymentsGateway } from "@/lib/payments/gateway";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Package auto-renew (opt-in at checkout, card only). Runs from the daily job.
 *
 *  1. When the last lesson of an auto-renew package has been booked, the
 *     renewal is scheduled for after that lesson (at least 3 days out).
 *  2. The family is emailed; the card is never charged until 3 full days
 *     after that email, and never before the last lesson ends.
 *  3. The saved card is charged off-session and the same package (same size,
 *     price, length and swimmers) is added to the account, set to renew again.
 *  4. A declined card turns auto-renew off and tells the family and the owner.
 *
 * Turning auto-renew off (account page) stops all of this at any point before
 * the charge starts.
 */
export const RENEWAL_NOTICE_MS = 3 * 86_400_000;
const DAY_MS = 86_400_000;
const LIVE_LESSON = ["pending_payment", "pending_instructor", "confirmed", "completed", "no_show"];

type Pkg = {
  id: string;
  parent_id: string;
  offering_id: string | null;
  lesson_count: number;
  lessons_remaining: number;
  duration_minutes: number;
  children_count: number;
  zone_id: string | null;
  unit_price_cents: number;
  discount_pct: number;
  total_cents: number;
  renewal_amount_cents: number | null;
  status: string;
  auto_renew_consented_at: string | null;
  renewal_payment_method_id: string | null;
  renewal_charge_at: string | null;
  renewal_reminded_at: string | null;
};

export async function runPackageRenewals(now = Date.now()) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("packages")
    .select(
      "id, parent_id, offering_id, lesson_count, lessons_remaining, duration_minutes, children_count, zone_id, unit_price_cents, discount_pct, total_cents, renewal_amount_cents, status, auto_renew_consented_at, renewal_payment_method_id, renewal_charge_at, renewal_reminded_at",
    )
    .eq("auto_renew", true)
    .is("renewed_to_package_id", null)
    .is("renewal_started_at", null)
    .in("status", ["active", "exhausted"]);
  if (error) throw new Error(error.message);

  const outcome = { scheduled: 0, reminded: 0, renewed: 0, failed: 0 };
  for (const pkg of (data ?? []) as Pkg[]) {
    try {
      const r = await step(pkg, now);
      if (r) outcome[r]++;
    } catch (err) {
      console.error("package renewal failed", pkg.id, err);
    }
  }
  return outcome;
}

async function step(pkg: Pkg, now: number): Promise<keyof Awaited<ReturnType<typeof runPackageRenewals>> | null> {
  const admin = createAdminClient();

  // A lesson was cancelled and its credit came back: nothing to renew yet.
  if (pkg.status === "active") {
    if (pkg.renewal_charge_at || pkg.renewal_reminded_at) {
      await admin.from("packages").update({ renewal_charge_at: null, renewal_reminded_at: null }).eq("id", pkg.id);
    }
    return null;
  }

  const { data: last } = await admin
    .from("bookings")
    .select("ends_at")
    .eq("package_id", pkg.id)
    .in("status", LIVE_LESSON)
    .order("ends_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const lastEnd = last ? Date.parse(last.ends_at) : now;

  if (!pkg.renewal_payment_method_id) {
    await fail(pkg, "no saved card on file");
    return "failed";
  }

  let chargeAt = pkg.renewal_charge_at ? Date.parse(pkg.renewal_charge_at) : null;
  if (chargeAt === null) {
    chargeAt = Math.max(lastEnd, now + RENEWAL_NOTICE_MS);
    await admin.from("packages").update({ renewal_charge_at: new Date(chargeAt).toISOString() }).eq("id", pkg.id);
  }

  if (!pkg.renewal_reminded_at) {
    // The job runs daily, so send the notice on the run before the 3-day mark.
    if (now < chargeAt - RENEWAL_NOTICE_MS - DAY_MS) return pkg.renewal_charge_at ? null : "scheduled";
    const { data: claimed } = await admin
      .from("packages")
      .update({ renewal_reminded_at: new Date(now).toISOString() })
      .eq("id", pkg.id)
      .is("renewal_reminded_at", null)
      .select("id");
    if (!claimed?.length) return null;
    await safely("renewal reminder", () => notifyRenewalReminder(pkg.id, new Date(Math.max(chargeAt!, now + RENEWAL_NOTICE_MS)).toISOString()));
    return "reminded";
  }

  // Charge only after the last lesson and 3 full days after the notice.
  const dueAt = Math.max(chargeAt, lastEnd, Date.parse(pkg.renewal_reminded_at) + RENEWAL_NOTICE_MS);
  if (now < dueAt) return null;
  return renew(pkg, now);
}

async function renew(pkg: Pkg, now: number): Promise<"renewed" | "failed" | null> {
  const admin = createAdminClient();
  const amount = pkg.renewal_amount_cents ?? pkg.total_cents;
  // Claim first so overlapping runs can't charge twice.
  const { data: claimed } = await admin
    .from("packages")
    .update({ renewal_started_at: new Date(now).toISOString() })
    .eq("id", pkg.id)
    .eq("auto_renew", true)
    .is("renewal_started_at", null)
    .select("id");
  if (!claimed?.length) return null;

  const { data: parent } = await admin.from("parents").select("stripe_customer_id").eq("id", pkg.parent_id).single();
  if (!parent?.stripe_customer_id) {
    await fail(pkg, "no saved card on file");
    return "failed";
  }

  const description = `${pkg.lesson_count}-lesson package · ${pkg.duration_minutes} min (auto-renewal)`;
  const { data: next, error: pkgError } = await admin
    .from("packages")
    .insert({
      parent_id: pkg.parent_id,
      offering_id: pkg.offering_id,
      lesson_count: pkg.lesson_count,
      lessons_remaining: pkg.lesson_count,
      duration_minutes: pkg.duration_minutes,
      children_count: pkg.children_count,
      zone_id: pkg.zone_id,
      unit_price_cents: pkg.unit_price_cents,
      discount_pct: pkg.discount_pct,
      total_cents: amount,
      renewal_amount_cents: amount,
      status: "pending_payment",
      auto_renew: true,
      auto_renew_consented_at: pkg.auto_renew_consented_at,
      renewal_payment_method_id: pkg.renewal_payment_method_id,
      renewed_from_package_id: pkg.id,
    })
    .select("id")
    .single();
  const { data: payment, error: payError } = next
    ? await admin
        .from("payments")
        .insert({ parent_id: pkg.parent_id, package_id: next.id, amount_cents: amount, currency: "usd", kind: "package", description, status: "pending" })
        .select("id")
        .single()
    : { data: null, error: null };
  if (!next || !payment) {
    // Couldn't set up the renewal: undo and try again on the next run.
    if (next) await admin.from("packages").delete().eq("id", next.id);
    await admin.from("packages").update({ renewal_started_at: null }).eq("id", pkg.id);
    throw new Error(`renewal setup failed: ${pkgError?.message ?? payError?.message}`);
  }

  let charge;
  try {
    charge = await paymentsGateway().chargeSavedCard({
      customerId: parent.stripe_customer_id,
      paymentMethodId: pkg.renewal_payment_method_id!,
      amountCents: amount,
      currency: "usd",
      description,
      // Same key on any retry, so a renewal can never be charged twice.
      idempotencyKey: `renew-${pkg.id}`,
      metadata: { payment_id: payment.id, package_id: next.id, renewed_from: pkg.id },
    });
  } catch (err) {
    await admin.from("payments").delete().eq("id", payment.id);
    await admin.from("packages").delete().eq("id", next.id);
    await admin.from("packages").update({ renewal_started_at: null }).eq("id", pkg.id);
    throw err;
  }

  if (!charge.ok) {
    await admin.from("payments").update({ status: "failed" }).eq("id", payment.id);
    await admin.from("packages").update({ status: "expired" }).eq("id", next.id);
    await fail(pkg, charge.reason);
    return "failed";
  }

  const { data: offering } = pkg.offering_id ? await admin.from("package_offerings").select("validity_days").eq("id", pkg.offering_id).maybeSingle() : { data: null };
  const validity = offering?.validity_days ?? 180;
  await admin
    .from("payments")
    .update({ status: "succeeded", stripe_payment_intent_id: charge.paymentIntentId, stripe_charge_id: charge.chargeId, receipt_url: charge.receiptUrl })
    .eq("id", payment.id);
  await admin
    .from("packages")
    .update({ status: "active", purchased_at: new Date(now).toISOString(), expires_at: new Date(now + validity * DAY_MS).toISOString() })
    .eq("id", next.id);
  await admin.from("packages").update({ renewed_to_package_id: next.id }).eq("id", pkg.id);
  await admin.from("audit_log").insert({
    action: "package.auto_renewed",
    entity_type: "package",
    entity_id: next.id,
    metadata: { renewed_from: pkg.id, payment_id: payment.id, amount_cents: amount },
  });
  await safely("package renewed", () => notifyRenewed(next.id, charge.receiptUrl));
  return "renewed";
}

async function fail(pkg: Pkg, reason: string) {
  const admin = createAdminClient();
  await admin
    .from("packages")
    .update({ auto_renew: false, renewal_failed_at: new Date().toISOString(), renewal_failure: reason.slice(0, 300) })
    .eq("id", pkg.id);
  await admin.from("audit_log").insert({ action: "package.auto_renew_failed", entity_type: "package", entity_id: pkg.id, metadata: { reason } });
  await safely("renewal failed", () => notifyRenewalFailed(pkg.id, reason));
}

/** Parent turns auto-renew on or off for one of their packages. */
export async function setAutoRenew(parentId: string, packageId: string, on: boolean, now = Date.now()) {
  const admin = createAdminClient();
  const { data: pkg } = await admin
    .from("packages")
    .select("id, parent_id, renewal_payment_method_id, renewal_started_at, renewed_to_package_id, status")
    .eq("id", packageId)
    .eq("parent_id", parentId)
    .maybeSingle();
  if (!pkg) return { ok: false as const, error: "Package not found." };
  if (pkg.renewal_started_at || pkg.renewed_to_package_id) return { ok: false as const, error: "This package has already renewed." };
  if (on && !pkg.renewal_payment_method_id) return { ok: false as const, error: "Auto-renew needs a card saved at checkout. Buy your next package with auto-renew ticked." };
  if (on && !["active", "exhausted"].includes(pkg.status)) return { ok: false as const, error: "This package can't renew." };

  await admin
    .from("packages")
    .update(
      on
        ? { auto_renew: true, auto_renew_consented_at: new Date(now).toISOString(), renewal_failed_at: null, renewal_failure: null }
        : { auto_renew: false, renewal_charge_at: null, renewal_reminded_at: null },
    )
    .eq("id", packageId)
    .eq("parent_id", parentId)
    .is("renewal_started_at", null);
  await admin.from("audit_log").insert({
    actor_id: parentId,
    actor_role: "parent",
    action: on ? "package.auto_renew_on" : "package.auto_renew_off",
    entity_type: "package",
    entity_id: packageId,
  });
  return { ok: true as const };
}
