import type { Metadata } from "next";
import { readFlash } from "@/lib/flash";
import { getInstructorContext } from "@/lib/instructor-context";
import { createClient } from "@/lib/supabase/server";
import { formatDate, laDateString } from "@/lib/time";
import { one } from "@/lib/utils";

export const metadata: Metadata = { title: "Earnings" };

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "Logged", cls: "bg-amber-50 text-amber-800" },
  approved: { label: "Approved", cls: "bg-brand-50 text-brand-800" },
  paid: { label: "Paid", cls: "bg-emerald-50 text-emerald-800" },
  void: { label: "Void", cls: "bg-stone-100 text-stone-500" },
};

/** Every lesson an instructor has logged (progress note or no-show) and what it pays. RLS limits rows to their own. */
export default async function EarningsPage({ searchParams }: PageProps<"/instructor/earnings">) {
  const ctx = await getInstructorContext();
  const notice = readFlash(await searchParams, "notice");
  const supabase = await createClient();
  const { data } = await supabase
    .from("instructor_earnings")
    .select("id, earned_on, minutes, rate_cents_per_hour, amount_cents, status, booking:bookings(status)")
    .eq("instructor_id", ctx.user.id)
    .order("earned_on", { ascending: false })
    .limit(200);
  const rows = data ?? [];

  const monthStart = `${laDateString().slice(0, 7)}-01`;
  const live = rows.filter((r) => r.status !== "void");
  const thisMonth = live.filter((r) => r.earned_on >= monthStart).reduce((s, r) => s + r.amount_cents, 0);
  const unpaid = live.filter((r) => r.status !== "paid").reduce((s, r) => s + r.amount_cents, 0);
  const lessonsThisMonth = live.filter((r) => r.earned_on >= monthStart).length;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Earnings</h1>
        <p className="mt-1 text-stone-600">A lesson counts once you send its progress note, or mark the family as a no-show.</p>
      </div>
      {notice && (
        <p className="card text-sm text-emerald-800" role="status">
          {notice}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          ["This month", money(thisMonth)],
          ["Lessons this month", String(lessonsThisMonth)],
          ["Not paid out yet", money(unpaid)],
        ].map(([label, value]) => (
          <div key={label} className="card">
            <p className="text-sm text-stone-500">{label}</p>
            <p className="mt-1 font-display text-2xl font-semibold">{value}</p>
          </div>
        ))}
      </div>

      {rows.length ? (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-stone-100 text-stone-500">
              <tr>
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 font-medium">Lesson</th>
                <th className="px-5 py-3 font-medium">Rate</th>
                <th className="px-5 py-3 text-right font-medium">Pay</th>
                <th className="px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const s = STATUS[r.status] ?? { label: r.status, cls: "bg-stone-100" };
                const noShow = one(r.booking)?.status === "no_show";
                return (
                  <tr key={r.id} className="border-b border-stone-50 last:border-0">
                    <td className="px-5 py-3 whitespace-nowrap">{formatDate(`${r.earned_on}T12:00:00Z`)}</td>
                    <td className="px-5 py-3 whitespace-nowrap">
                      {r.minutes} min{noShow && <span className="badge ml-2 bg-coral-50 text-coral-700">No-show</span>}
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap text-stone-500">{money(r.rate_cents_per_hour)}/hr</td>
                    <td className="px-5 py-3 text-right font-medium whitespace-nowrap">{money(r.amount_cents)}</td>
                    <td className="px-5 py-3">
                      <span className={`badge ${s.cls}`}>{s.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="card text-stone-600">Nothing logged yet. Send the progress note after each lesson and it shows up here.</p>
      )}
      <p className="text-xs text-stone-500">Questions about a payout? Contact the owner.</p>
    </div>
  );
}
