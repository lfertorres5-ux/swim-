import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { paymentsGateway } from "./gateway";

export class RefundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RefundError";
  }
}

/**
 * Refund part or all of a succeeded payment through the processor and record
 * it. `idempotencyKey` makes a retried request refund once. Returns the amount
 * actually refunded (capped at what's left on the payment).
 */
export async function refundPayment(paymentId: string, amountCents: number, idempotencyKey: string, metadata: Record<string, string> = {}) {
  const admin = createAdminClient();
  const { data: payment } = await admin.from("payments").select("id, status, amount_cents, refunded_cents, stripe_payment_intent_id, stripe_refund_ids").eq("id", paymentId).single();
  if (!payment || !["succeeded", "partially_refunded"].includes(payment.status)) throw new RefundError("This payment can't be refunded.");
  if (!payment.stripe_payment_intent_id) throw new RefundError("This payment wasn't made by card in the app, so there's nothing to refund through Stripe.");
  const amount = Math.min(Math.round(amountCents), payment.amount_cents - payment.refunded_cents);
  if (amount <= 0) return { refundedCents: 0, refundId: null as string | null };

  const refund = await paymentsGateway().refund({ paymentIntentId: payment.stripe_payment_intent_id, amountCents: amount, idempotencyKey, metadata: { payment_id: payment.id, ...metadata } });
  const refunded = payment.refunded_cents + amount;
  const { error } = await admin
    .from("payments")
    .update({
      refunded_cents: refunded,
      status: refunded >= payment.amount_cents ? "refunded" : "partially_refunded",
      stripe_refund_ids: [...(payment.stripe_refund_ids ?? []), refund.refundId],
    })
    .eq("id", payment.id);
  if (error) throw new Error(`refund ${refund.refundId} issued but not recorded: ${error.message}`);
  return { refundedCents: amount, refundId: refund.refundId as string | null };
}
