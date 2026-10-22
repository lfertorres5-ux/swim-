import "server-only";
import Stripe from "stripe";
import { siteUrl } from "@/lib/env";

export type CheckoutParams = {
  paymentId: string;
  customerId: string;
  title: string;
  description: string;
  amountCents: number;
  currency: string;
  successUrl: string;
  cancelUrl: string;
  expiresAt: Date;
  /** Keep the card on file for an opted-in package auto-renewal. */
  saveCard?: boolean;
};

export type CompletedCheckout = {
  sessionId: string;
  paymentId: string | null;
  paid: boolean;
  amountTotal: number | null;
  paymentIntentId: string | null;
  receiptUrl: string | null;
  chargeId: string | null;
  /** The card used, when it was saved for later (auto-renew). */
  paymentMethodId: string | null;
};

export type SavedCardCharge =
  | { ok: true; paymentIntentId: string; chargeId: string | null; receiptUrl: string | null }
  | { ok: false; reason: string };

/**
 * Everything the app needs from a payment processor. Prices are always
 * computed by our pricing engine and sent as a single line item — Stripe never
 * decides the amount.
 */
export interface PaymentsGateway {
  readonly mode: "stripe" | "dev";
  ensureCustomer(parent: { parentId: string; email: string; name: string | null; existingCustomerId: string | null }): Promise<string>;
  createCheckout(params: CheckoutParams): Promise<{ sessionId: string; url: string }>;
  /** Details for a completed Checkout Session (payment intent, receipt). */
  completedCheckout(sessionId: string): Promise<CompletedCheckout>;
  refund(params: { paymentIntentId: string; amountCents: number; idempotencyKey: string; metadata: Record<string, string> }): Promise<{ refundId: string }>;
  billingPortalUrl(customerId: string, returnUrl: string): Promise<string>;
  /** Charge a saved card without the customer present (package auto-renew). Never throws for a declined card. */
  chargeSavedCard(params: { customerId: string; paymentMethodId: string; amountCents: number; currency: string; description: string; idempotencyKey: string; metadata: Record<string, string> }): Promise<SavedCardCharge>;
}

let stripeClient: Stripe | null = null;
export function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  stripeClient ??= new Stripe(key, { appInfo: { name: "swim-platform" } });
  return stripeClient;
}

const stripeGateway: PaymentsGateway = {
  mode: "stripe",

  async ensureCustomer({ parentId, email, name, existingCustomerId }) {
    if (existingCustomerId) return existingCustomerId;
    const customer = await stripe().customers.create(
      { email, name: name ?? undefined, metadata: { parent_id: parentId } },
      { idempotencyKey: `customer-${parentId}` },
    );
    return customer.id;
  },

  async createCheckout(p) {
    const session = await stripe().checkout.sessions.create(
      {
        mode: "payment",
        customer: p.customerId,
        client_reference_id: p.paymentId,
        line_items: [
          {
            quantity: 1,
            price_data: { currency: p.currency, unit_amount: p.amountCents, product_data: { name: p.title, description: p.description.slice(0, 500) } },
          },
        ],
        payment_intent_data: { metadata: { payment_id: p.paymentId }, description: p.title, ...(p.saveCard ? { setup_future_usage: "off_session" as const } : {}) },
        metadata: { payment_id: p.paymentId },
        success_url: p.successUrl,
        cancel_url: p.cancelUrl,
        expires_at: Math.floor(p.expiresAt.getTime() / 1000),
      },
      { idempotencyKey: `checkout-${p.paymentId}` },
    );
    if (!session.url) throw new Error("Stripe did not return a Checkout URL");
    return { sessionId: session.id, url: session.url };
  },

  async completedCheckout(sessionId) {
    const session = await stripe().checkout.sessions.retrieve(sessionId, { expand: ["payment_intent.latest_charge"] });
    const intent = typeof session.payment_intent === "object" ? session.payment_intent : null;
    const charge = intent && typeof intent.latest_charge === "object" ? intent.latest_charge : null;
    return {
      sessionId: session.id,
      paymentId: session.metadata?.payment_id ?? session.client_reference_id ?? null,
      paid: session.payment_status === "paid",
      amountTotal: session.amount_total,
      paymentIntentId: intent?.id ?? (typeof session.payment_intent === "string" ? session.payment_intent : null),
      receiptUrl: charge?.receipt_url ?? null,
      chargeId: charge?.id ?? null,
      paymentMethodId: intent?.setup_future_usage === "off_session" && typeof intent.payment_method === "string" ? intent.payment_method : null,
    };
  },

  async chargeSavedCard(p) {
    try {
      const intent = await stripe().paymentIntents.create(
        {
          amount: p.amountCents,
          currency: p.currency,
          customer: p.customerId,
          payment_method: p.paymentMethodId,
          off_session: true,
          confirm: true,
          description: p.description,
          metadata: p.metadata,
          expand: ["latest_charge"],
        },
        { idempotencyKey: p.idempotencyKey },
      );
      if (intent.status !== "succeeded") return { ok: false, reason: `Payment ${intent.status.replaceAll("_", " ")}` };
      const charge = typeof intent.latest_charge === "object" ? intent.latest_charge : null;
      return { ok: true, paymentIntentId: intent.id, chargeId: charge?.id ?? null, receiptUrl: charge?.receipt_url ?? null };
    } catch (err) {
      // Declines and cards needing the customer present (3-D Secure) land here.
      const e = err as { type?: string; message?: string; code?: string };
      if (e.type === "StripeCardError" || e.code === "authentication_required") return { ok: false, reason: e.message ?? "Card declined" };
      throw err;
    }
  },

  async refund({ paymentIntentId, amountCents, idempotencyKey, metadata }) {
    const refund = await stripe().refunds.create({ payment_intent: paymentIntentId, amount: amountCents, metadata }, { idempotencyKey });
    return { refundId: refund.id };
  },

  async billingPortalUrl(customerId, returnUrl) {
    const session = await stripe().billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
      configuration: process.env.STRIPE_PORTAL_CONFIGURATION_ID || undefined,
    });
    return session.url;
  },
};

