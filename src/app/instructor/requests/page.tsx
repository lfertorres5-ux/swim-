import type { Metadata } from "next";
import { getInstructorContext } from "@/lib/instructor-context";
import { LEVEL_LABELS } from "@/lib/instructors";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatTime } from "@/lib/time";
import { respondToRequest } from "./actions";

export const metadata: Metadata = { title: "Booking requests" };

type Summary = { zone?: string; neighborhood?: string; duration_minutes?: number; swimmers?: { age: number | null; swim_level: string }[] };

export default async function RequestsPage({ searchParams }: PageProps<"/instructor/requests">) {
  const ctx = await getInstructorContext();
  const { error, done } = await searchParams;
  if (!ctx.isActive) return <p className="card text-stone-600">Booking requests will appear here once your account is activated.</p>;

  const supabase = await createClient();
  const { data: offers } = await supabase
    .from("booking_offers")
    .select("id, lesson_summary, expires_at, booking:bookings(starts_at, ends_at)")
    .eq("instructor_id", ctx.user.id)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .order("expires_at");

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold">Booking requests</h1>
      <p className="mt-1 text-sm text-stone-500">
        Please answer before the deadline. If you decline or don&apos;t respond, the lesson is offered to the next available
        instructor. Swimmer names and the address are shared after you accept.
      </p>
      {error && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {done && <p className="mt-4 rounded-lg bg-green-50 p-3 text-sm text-green-800">Request {done}.</p>}

      <ul className="mt-6 space-y-4">
        {(offers ?? []).map((o) => {
          const s = (o.lesson_summary ?? {}) as Summary;
          const booking = Array.isArray(o.booking) ? o.booking[0] : o.booking;
          return (
            <li key={o.id} className="card">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-semibold">
                  {booking ? `${formatDateTime(booking.starts_at)}–${formatTime(booking.ends_at)}` : "Lesson"}
                </p>
                <span className="badge bg-amber-100 text-amber-800">Respond by {formatDateTime(o.expires_at)}</span>
              </div>
              <p className="mt-1 text-sm text-stone-600">
                Zone {s.zone} · {s.neighborhood} · {s.duration_minutes} min
              </p>
              <ul className="mt-2 text-sm text-stone-700">
                {(s.swimmers ?? []).map((sw, i) => (
                  <li key={i}>
                    Swimmer {i + 1}: {sw.age ?? "?"} yrs · {LEVEL_LABELS[sw.swim_level] ?? sw.swim_level}
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex flex-wrap items-end gap-3">
                <form action={respondToRequest}>
                  <input type="hidden" name="offerId" value={o.id} />
                  <input type="hidden" name="decision" value="accept" />
                  <button className="btn-primary">Accept</button>
                </form>
                <form action={respondToRequest} className="flex items-end gap-2">
                  <input type="hidden" name="offerId" value={o.id} />
                  <input type="hidden" name="decision" value="decline" />
                  <input name="reason" placeholder="Reason (optional)" maxLength={500} className="input w-56" />
                  <button className="btn-secondary">Decline</button>
                </form>
              </div>
            </li>
          );
        })}
        {!offers?.length && <li className="card text-stone-600">No open requests.</li>}
      </ul>
    </div>
  );
}
