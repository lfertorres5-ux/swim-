import Stripe from "stripe";
import { beforeAll, describe, expect, it } from "vitest";

const SECRET = "whsec_test_secret";
let verify: typeof import("./webhook").verifyStripeEvent;

beforeAll(async () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_dummy_not_used_for_network";
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  ({ verifyStripeEvent: verify } = await import("./webhook"));
});

const payload = JSON.stringify({ id: "evt_1", object: "event", type: "checkout.session.completed", data: { object: { id: "cs_1", payment_status: "paid", metadata: { payment_id: "p1" } } } });
const sign = (body: string, secret = SECRET) => new Stripe("sk_test_x").webhooks.generateTestHeaderString({ payload: body, secret });

describe("Stripe webhook signature", () => {
  it("accepts a correctly signed payload", () => {
    expect(verify(payload, sign(payload)).id).toBe("evt_1");
  });

  it("rejects a tampered body, a wrong secret, or no signature", () => {
    expect(() => verify(payload.replace("paid", "unpaid"), sign(payload))).toThrow();
    expect(() => verify(payload, sign(payload, "whsec_other"))).toThrow();
    expect(() => verify(payload, null)).toThrow(/missing/);
  });
});
