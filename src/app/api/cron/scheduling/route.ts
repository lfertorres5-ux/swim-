import { NextResponse, type NextRequest } from "next/server";
import { runSchedulingMaintenance } from "@/lib/scheduling/offers";

export const dynamic = "force-dynamic";

/** Vercel Cron (see vercel.json). Vercel sends `Authorization: Bearer $CRON_SECRET`. */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await runSchedulingMaintenance();
  return NextResponse.json({ ok: true, ...result });
}
