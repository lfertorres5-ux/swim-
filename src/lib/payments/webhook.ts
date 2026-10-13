import "server-only";
import type Stripe from "stripe";
import { fulfillPayment, releaseCheckout } from "@/lib/booking/checkout";
import { createAdminClient } from "@/lib/supabase/admin";
import { paymentsGateway, stripe } from "./gateway";

/** Verify a Stripe webhook signature against the raw body. Throws on mismatch. */
export function verifyStripeEvent(rawBody: string, signature: string | null): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not set");
  if (!signature) throw new Error("missing stripe-signature header");
  return stripe().webhooks.constructEvent(rawBody, signature, secret);
}

/**
 * Apply a verified Stripe event. Each event id is processed once
 * (public.stripe_events); handlers are idempotent besides.
 */
export async function handleStripeEvent(event: Stripe.Event): Promise<{ handled: boolean; duplicate?: boolean }> {
  const admin = createAdminClient();
  const { error: dupError } = await admin.from("stripe_events").insert({ id: event.id, type: event.type });
  if (dupError) {
    if (dupError.code === "23505") {
      const { data } = await admin.from("stripe_events").select("processed_at").eq("id", event.id).single();
      if (data?.processed_at) return { handled: false, duplicate: true };
      // Seen but not finished (previous attempt crashed) — process again.
    } else {
      throw new Error(dupError.message);
    }
  }

  let handled = true;
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.payment_status !== "paid") break; // async methods settle later
      const details = await paymentsGateway().completedCheckout(session.id);
      if (details.paymentId) await fulfillPayment({ ...details, paymentId: details.paymentId });
      break;
    }
    case "checkout.session.expired":
    case "checkout.session.async_payment_failed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const paymentId = session.metadata?.payment_id ?? session.client_reference_id;
      if (paymentId) await releaseCheckout(paymentId);
      if (event.type === "checkout.session.async_payment_failed" && paymentId) {
        await admin.from("payments").update({ status: "failed" }).eq("id", paymentId);
      }
      break;
    }
    case "charge.refunded": {
      // Keep refunds issued from the Stripe dashboard in sync.
      const charge = event.data.object as Stripe.Charge;
      const intent = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
      if (intent) {
        await admin
          .from("payments")
          .update({ refunded_cents: charge.amount_refunded, status: charge.refunded ? "refunded" : "partially_refunded" })
          .eq("stripe_payment_intent_id", intent);
      }
      break;
    }
    default:
      handled = false;
  }

  await admin.from("stripe_events").update({ processed_at: new Date().toISOString() }).eq("id", event.id);
  return { handled };
}
