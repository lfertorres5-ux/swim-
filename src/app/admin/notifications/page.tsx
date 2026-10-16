import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/time";

export const metadata: Metadata = { title: "Messages" };

const STATUS: Record<string, string> = {
  sent: "bg-brand-50 text-brand-800",
  pending: "bg-sand text-stone-700",
  failed: "bg-coral-50 text-coral-700",
  skipped: "bg-stone-100 text-stone-500",
};

/** Every email/SMS the platform sent (or logged, while provider keys aren't set). */
export default async function MessagesPage({ searchParams }: PageProps<"/admin/notifications">) {
  await requireRole("admin");
  const { channel } = await searchParams;
  const supabase = await createClient();
  let q = supabase
    .from("notifications")
    .select("id, created_at, channel, to_address, template, subject, body_text, status, provider, last_error, attempts")
    .order("created_at", { ascending: false })
    .limit(150);
  if (channel === "email" || channel === "sms") q = q.eq("channel", channel);
  const { data } = await q;
  const loggedOnly = (data ?? []).some((n) => n.provider === "log");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Messages</h1>
          <p className="text-sm text-stone-500">Emails and texts sent to families and instructors.</p>
        </div>
        <nav className="flex gap-1 text-sm">
          {[
            ["", "All"],
            ["email", "Email"],
            ["sms", "Text"],
          ].map(([v, label]) => (
            <a key={v} href={v ? `?channel=${v}` : "?"} className={`rounded-full px-3 py-1.5 ${(channel ?? "") === v ? "bg-white shadow-sm" : "text-stone-600"}`}>
              {label}
            </a>
          ))}
        </nav>
      </div>
      {loggedOnly && (
        <p className="rounded-2xl bg-sand-dark p-3 text-sm text-stone-700">
          Some messages were only logged, not delivered — add <code>RESEND_API_KEY</code> (email) and the Twilio keys (text) to send for real.
        </p>
      )}
      <ul className="space-y-2">
        {(data ?? []).map((n) => (
          <li key={n.id}>
            <details className="card p-4">
              <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{n.subject ?? n.body_text.slice(0, 80)}</span>
                  <span className="text-xs text-stone-500">
                    {n.channel === "sms" ? "Text" : "Email"} to {n.to_address} · {n.template} · {formatDateTime(n.created_at)}
                  </span>
                </span>
                <span className={`badge ${STATUS[n.status] ?? ""}`}>
                  {n.status === "sent" && n.provider === "log" ? "logged" : n.status}
                </span>
              </summary>
              <pre className="mt-3 text-sm whitespace-pre-wrap text-stone-700">{n.body_text}</pre>
              {n.last_error && <p className="mt-2 text-xs text-coral-700">Last error ({n.attempts} tries): {n.last_error}</p>}
            </details>
          </li>
        ))}
        {!data?.length && <li className="card text-stone-500">No messages yet.</li>}
      </ul>
    </div>
  );
}
