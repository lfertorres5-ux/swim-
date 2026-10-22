import http from "node:http";
import type { AddressInfo } from "node:net";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, laDateString } from "@/lib/time";
import { configureServerEnv, enabled, ids } from "./setup";

/**
 * HSA/FSA through Truemed, end to end against a stand-in Truemed API:
 * checkout → Truemed session → webhook "captured" → booking request sent.
 */
const db = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
const PRIYA = "00000000-0000-4000-a000-000000000203";
const MIA = "00000000-0000-4000-c000-000000000004";
const addr = { line1: "1820 Ocean Bluff Way", city: "Del Mar", postalCode: "92014" };

let server: http.Server;
const sessions: Record<string, unknown>[] = [];
let checkout: typeof import("@/lib/booking/checkout");
let manage: typeof import("@/lib/booking/manage");
let webhook: typeof import("@/lib/payments/truemed-webhook");
let service: typeof import("@/lib/scheduling/service");

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.url === "/payments/v1/create_payment_session" && req.headers["x-truemed-api-key"] === "tm_test_key") {
        const parsed = JSON.parse(body);
        sessions.push({ ...parsed, idempotency: req.headers["idempotency-key"] });
        const id = `ps_${sessions.length}`;
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ id, redirect_url: `https://truemed.example/checkout/${id}` }));
      }
      res.writeHead(401).end(JSON.stringify({ message: "bad key" }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  configureServerEnv();
  process.env.PAYMENTS_DEV_MODE = "true";
  process.env.TRUEMED_API_KEY = "tm_test_key";
  process.env.TRUEMED_API_BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.ADMIN_ALERT_EMAIL = "owner@example.com";
  checkout = await import("@/lib/booking/checkout");
  manage = await import("@/lib/booking/manage");
  webhook = await import("@/lib/payments/truemed-webhook");
  service = await import("@/lib/scheduling/service");
});
afterAll(async () => {
  await db.query("update public.platform_settings set hsa_fsa_enabled = false");
  delete process.env.TRUEMED_API_KEY;
  delete process.env.TRUEMED_API_BASE;
  server.close();
  await db.end();
});

async function slot(fromDays: number) {
  const from = addDays(laDateString(), fromDays);
  const { slots } = await service.getAvailability({ zoneId: ids.zoneA, durationMinutes: 30, swimmers: [{ ageMonths: 50, level: "beginner" }], fromDate: from, toDate: addDays(from, 6) });
  return new Date(slots[0].start).toISOString();
}
const hsaCheckout = async (fromDays: number) =>
  checkout.createBookingCheckout(PRIYA, { address: addr, durationMinutes: 30, childIds: [MIA], instructorId: null, plan: { kind: "single" }, start: await slot(fromDays), paymentMethod: "hsa_fsa" });

describe.skipIf(!enabled)("HSA/FSA via Truemed", () => {
  it("is refused until the owner switches it on", async () => {
    await db.query("update public.platform_settings set hsa_fsa_enabled = false");
    expect(await checkout.hsaFsaAvailable()).toBe(false);
    await expect(hsaCheckout(40)).rejects.toThrow(/HSA\/FSA payment isn't available/);
  });

  let paymentId: string;
  it("checkout creates a Truemed session at the server-computed price and holds the slot for an hour", async () => {
    await db.query("update public.platform_settings set hsa_fsa_enabled = true");
    const r = await hsaCheckout(41);
    expect(r.kind).toBe("redirect");
    if (r.kind !== "redirect") return;
    paymentId = r.paymentId;
    expect(r.url).toBe("https://truemed.example/checkout/ps_1");
    const sent = sessions[0] as { total_amount: number; customer_email: string; success_url: string; idempotency: string };
    expect(sent.total_amount).toBe(6500);
    expect(sent.customer_email).toBe("priya@example.com");
    expect(sent.success_url).toContain(`/parent/bookings/confirmed?payment=${paymentId}`);
    expect(sent.idempotency).toBe(`swim-${paymentId}`);
    const { rows } = await db.query(
      "select p.processor, p.processor_session_id, p.status, b.status as booking_status, extract(epoch from b.hold_expires_at - now()) / 60 as hold_min from public.payments p join public.bookings b on b.payment_id = p.id where p.id = $1",
      [paymentId],
    );
    expect(rows[0]).toMatchObject({ processor: "truemed", processor_session_id: "ps_1", status: "pending", booking_status: "pending_payment" });
    expect(Number(rows[0].hold_min)).toBeGreaterThan(55);
  });

  it("'authorized' doesn't fulfill; 'captured' does, once", async () => {
    expect((await webhook.handleTruemedEvent({ sessionId: "ps_1", status: "authorized", type: "payment_session_complete" })).handled).toBe(false);
    expect((await db.query("select status from public.payments where id = $1", [paymentId])).rows[0].status).toBe("pending");

    expect((await webhook.handleTruemedEvent({ sessionId: "ps_1", status: "captured", type: "payment_session_complete" })).handled).toBe(true);
    expect((await webhook.handleTruemedEvent({ sessionId: "ps_1", status: "captured", type: "payment_session_complete" })).duplicate).toBe(true);
    const { rows } = await db.query("select p.status, b.status as booking_status from public.payments p join public.bookings b on b.payment_id = p.id where p.id = $1", [paymentId]);
    expect(rows[0]).toEqual({ status: "succeeded", booking_status: "pending_instructor" });
  });

  it("a failed Truemed payment frees the slot", async () => {
    const r = await hsaCheckout(48);
    if (r.kind !== "redirect") throw new Error("expected redirect");
    await webhook.handleTruemedEvent({ sessionId: "ps_2", status: "failed", type: "payment_session_complete" });
    const { rows } = await db.query("select p.status, b.status as booking_status from public.payments p join public.bookings b on b.payment_id = p.id where p.id = $1", [r.paymentId]);
    expect(rows[0]).toEqual({ status: "cancelled", booking_status: "expired" });
  });

  it("cancelling an HSA/FSA lesson cancels it and asks the owner to refund in Truemed", async () => {
    const { rows } = await db.query("select id from public.bookings where payment_id = $1", [paymentId]);
    const bookingId = rows[0].id as string;
    const out = await manage.cancelBooking(PRIYA, bookingId, "Sick");
    expect(out.refundCents).toBe(6500);
    expect((await db.query("select status from public.bookings where id = $1", [bookingId])).rows[0].status).toBe("cancelled");
    const alert = (await db.query("select to_address, subject from public.notifications where template = 'admin.manual_refund' and booking_id = $1", [bookingId])).rows[0];
    expect(alert).toEqual({ to_address: "owner@example.com", subject: "Refund needed in Truemed: $65" });
    expect((await db.query("select refunded_cents from public.payments where id = $1", [paymentId])).rows[0].refunded_cents).toBe(0);
  });
});
