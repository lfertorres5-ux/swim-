import "server-only";
import { timingSafeEqual } from "node:crypto";

/**
 * Truemed — HSA/FSA payments. Hosted flow:
 *   1. create a payment session (POST /payments/v1/create_payment_session)
 *   2. send the family to its `redirect_url` (eligibility survey + HSA/FSA card)
 *   3. Truemed calls our webhook with `payment_session_complete`; we fulfill
 *      only when the status is `captured` (never from the success redirect).
 * Truemed is the merchant of record for these payments.
 *
 * Field names follow docs.truemed.com (payment sessions). Confirm them in the
 * Truemed sandbox (TRUEMED_SANDBOX=true) before going live — see docs/hsa-fsa.md.
 */

export function truemedConfigured(): boolean {
  return Boolean(process.env.TRUEMED_API_KEY);
}

function baseUrl() {
  if (process.env.TRUEMED_API_BASE) return process.env.TRUEMED_API_BASE.replace(/\/$/, "");
  return process.env.TRUEMED_SANDBOX === "true" ? "https://dev-api.truemed.com" : "https://api.truemed.com";
}

export type TruemedItem = { id: string; name: string; amountCents: number; quantity: number };

export async function createTruemedSession(p: {
  paymentId: string;
  amountCents: number;
  items: TruemedItem[];
  customerEmail: string;
  customerName: string | null;
  successUrl: string;
  failureUrl: string;
}): Promise<{ sessionId: string; url: string }> {
  const key = process.env.TRUEMED_API_KEY;
  if (!key) throw new Error("TRUEMED_API_KEY is not set");
  const res = await fetch(`${baseUrl()}/payments/v1/create_payment_session`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-truemed-api-key": key,
      // Same key on retries for the same cart; a new payment row means a new key.
      "idempotency-key": `swim-${p.paymentId}`,
    },
    body: JSON.stringify({
      total_amount: p.amountCents,
      order_items: p.items.map((i) => ({ item_id: i.id, name: i.name, price: i.amountCents, quantity: i.quantity })),
      customer_email: p.customerEmail,
      customer_name: p.customerName ?? undefined,
      // Truemed swaps in the session id, so the return page can find the payment.
      success_url: p.successUrl,
      failure_url: p.failureUrl,
    }),
  });
  const body = (await res.json().catch(() => null)) as { id?: string; redirect_url?: string; message?: string } | null;
  if (!res.ok || !body?.id || !body.redirect_url) {
    throw new Error(`Truemed create_payment_session failed (${res.status}): ${body?.message ?? "no session returned"}`);
  }
  return { sessionId: body.id, url: body.redirect_url };
}

/** Truemed authenticates webhooks with the x-truemed-api-key header. */
export function verifyTruemedWebhook(headerValue: string | null): boolean {
  const expected = process.env.TRUEMED_WEBHOOK_KEY || process.env.TRUEMED_API_KEY;
  if (!expected || !headerValue) return false;
  const a = Buffer.from(headerValue);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type TruemedEvent = { sessionId: string; status: string; type: string | null };

/** Pull the session id and status out of a webhook body (tolerant of nesting). */
export function parseTruemedEvent(body: unknown): TruemedEvent | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const data = (b.data && typeof b.data === "object" ? b.data : b) as Record<string, unknown>;
  const sessionId = (data.payment_id ?? data.payment_session_id ?? data.id) as string | undefined;
  const status = (data.status ?? data.payment_status) as string | undefined;
  if (!sessionId || !status) return null;
  return { sessionId: String(sessionId), status: String(status).toLowerCase(), type: (b.type ?? b.event ?? b.event_type ?? null) as string | null };
}
