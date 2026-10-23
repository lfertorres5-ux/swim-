import { NextResponse, type NextRequest } from "next/server";
import { enqueueMissingNoteReminders, enqueueReminders } from "@/lib/notifications/events";
import { deliverDue } from "@/lib/notifications/outbox";

export const dynamic = "force-dynamic";

/** Vercel Cron: queue 24-hour reminders and missing-note nudges, then deliver/retry anything due. */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const reminders = await enqueueReminders();
  const noteReminders = await enqueueMissingNoteReminders();
  const delivered = await deliverDue();
  return NextResponse.json({ ok: true, reminders, noteReminders, delivered });
}
