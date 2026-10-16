import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, Field } from "@/components/action-form";
import { adminCancellationPreview } from "@/lib/admin/bookings";
import { BOOKING_STATUS, PAYMENT_STATUS } from "@/lib/admin/labels";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime, formatTime } from "@/lib/time";
import { formatCents, one } from "@/lib/utils";
import { cancelAction, paymentLinkAction, reassignAction, refundAction } from "../actions";

type Child = { first_name: string; birth_date: string | null; swim_level: string; notes: string | null };
type Offer = { instructor: { first_name: string } | { first_name: string }[] | null; status: string; offered_at: string; decline_reason: string | null };

const dollars = (c: number) => (c / 100).toFixed(2);

export default async function AdminBooking({ params, searchParams }: PageProps<"/admin/bookings/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: b }, { data: instructors }, { data: payments }, { data: history }, { data: shifts }, preview] = await Promise.all([
    supabase
      .from("bookings")
      .select(
        "*, zone:zones(code, name), instructor:instructors!bookings_instructor_id_fkey(id, first_name), requested:instructors!bookings_requested_instructor_id_fkey(first_name), parent:parents(id, user:users(first_name, last_name, email, phone)), booking_children(child:children(first_name, birth_date, swim_level, notes)), booking_locations(*), booking_pricing(*), lesson_notes(summary, next_focus), booking_offers(instructor:instructors(first_name), status, offered_at, decline_reason)",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase.from("instructors").select("id, first_name").eq("is_active", true).order("first_name"),
    supabase.from("payments").select("id, amount_cents, refunded_cents, status, description, created_at, stripe_payment_intent_id").or(`booking_id.eq.${id}`).order("created_at"),
    supabase.from("audit_log").select("id, occurred_at, actor_role, action, metadata").eq("booking_id", id).order("occurred_at", { ascending: false }).limit(30),
    supabase.from("open_shifts").select("status, reason, created_at, claimed:instructors!open_shifts_claimed_by_fkey(first_name)").eq("booking_id", id).order("created_at", { ascending: false }),
    adminCancellationPreview(id),
  ]);
  if (!b) notFound();

  const user = one(one(b.parent)?.user);
  const loc = one(b.booking_locations);
  const pricing = one(b.booking_pricing);
  const note = one(b.lesson_notes);
  const instructor = one(b.instructor);
  const st = BOOKING_STATUS[b.status];
  const live = ["pending_payment", "pending_instructor", "confirmed"].includes(b.status);
  const linked = payments ?? [];
  const linkedPayment = b.payment_id && !linked.some((p) => p.id === b.payment_id) ? (await supabase.from("payments").select("id, amount_cents, refunded_cents, status, description, created_at, stripe_payment_intent_id").eq("id", b.payment_id).maybeSingle()).data : null;
  const allPayments = linkedPayment ? [linkedPayment, ...linked] : linked;
  const unpaid = !b.package_id && !allPayments.some((p) => ["succeeded", "partially_refunded", "refunded"].includes(p.status)) && (pricing?.total_cents ?? 0) > 0;

  return (
    <div className="space-y-6">
      <Link href="/admin/bookings" className="text-sm text-stone-500 hover:text-stone-800">
        ← Bookings
      </Link>
      {sp.created && <p className="rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-800">Booking created.</p>}
      {typeof sp.notice === "string" && <p className="rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-800">{sp.notice.slice(0, 200)}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">
          {formatDate(b.starts_at, { weekday: "long", month: "long", day: "numeric" })} · {formatTime(b.starts_at)}–{formatTime(b.ends_at)}
        </h1>
        <span className={`badge ${st?.cls}`}>{st?.label}</span>
        {b.kind !== "single" && <span className="badge bg-stone-100 text-stone-600">{b.kind}</span>}
        {unpaid && <span className="badge bg-amber-100 text-amber-900">Unpaid</span>}
      </div>
      {b.needs_attention && <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">⚠ {b.attention_reason ?? "Needs attention"}</p>}

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="card lg:col-span-2">
          <h2 className="font-semibold">Family</h2>
          <p className="mt-2">
            {user?.first_name} {user?.last_name} · <a className="text-brand-700" href={`mailto:${user?.email}`}>{user?.email}</a>
            {user?.phone && <> · {user.phone}</>}
          </p>
          <ul className="mt-2 text-sm text-stone-700">
            {((b.booking_children ?? []) as { child: Child | Child[] | null }[]).map((bc) => {
              const c = one(bc.child);
              return c ? (
                <li key={c.first_name}>
                  <strong>{c.first_name}</strong> · {c.swim_level.replaceAll("_", " ")}
                  {c.birth_date && ` · born ${formatDate(`${c.birth_date}T20:00:00Z`, { month: "short", year: "numeric" })}`}
                  {c.notes && <span className="text-stone-500"> — “{c.notes}”</span>}
                </li>
              ) : null;
            })}
          </ul>
          {loc && (
            <p className="mt-3 text-sm text-stone-600">
              {loc.address_line1}
              {loc.address_line2 && `, ${loc.address_line2}`}, {loc.city} {loc.postal_code} · Zone {one(b.zone)?.code}
              {loc.access_notes && <span className="block text-stone-500">Access: {loc.access_notes}</span>}
            </p>
          )}
          <p className="mt-3 text-sm text-stone-600">
            Instructor: <strong>{instructor?.first_name ?? "none yet"}</strong>
            {one(b.requested)?.first_name && one(b.requested)?.first_name !== instructor?.first_name && <span className="text-stone-500"> (family asked for {one(b.requested)?.first_name})</span>}
            {b.buffer_override && <span className="badge ml-2 bg-amber-100 text-amber-900">travel buffer ignored</span>}
          </p>
          {note && (
            <div className="mt-3 rounded-xl bg-sand/60 p-3 text-sm">
              <p className="font-medium">Progress note</p>
              <p className="text-stone-600">“{note.summary}”</p>
            </div>
          )}
        </section>

        <section className="card">
          <h2 className="font-semibold">Money</h2>
          {pricing ? (
            <dl className="mt-2 space-y-1 text-sm">
              <div className="flex justify-between">
                <dt className="text-stone-500">Lesson price</dt>
                <dd>{formatCents(pricing.total_cents)}</dd>
              </div>
              {pricing.promo_discount_cents > 0 && (
                <div className="flex justify-between">
                  <dt className="text-stone-500">Promo</dt>
                  <dd>−{formatCents(pricing.promo_discount_cents)}</dd>
                </div>
              )}
            </dl>
          ) : (
            <p className="mt-2 text-sm text-stone-500">{b.package_id ? "Paid with a package credit." : "No price recorded."}</p>
          )}
          <ul className="mt-3 space-y-2">
            {allPayments.map((p) => (
              <li key={p.id} className="rounded-xl bg-sand/60 p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span>{formatCents(p.amount_cents)}</span>
                  <span className={`badge ${PAYMENT_STATUS[p.status]?.cls}`}>{PAYMENT_STATUS[p.status]?.label}</span>
                </div>
                {p.refunded_cents > 0 && <p className="text-xs text-stone-500">Refunded {formatCents(p.refunded_cents)}</p>}
                <p className="text-xs text-stone-500">{p.description ?? formatDate(p.created_at)}</p>
                {p.stripe_payment_intent_id && ["succeeded", "partially_refunded"].includes(p.status) && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs font-medium text-brand-700">Refund</summary>
                    <ActionForm action={refundAction} submitLabel="Refund" variant="secondary" className="mt-2 space-y-2" confirm="Refund this amount to the family's card?">
                      <input type="hidden" name="paymentId" value={p.id} />
                      <Field label="Amount ($)">
                        <input name="amount" className="input" inputMode="decimal" defaultValue={dollars(p.amount_cents - p.refunded_cents)} />
                      </Field>
                      <Field label="Reason (private)">
                        <input name="reason" className="input" />
                      </Field>
                    </ActionForm>
                  </details>
                )}
              </li>
            ))}
          </ul>
          {live && unpaid && (
            <ActionForm action={paymentLinkAction} submitLabel="Email payment link" variant="secondary" className="mt-3 space-y-2">
              <input type="hidden" name="bookingId" value={b.id} />
              <Field label="Amount ($)">
                <input name="amount" className="input" inputMode="decimal" defaultValue={dollars(pricing?.total_cents ?? 0)} />
              </Field>
            </ActionForm>
          )}
        </section>
      </div>

      {live && (
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="card">
            <h2 className="font-semibold">Reassign instructor</h2>
            <p className="mt-1 text-sm text-stone-500">Confirms the lesson with the instructor you pick. The database still blocks double-booking.</p>
            <ActionForm action={reassignAction} submitLabel="Reassign" className="mt-3 space-y-3">
              <input type="hidden" name="bookingId" value={b.id} />
              <select name="instructorId" className="input" defaultValue={instructor?.id ?? ""}>
                <option value="">Pick an instructor…</option>
                {(instructors ?? []).map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.first_name}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="ignore_buffer" /> Ignore travel buffer
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="notify" defaultChecked /> Email/text the family and instructors
              </label>
            </ActionForm>
          </section>

          <section className="card">
            <h2 className="font-semibold">Cancel lesson</h2>
            {preview && (
              <p className="mt-1 text-sm text-stone-500">
                {preview.hasPackage
                  ? `Paid with a package credit. Policy: ${preview.restoreCredit ? "return the credit" : "late — credit is used"}.`
                  : preview.paidCents
                    ? `Paid ${formatCents(preview.paidCents)}. Policy refund now: ${formatCents(preview.refundCents)} (${preview.onTime ? "on time" : "late"}). Up to ${formatCents(preview.refundableCents)} can be refunded.`
                    : "No card payment on file."}
              </p>
            )}
            <ActionForm action={cancelAction} submitLabel="Cancel lesson" variant="danger" className="mt-3 space-y-3" confirm="Cancel this lesson?">
              <input type="hidden" name="bookingId" value={b.id} />
              {!!preview?.refundableCents && (
                <Field label="Refund ($)">
                  <input name="refund" className="input" inputMode="decimal" defaultValue={dollars(preview.refundCents)} />
                </Field>
              )}
              {preview?.hasPackage && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="restore_credit" defaultChecked={preview.restoreCredit} /> Give the credit back
                </label>
              )}
              <Field label="Reason">
                <input name="reason" className="input" placeholder="Weather, illness…" />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="notify" defaultChecked /> Email/text the family and instructor
              </label>
            </ActionForm>
          </section>
        </div>
      )}

      <section className="card">
        <h2 className="font-semibold">History</h2>
        <ul className="mt-2 space-y-1.5 text-sm">
          {(shifts ?? []).map((s, i) => (
            <li key={`s${i}`} className="text-stone-600">
              {formatDateTime(s.created_at)} · Sub board: {s.status}
              {one(s.claimed)?.first_name && ` (${one(s.claimed)?.first_name})`}
              {s.reason && ` — “${s.reason}”`}
            </li>
          ))}
          {((b.booking_offers ?? []) as Offer[]).map((o, i) => (
            <li key={`o${i}`} className="text-stone-600">
              {formatDateTime(o.offered_at)} · Offered to {one(o.instructor)?.first_name}: {o.status}
              {o.decline_reason && ` — “${o.decline_reason}”`}
            </li>
          ))}
          {(history ?? []).map((h) => (
            <li key={h.id} className="text-stone-500">
              {formatDateTime(h.occurred_at)} · {h.action.replace(".", " · ").replaceAll("_", " ")}
              {h.actor_role && ` (${h.actor_role})`}
            </li>
          ))}
          {!shifts?.length && !(b.booking_offers ?? []).length && !history?.length && <li className="text-stone-500">Nothing recorded yet.</li>}
        </ul>
      </section>
    </div>
  );
}
