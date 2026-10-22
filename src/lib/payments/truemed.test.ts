import { afterEach, describe, expect, it } from "vitest";
import { parseTruemedEvent, truemedConfigured, verifyTruemedWebhook } from "./truemed";

describe("Truemed webhook helpers", () => {
  afterEach(() => {
    delete process.env.TRUEMED_API_KEY;
    delete process.env.TRUEMED_WEBHOOK_KEY;
  });

  it("accepts only the dedicated webhook key — never the API key", () => {
    expect(verifyTruemedWebhook("anything")).toBe(false); // nothing configured
    process.env.TRUEMED_API_KEY = "tm_live_abc";
    expect(verifyTruemedWebhook("tm_live_abc")).toBe(false);
    process.env.TRUEMED_WEBHOOK_KEY = "whk_separate";
    expect(verifyTruemedWebhook("tm_live_abc")).toBe(false);
    expect(verifyTruemedWebhook("whk_separatf")).toBe(false);
    expect(verifyTruemedWebhook(null)).toBe(false);
    expect(verifyTruemedWebhook("whk_separate")).toBe(true);
  });

  it("HSA/FSA is offered only when both keys are set", () => {
    process.env.TRUEMED_API_KEY = "tm_live_abc";
    expect(truemedConfigured()).toBe(false);
    process.env.TRUEMED_WEBHOOK_KEY = "whk_separate";
    expect(truemedConfigured()).toBe(true);
  });

  it("reads the session id and status, flat or nested", () => {
    expect(parseTruemedEvent({ type: "payment_session_complete", payment_id: "ps_1", status: "CAPTURED" })).toEqual({ sessionId: "ps_1", status: "captured", type: "payment_session_complete", amountCents: null });
    expect(parseTruemedEvent({ event: "payment_session_complete", data: { payment_id: "ps_2", status: "failed" } })).toEqual({ sessionId: "ps_2", status: "failed", type: "payment_session_complete", amountCents: null });
    expect(parseTruemedEvent({ payment_id: "ps_3", status: "captured", total_amount: 9000 })?.amountCents).toBe(9000);
    expect(parseTruemedEvent({ status: "captured" })).toBeNull();
    expect(parseTruemedEvent("nope")).toBeNull();
  });
});
