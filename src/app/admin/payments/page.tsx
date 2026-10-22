import { requireRole } from "@/lib/auth";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { PAYMENT_STATUS } from "@/lib/admin/labels";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/time";
import { formatCents, one } from "@/lib/utils";
import { refundAction } from "../bookings/actions";

export default async function AdminPayments({ searchParams }: PageProps<"/admin/payments">) {
  await requireRole("admin"); // every admin page checks on its own, never only via the layout
  const sp = await searchParams;
  const status = typeof sp.status === "string" ? sp.status : "all";
  const supabase = await createClient();
  let q = supabase
    .from("payments")
    .select("id, processor, amount_cents, refunded_cents, status, kind, description, created_at, booking_id, stripe_payment_intent_id, receipt_url, parent:parents(user:users(first_name, last_name, email))")
    .order("created_at", { ascending: false })
    .limit(100);
  if (status === "paid") q = q.in("status", ["succeeded", "partially_refunded"]);
  if (status === "refunded") q = q.in("status", ["refunded", "partially_refunded"]);
  if (status === "unpaid") q = q.eq("status", "pending");
  const { data: payments } = await q;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Payments</h1>
        <p className="mt-1 text-sm text-stone-500">Refunds go back to the family&apos;s card through Stripe. Partial refunds are fine.</p>
      </div>
      <nav className="flex gap-1">
        {["all", "paid", "refunded", "unpaid"].map((s) => (
          <Link key={s} href={`/admin/payments?status=${s}`} className={`rounded-full px-3.5 py-1.5 text-sm capitalize ${status === s ? "bg-brand-600 font-medium text-white" : "bg-white text-stone-600"}`}>
            {s}
          </Link>
        ))}
      </nav>
      <ul className="card divide-y divide-stone-100 p-0">
        {(payments ?? []).map((p) => {
          const u = one(one(p.parent)?.user);
          const refundable = p.stripe_payment_intent_id && ["succeeded", "partially_refunded"].includes(p.status) ? p.amount_cents - p.refunded_cents : 0;
          return (
            <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 text-sm">
              <span className="w-36 shrink-0 text-stone-500">{formatDateTime(p.created_at)}</span>
              <span className="min-w-0 flex-1">
                <span className="font-medium">
                  {u?.first_name} {u?.last_name}
                </span>
                <span className="block truncate text-stone-500">
                  {p.booking_id ? (
                    <Link href={`/admin/bookings/${p.booking_id}`} className="hover:underline">
                      {p.description ?? p.kind}
                    </Link>
                  ) : (
                    (p.description ?? p.kind)
                  )}
                </span>
              </span>
              <span className="text-right">
                {formatCents(p.amount_cents)}
                {p.refunded_cents > 0 && <span className="block text-xs text-stone-500">−{formatCents(p.refunded_cents)}</span>}
              </span>
              <span className={`badge ${PAYMENT_STATUS[p.status]?.cls}`}>{PAYMENT_STATUS[p.status]?.label}</span>
              {p.processor === "truemed" && <span className="badge bg-brand-50 text-brand-800" title="Refund from your Truemed dashboard">HSA/FSA</span>}
              {refundable > 0 && (
                <ActionForm action={refundAction} submitLabel="Refund" variant="link" inline confirm="Refund this amount?">
                  <input type="hidden" name="paymentId" value={p.id} />
                  <input name="amount" aria-label="Refund amount" className="input w-24 py-1.5" inputMode="decimal" defaultValue={(refundable / 100).toFixed(2)} />
                </ActionForm>
              )}
            </li>
          );
        })}
        {!payments?.length && <li className="px-5 py-8 text-center text-sm text-stone-500">No payments.</li>}
      </ul>
    </div>
  );
}
