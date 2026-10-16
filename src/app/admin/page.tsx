import Link from "next/link";
import { loadDashboard } from "@/lib/admin/dashboard";
import { CERT_LABELS } from "@/lib/admin/certs";
import { formatDate, formatDateTime } from "@/lib/time";
import { formatCents } from "@/lib/utils";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="card">
      <p className="text-sm text-stone-500">{label}</p>
      <p className="mt-1 font-display text-3xl font-semibold text-stone-900">{value}</p>
      {sub && <p className="mt-1 text-xs text-stone-500">{sub}</p>}
    </div>
  );
}

export default async function AdminHome() {
  const d = await loadDashboard();
  const todoCount = d.todo.attention.length + d.todo.approvals.length + d.todo.inquiries.length + d.todo.certs.length;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="mt-1 text-sm text-stone-500">Last 30 days, plus what needs you today.</p>
        </div>
        <Link href="/admin/bookings/new" className="btn-primary">
          New booking
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Revenue (net)" value={formatCents(d.revenue.netCents)} sub={d.revenue.refundsCents ? `${formatCents(d.revenue.grossCents)} collected · ${formatCents(d.revenue.refundsCents)} refunded` : "after refunds"} />
        <Stat label="Lessons taught" value={d.lessons30} sub={`${d.upcoming7} booked for the next 7 days`} />
        <Stat label="Cancellations" value={d.cancellations30} sub={`${d.cancellationRate}% of lessons`} />
        <Stat label="Waiting on an instructor" value={d.awaitingInstructor} sub="requests sent, not yet accepted" />
      </div>

      <section className="card">
        <h2 className="font-semibold">Needs you {todoCount > 0 && <span className="badge ml-1 bg-coral text-white">{todoCount}</span>}</h2>
        <ul className="mt-3 divide-y divide-stone-100 text-sm">
          {d.todo.attention.map((b) => (
            <li key={b.id} className="flex flex-wrap justify-between gap-2 py-2.5">
              <span>
                <span className="mr-2">⚠</span>
                {b.attention_reason ?? "Booking needs attention"} · {formatDateTime(b.starts_at)}
              </span>
              <Link href={`/admin/bookings/${b.id}`} className="font-medium text-brand-700">
                Fix →
              </Link>
            </li>
          ))}
          {d.todo.approvals.map((s) => (
            <li key={s.id} className="flex flex-wrap justify-between gap-2 py-2.5">
              <span>
                <span className="mr-2">⇄</span>
                {s.to} wants to cover {s.from} · {formatDateTime(s.startsAt)}
              </span>
              <Link href="/admin/sub-board" className="font-medium text-brand-700">
                Review →
              </Link>
            </li>
          ))}
          {d.todo.inquiries.map((q) => (
            <li key={q.id} className="flex flex-wrap justify-between gap-2 py-2.5">
              <span>
                <span className="mr-2">✉</span>
                Day pass inquiry from {q.contact_name} · {formatDate(q.created_at)}
              </span>
              <Link href="/admin/day-pass" className="font-medium text-brand-700">
                Reply →
              </Link>
            </li>
          ))}
          {d.todo.certs.map((c) => (
            <li key={c.id} className="flex flex-wrap justify-between gap-2 py-2.5">
              <span>
                <span className="mr-2">◷</span>
                {c.firstName}&apos;s {CERT_LABELS[c.kind]} {c.state === "expired" ? "has expired" : `expires in ${c.days} day${c.days === 1 ? "" : "s"}`}
              </span>
              <Link href={`/admin/instructors/${c.instructorId}`} className="font-medium text-brand-700">
                Update →
              </Link>
            </li>
          ))}
          {!todoCount && <li className="py-2.5 text-stone-500">All clear. 🌊</li>}
        </ul>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card">
          <h2 className="font-semibold">Instructor utilization</h2>
          <p className="mt-1 text-xs text-stone-500">Booked hours ÷ available hours, next 14 days</p>
          <ul className="mt-4 space-y-3">
            {d.utilization.map((u) => (
              <li key={u.instructorId}>
                <div className="flex justify-between text-sm">
                  <Link href={`/admin/instructors/${u.instructorId}`} className="font-medium hover:underline">
                    {u.firstName}
                  </Link>
                  <span className="text-stone-500">{u.pct === null ? "no hours set" : `${u.pct}% · ${Math.round(u.bookedMinutes / 60)} of ${Math.round(u.availableMinutes / 60)} h`}</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-stone-100">
                  <div className="h-full rounded-full bg-brand-500" style={{ width: `${u.pct ?? 0}%` }} />
                </div>
              </li>
            ))}
            {!d.utilization.length && <li className="text-sm text-stone-500">No active instructors.</li>}
          </ul>
        </section>

        <section className="card">
          <h2 className="font-semibold">Where & when lessons happen</h2>
          <p className="mt-1 text-xs text-stone-500">Lessons by zone and weekday (past 90 days + next 30)</p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-separate border-spacing-1 text-center text-xs">
              <thead>
                <tr>
                  <th />
                  {DAYS.map((day) => (
                    <th key={day} className="font-medium text-stone-500">
                      {day}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.zones.map((z) => (
                  <tr key={z.id}>
                    <th className="pr-2 text-left font-medium whitespace-nowrap" title={z.name}>
                      Zone {z.code}
                    </th>
                    {(d.heatmap[z.id] ?? []).map((cell, i) => (
                      <td
                        key={i}
                        className="h-9 min-w-9 rounded-md"
                        style={{ background: cell.count ? `rgba(35, 108, 113, ${0.12 + cell.intensity * 0.78})` : "#f5f5f4", color: cell.intensity > 0.5 ? "#fff" : "#44403c" }}
                      >
                        {cell.count || ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
