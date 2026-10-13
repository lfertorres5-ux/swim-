import { NextResponse, type NextRequest } from "next/server";
import { handleStripeEvent, verifyStripeEvent } from "@/lib/payments/webhook";

export const dynamic = "force-dynamic";

/**
 * Stripe → app. Configure in the Stripe dashboard (or `stripe listen`) with
 * events: checkout.session.completed, checkout.session.async_payment_succeeded,
 * checkout.session.async_payment_failed, checkout.session.expired, charge.refunded.
 */
export async function POST(request: NextRequest) {
  const raw = await request.text(); // signature is computed over the exact bytes
  let event;
  try {
    event = verifyStripeEvent(raw, request.headers.get("stripe-signature"));
  } catch {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }
  try {
    const result = await handleStripeEvent(event);
    return NextResponse.json({ received: true, ...result });
  } catch (err) {
    console.error("stripe webhook failed", event.type, event.id, err);
    return NextResponse.json({ error: "processing failed" }, { status: 500 }); // Stripe will retry
  }
}
