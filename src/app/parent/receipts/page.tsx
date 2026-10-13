import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/time";
import { formatCents } from "@/lib/utils";
import { billingPortalAction } from "../actions";

const STATUS: Record<string, string> = {
  succeeded: "Paid",
  refunded: "Refunded",
  partially_refunded: "Partially refunded",
  pending: "Pending",
  failed: "Failed",
  cancelled: "Cancelled",
};

export default async function ReceiptsPage({ searchParams }: PageProps<"/parent/receipts">) {
  await requireRole("parent");
  const { error } = await searchParams;
  const supabase = await createClient();
  const { data: payments } = await supabase
    .from("payments")
    .select("id, created_at, description, amount_cents, refunded_cents, status, receipt_url")
    .neq("status", "cancelled")
    .order("created_at", { ascending: false });

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Receipts</h1>
        <form action={billingPortalAction}>
          <button className="btn-secondary">Manage payment methods</button>
        </form>
      </div>
      {error && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">You don&apos;t have any saved payment details yet.</p>}
      <ul className="card divide-y divide-slate-100 p-0">
        {(payments ?? []).map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm">
            <div>
              <p className="font-medium">{p.description ?? "Swim lessons"}</p>
              <p className="text-slate-500">
                {formatDate(p.created_at)} · {STATUS[p.status] ?? p.status}
                {p.refunded_cents > 0 && ` · ${formatCents(p.refunded_cents)} refunded`}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-semibold">{formatCents(p.amount_cents)}</span>
              {p.receipt_url && (
                <a href={p.receipt_url} target="_blank" rel="noreferrer" className="text-sky-700 underline">
                  Receipt
                </a>
              )}
            </div>
          </li>
        ))}
        {!payments?.length && <li className="p-4 text-sm text-slate-500">No payments yet.</li>}
      </ul>
    </div>
  );
}