/**
 * Local development without Stripe keys (PAYMENTS_DEV_MODE=true). Checkout is
 * a page in this app (/dev/checkout) that simulates payment. Never available in
 * production builds.
 */
const devSessions = new Map<string, { paymentId: string; amountCents: number }>();
const devGateway: PaymentsGateway = {
  mode: "dev",
  async ensureCustomer({ parentId, existingCustomerId }) {
    return existingCustomerId ?? `dev_cus_${parentId.slice(0, 8)}`;
  },
  async createCheckout(p) {
    const sessionId = `dev_cs_${p.paymentId}`;
    devSessions.set(sessionId, { paymentId: p.paymentId, amountCents: p.amountCents });
    return { sessionId, url: `${siteUrl()}/dev/checkout?session=${sessionId}` };
  },
  async completedCheckout(sessionId) {
    const paymentId = sessionId.replace(/^dev_cs_/, "");
    return {
      sessionId,
      paymentId,
      paid: true,
      amountTotal: devSessions.get(sessionId)?.amountCents ?? null,
      paymentIntentId: `dev_pi_${paymentId}`,
      receiptUrl: null,
      chargeId: null,
      paymentMethodId: `dev_pm_${paymentId.slice(0, 8)}`,
    };
  },
  async chargeSavedCard({ paymentMethodId, idempotencyKey }) {
    // Tests use a payment method named "dev_pm_declined" to simulate a decline.
    if (paymentMethodId === "dev_pm_declined") return { ok: false, reason: "Your card was declined." };
    return { ok: true, paymentIntentId: `dev_pi_${idempotencyKey}`, chargeId: null, receiptUrl: null };
  },
  async refund({ idempotencyKey }) {
    return { refundId: `dev_re_${idempotencyKey}` };
  },
  async billingPortalUrl(_customerId, returnUrl) {
    return returnUrl;
  },
};

export function devPaymentsEnabled(): boolean {
  return process.env.PAYMENTS_DEV_MODE === "true" && process.env.NODE_ENV !== "production";
}

export function paymentsGateway(): PaymentsGateway {
  if (process.env.STRIPE_SECRET_KEY) return stripeGateway;
  if (devPaymentsEnabled()) return devGateway;
  throw new Error("Payments are not configured: set STRIPE_SECRET_KEY (or PAYMENTS_DEV_MODE=true for local development).");
}
