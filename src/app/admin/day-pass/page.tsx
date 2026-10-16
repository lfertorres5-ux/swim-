import Link from "next/link";
import { ActionForm, Field } from "@/components/action-form";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime } from "@/lib/time";
import { updateInquiryAction } from "./actions";

const STATUSES = ["new", "contacted", "approved", "payment_link_sent", "paid", "declined", "closed"] as const;
const OPEN = ["new", "contacted", "approved", "payment_link_sent"];
const INTEREST: Record<string, string> = { just_curious: "Just curious", interested: "Interested", ready_to_book: "Ready to book" };
const label = (s: string) => s.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());

export default async function DayPassInbox({ searchParams }: PageProps<"/admin/day-pass">) {
  const sp = await searchParams;
  const showAll = sp.show === "all";
  const supabase = await createClient();
  let q = supabase.from("day_pass_inquiries").select("*").order("created_at", { ascending: false }).limit(100);
  if (!showAll) q = q.in("status", OPEN);
  const [{ data: inquiries }, { data: settings }] = await Promise.all([q, supabase.from("platform_settings").select("day_pass_enabled, partner_club_name").single()]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Day pass inquiries</h1>
          <p className="mt-1 text-sm text-stone-500">
            {settings?.partner_club_name || "Partner club"} · {settings?.day_pass_enabled ? "taking inquiries" : "inquiries paused"} ·{" "}
            <Link href="/admin/settings/policies" className="text-brand-700 underline">
              settings
            </Link>
            . Check with the club, quote, then paste a Stripe payment link (Stripe → Payment Links) and send it.
          </p>
        </div>
        <Link href={showAll ? "/admin/day-pass" : "/admin/day-pass?show=all"} className="btn-secondary">
          {showAll ? "Open only" : "Show all"}
        </Link>
      </div>

      <ul className="space-y-4">
        {(inquiries ?? []).map((i) => (
          <li key={i.id} className={`card ${i.status === "new" ? "border-l-4 border-coral" : ""}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold">
                  {i.contact_name} <span className="badge ml-1 bg-stone-100 text-stone-600">{label(i.status)}</span>
                </p>
                <p className="text-sm text-stone-600">
                  <a href={`mailto:${i.contact_email}`} className="text-brand-700">
                    {i.contact_email}
                  </a>
                  {i.contact_phone && ` · ${i.contact_phone}`}
                  {i.parent_id ? " · existing family" : ""}
                </p>
                <p className="mt-1 text-sm text-stone-600">
                  {i.adults_count} adults, {i.children_count} kids · {INTEREST[i.interest_level]} · {i.preferred_dates?.length ? i.preferred_dates.map((d: string) => formatDate(`${d}T20:00:00Z`)).join(", ") : "dates flexible"}
                </p>
                {i.message && <p className="mt-2 text-sm text-stone-500">“{i.message}”</p>}
              </div>
              <span className="text-xs text-stone-400">{formatDateTime(i.created_at)}</span>
            </div>
            <ActionForm action={updateInquiryAction} className="mt-4 grid gap-3 border-t border-stone-100 pt-4 sm:grid-cols-2 lg:grid-cols-4">
              <input type="hidden" name="id" value={i.id} />
              <Field label="Status">
                <select name="status" className="input" defaultValue={i.status}>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {label(s)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Quote ($)">
                <input name="quote" className="input" inputMode="decimal" defaultValue={i.quoted_amount_cents !== null ? (i.quoted_amount_cents / 100).toFixed(2) : ""} />
              </Field>
              <Field label="Stripe payment link" className="sm:col-span-2">
                <input name="payment_link" className="input" placeholder="https://buy.stripe.com/…" defaultValue={i.stripe_payment_link_url ?? ""} />
              </Field>
              <Field label="Private notes" className="sm:col-span-2">
                <textarea name="admin_notes" rows={2} className="input" defaultValue={i.admin_notes ?? ""} />
              </Field>
              <Field label="Message to the family (with the link)" className="sm:col-span-2">
                <textarea name="message_to_family" rows={2} className="input" placeholder="Lunch at the snack bar is included…" />
              </Field>
              <label className="flex items-center gap-2 text-sm sm:col-span-2 lg:col-span-4">
                <input type="checkbox" name="send_link" /> Email the payment link to {i.contact_email} when I save
              </label>
            </ActionForm>
          </li>
        ))}
        {!inquiries?.length && <li className="card text-sm text-stone-500">No open inquiries.</li>}
      </ul>
    </div>
  );
}
