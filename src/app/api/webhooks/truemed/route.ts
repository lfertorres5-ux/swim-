import { NextResponse, type NextRequest } from "next/server";
import { parseTruemedEvent, verifyTruemedWebhook } from "@/lib/payments/truemed";
import { handleTruemedEvent } from "@/lib/payments/truemed-webhook";

export const dynamic = "force-dynamic";

/**
 * Truemed → app (payment_session_complete). Register this URL in the Truemed
 * partner dashboard; Truemed sends the x-truemed-api-key header we check.
 */
export async function POST(request: NextRequest) {
  if (!verifyTruemedWebhook(request.headers.get("x-truemed-api-key"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const event = parseTruemedEvent(await request.json().catch(() => null));
  if (!event) return NextResponse.json({ error: "unrecognized payload" }, { status: 400 });
  try {
    return NextResponse.json({ received: true, ...(await handleTruemedEvent(event)) });
  } catch (err) {
    console.error("truemed webhook failed", event, err);
    return NextResponse.json({ error: "processing failed" }, { status: 500 }); // Truemed retries
  }
}
