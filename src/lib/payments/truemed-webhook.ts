import "server-only";
import { fulfillPayment, releaseCheckout } from "@/lib/booking/checkout";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TruemedEvent } from "./truemed";

const FAILED = new Set(["failed", "canceled", "cancelled", "expired", "voided", "declined"]);

/**
 * Apply a verified Truemed payment-session event. Each (session, status) pair is
 * processed once (recorded in stripe_events, which de-duplicates every processor).
 * Only `captured` fulfills; `authorized` waits for capture.
 */
export async function handleTruemedEvent(event: TruemedEvent): Promise<{ handled: boolean; duplicate?: boolean }> {
  const admin = createAdminClient();
  const eventId = `truemed:${event.sessionId}:${event.status}`;
  const { error: dupError } = await admin.from("stripe_events").insert({ id: eventId, type: event.type ?? "truemed.payment_session" });
  if (dupError) {
    if (dupError.code !== "23505") throw new Error(dupError.message);
    const { data } = await admin.from("stripe_events").select("processed_at").eq("id", eventId).single();
    if (data?.processed_at) return { handled: false, duplicate: true };
  }

  const { data: payment } = await admin.from("payments").select("id, amount_cents").eq("processor", "truemed").eq("processor_session_id", event.sessionId).maybeSingle();
  let handled = false;
  const amountMismatch = payment && event.amountCents != null && event.amountCents !== payment.amount_cents;
  if (payment && event.status === "captured" && amountMismatch) {
    // Never book on a capture for a different amount; the hold lapses and the owner reviews it.
    await admin.from("audit_log").insert({
      action: "system.payment_amount_mismatch",
      entity_type: "payment",
      entity_id: payment.id,
      metadata: { processor: "truemed", expected: payment.amount_cents, received: event.amountCents },
    });
    // Don't consume the de-dupe key: a corrected delivery must still apply.
    await admin.from("stripe_events").delete().eq("id", eventId);
    return { handled: false };
  } else if (payment && event.status === "captured") {
    await fulfillPayment({ paymentId: payment.id, sessionId: event.sessionId, paymentIntentId: null, amountTotal: event.amountCents ?? null, receiptUrl: null, chargeId: null });
    handled = true;
  } else if (payment && FAILED.has(event.status)) {
    await releaseCheckout(payment.id);
    handled = true;
  }

  await admin.from("stripe_events").update({ processed_at: new Date().toISOString() }).eq("id", eventId);
  return { handled };
}
