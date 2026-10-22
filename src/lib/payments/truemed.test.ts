import { afterEach, describe, expect, it } from "vitest";
import { parseTruemedEvent, verifyTruemedWebhook } from "./truemed";

describe("Truemed webhook helpers", () => {
  afterEach(() => {
    delete process.env.TRUEMED_API_KEY;
    delete process.env.TRUEMED_WEBHOOK_KEY;
  });

  it("accepts only the configured x-truemed-api-key", () => {
    expect(verifyTruemedWebhook("anything")).toBe(false); // nothing configured
    process.env.TRUEMED_API_KEY = "tm_live_abc";
    expect(verifyTruemedWebhook("tm_live_abc")).toBe(true);
    expect(verifyTruemedWebhook("tm_live_abd")).toBe(false);
    expect(verifyTruemedWebhook(null)).toBe(false);
    process.env.TRUEMED_WEBHOOK_KEY = "whk_separate";
    expect(verifyTruemedWebhook("tm_live_abc")).toBe(false);
    expect(verifyTruemedWebhook("whk_separate")).toBe(true);
  });

  it("reads the session id and status, flat or nested", () => {
    expect(parseTruemedEvent({ type: "payment_session_complete", payment_id: "ps_1", status: "CAPTURED" })).toEqual({ sessionId: "ps_1", status: "captured", type: "payment_session_complete" });
    expect(parseTruemedEvent({ event: "payment_session_complete", data: { payment_id: "ps_2", status: "failed" } })).toEqual({ sessionId: "ps_2", status: "failed", type: "payment_session_complete" });
    expect(parseTruemedEvent({ status: "captured" })).toBeNull();
    expect(parseTruemedEvent("nope")).toBeNull();
  });
});
