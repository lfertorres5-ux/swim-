import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail, sendSms } from "./providers";
import type { Rendered } from "./templates";

export type Recipient = { userId: string | null; email: string | null; phone: string | null; emailOptIn: boolean; smsOptIn: boolean };

const MAX_ATTEMPTS = 5;

/**
 * Store a rendered notification for a recipient (email always if they have
 * one and haven't opted out; SMS only if they opted in and the template has an
 * SMS version), then try to deliver right away. Duplicate dedupe keys are
 * ignored, so callers can fire the same event safely more than once.
 */
export async function enqueue(r: Recipient, template: string, rendered: Rendered, opts: { bookingId?: string | null; dedupeKey: string }) {
  const admin = createAdminClient();
  const rows = [];
  if (r.email && r.emailOptIn) {
    rows.push({ user_id: r.userId, to_address: r.email, channel: "email", template, booking_id: opts.bookingId ?? null, subject: rendered.subject, body_text: rendered.text, body_html: rendered.html, dedupe_key: `${opts.dedupeKey}:email` });
  }
  if (rendered.sms && r.phone && r.smsOptIn) {
    rows.push({ user_id: r.userId, to_address: r.phone, channel: "sms", template, booking_id: opts.bookingId ?? null, subject: null, body_text: rendered.sms, body_html: null, dedupe_key: `${opts.dedupeKey}:sms` });
  }
  if (!rows.length) return [];

  const { data, error } = await admin.from("notifications").upsert(rows, { onConflict: "dedupe_key", ignoreDuplicates: true }).select("id");
  if (error) throw new Error(`enqueue failed: ${error.message}`);
  const ids = (data ?? []).map((d) => d.id as string);
  for (const id of ids) await deliver(id);
  return ids;
}

/** Send one pending/failed notification. Never throws; failures are retried with backoff. */
export async function deliver(id: string) {
  const admin = createAdminClient();
  const { data: n } = await admin.from("notifications").select("*").eq("id", id).in("status", ["pending", "failed"]).maybeSingle();
  if (!n) return;
  try {
    const result =
      n.channel === "email"
        ? await sendEmail({ to: n.to_address, subject: n.subject ?? "", html: n.body_html ?? n.body_text, text: n.body_text, idempotencyKey: n.dedupe_key })
        : await sendSms({ to: n.to_address, body: n.body_text });
    await admin
      .from("notifications")
      .update({ status: "sent", sent_at: new Date().toISOString(), provider: result.provider, provider_message_id: result.id, attempts: n.attempts + 1, last_error: null })
      .eq("id", id);
  } catch (err) {
    const attempts = n.attempts + 1;
    await admin
      .from("notifications")
      .update({
        status: attempts >= MAX_ATTEMPTS ? "skipped" : "failed",
        attempts,
        last_error: String(err).slice(0, 500),
        next_attempt_at: new Date(Date.now() + 2 ** attempts * 60_000).toISOString(), // 2, 4, 8, 16 min…
      })
      .eq("id", id);
  }
}

/** Cron: retry anything due. */
export async function deliverDue(limit = 50) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("notifications")
    .select("id")
    .in("status", ["pending", "failed"])
    .lte("next_attempt_at", new Date().toISOString())
    .order("next_attempt_at")
    .limit(limit);
  for (const n of data ?? []) await deliver(n.id);
  return (data ?? []).length;
}
