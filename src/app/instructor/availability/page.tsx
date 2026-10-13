import type { Metadata } from "next";
import { getInstructorContext } from "@/lib/instructor-context";
import { createClient } from "@/lib/supabase/server";
import { formatCents } from "@/lib/utils";
import { formatDate, formatTimeOfDay, laDateString, parseTimeOfDay } from "@/lib/time";
import { addDateOverride, addWeeklyHours, removeDateOverride, removeWeeklyHours, saveZones } from "./actions";

export const metadata: Metadata = { title: "Availability" };

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const TIME_OPTIONS = Array.from({ length: 33 }, (_, i) => 6 * 60 + i * 30).map(formatTimeOfDay); // 06:00–22:00

function label(t: string) {
  const m = parseTimeOfDay(t);
  const h = Math.floor(m / 60);
  return `${((h + 11) % 12) + 1}:${String(m % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

export default async function AvailabilityPage({ searchParams }: PageProps<"/instructor/availability">) {
  const { user } = await getInstructorContext();
  const { error } = await searchParams;
  const supabase = await createClient();
  const today = laDateString();

  const [{ data: rules }, { data: overrides }, { data: zones }, { data: myZones }] = await Promise.all([
    supabase.from("availability_rules").select("id, weekday, start_time, end_time").eq("instructor_id", user.id).is("effective_until", null).order("start_time"),
    supabase.from("availability_overrides").select("id, date, kind, start_time, end_time, note").eq("instructor_id", user.id).gte("date", today).order("date"),
    supabase.from("zones").select("id, code, name, description, travel_fee_cents, min_booking_minutes").eq("is_bookable", true).order("sort_order"),
    supabase.from("instructor_zones").select("zone_id").eq("instructor_id", user.id),
  ]);
  const covered = new Set((myZones ?? []).map((z) => z.zone_id));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Availability</h1>
        <p className="mt-1 text-sm text-stone-500">
          All times are San Diego time. Families can only book inside these hours, with travel time kept between lessons
          automatically. Changing your hours never cancels lessons that are already booked.
        </p>
        {error && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
      </div>

      <section className="card">
        <h2 className="font-semibold">Weekly hours</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {WEEKDAYS.map((day, weekday) => {
            const blocks = (rules ?? []).filter((r) => r.weekday === weekday);
            return (
              <div key={day} className="rounded-xl border border-stone-200 p-3">
                <p className="text-sm font-semibold text-stone-700">{day}</p>
                {blocks.length === 0 && <p className="mt-1 text-sm text-stone-400">Unavailable</p>}
                <ul className="mt-1 space-y-1">
                  {blocks.map((r) => (
                    <li key={r.id} className="flex items-center justify-between rounded-lg bg-brand-50 px-2 py-1 text-sm text-brand-900">
                      {label(r.start_time)} – {label(r.end_time)}
                      <form action={removeWeeklyHours}>
                        <input type="hidden" name="id" value={r.id} />
                        <button className="text-brand-700 hover:text-red-600" aria-label={`Remove ${day} ${label(r.start_time)}`}>×</button>
                      </form>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

        <form action={addWeeklyHours} className="mt-5 flex flex-wrap items-end gap-4 border-t border-stone-100 pt-4">
          <fieldset>
            <legend className="text-sm font-medium text-stone-700">Days</legend>
            <div className="mt-1 flex flex-wrap gap-2">
              {WEEKDAYS.map((day, i) => (
                <label key={day} className="flex items-center gap-1 rounded-lg border border-stone-200 px-2 py-1 text-sm">
                  <input type="checkbox" name="weekday" value={i} /> {day.slice(0, 3)}
                </label>
              ))}
            </div>
          </fieldset>
          <TimeSelect name="start" label="From" defaultValue="09:00" />
          <TimeSelect name="end" label="To" defaultValue="13:00" />
          <button className="btn-primary">Add hours</button>
        </form>
      </section>

      <section className="card">
        <h2 className="font-semibold">Date overrides & blackout dates</h2>
        <ul className="mt-3 divide-y divide-stone-100">
          {(overrides ?? []).map((o) => (
            <li key={o.id} className="flex items-center justify-between py-2 text-sm">
              <span>
                <span className={`badge mr-2 ${o.kind === "blackout" ? "bg-stone-200 text-stone-700" : "bg-green-100 text-green-800"}`}>
                  {o.kind === "blackout" ? "Off" : "Extra hours"}
                </span>
                {formatDate(`${o.date}T12:00:00Z`, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })}
                {o.start_time ? ` · ${label(o.start_time)} – ${label(o.end_time!)}` : " · all day"}
                {o.note && <span className="text-stone-500"> — {o.note}</span>}
              </span>
              <form action={removeDateOverride}>
                <input type="hidden" name="id" value={o.id} />
                <button className="text-stone-500 hover:text-red-600">Remove</button>
              </form>
            </li>
          ))}
          {!overrides?.length && <li className="py-2 text-sm text-stone-400">No upcoming changes.</li>}
        </ul>

        <form action={addDateOverride} className="mt-4 grid gap-4 border-t border-stone-100 pt-4 sm:grid-cols-6 sm:items-end">
          <label className="flex flex-col gap-1 text-sm font-medium text-stone-700 sm:col-span-2">
            Type
            <select name="kind" className="input" defaultValue="blackout">
              <option value="blackout">Time off (blackout)</option>
              <option value="available">Extra hours</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-stone-700">
            Date
            <input type="date" name="date" min={today} required className="input" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-stone-700">
            Through <span className="font-normal text-stone-500">(time off)</span>
            <input type="date" name="endDate" min={today} className="input" />
          </label>
          <TimeSelect name="start" label="From" defaultValue="09:00" />
          <TimeSelect name="end" label="To" defaultValue="12:00" />
          <label className="flex items-center gap-2 text-sm text-stone-700 sm:col-span-2">
            <input type="checkbox" name="wholeDay" defaultChecked /> Whole day (time off only)
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-stone-700 sm:col-span-3">
            Note <span className="font-normal text-stone-500">(only you and the owner see this)</span>
            <input name="note" maxLength={200} className="input" />
          </label>
          <button className="btn-primary">Add</button>
        </form>
      </section>

      <section className="card">
        <h2 className="font-semibold">Zones you&apos;ll travel to</h2>
        <form action={saveZones} className="mt-3 space-y-2">
          {(zones ?? []).map((z) => (
            <label key={z.id} className="flex items-start gap-3 rounded-xl border border-stone-200 p-3 text-sm">
              <input type="checkbox" name="zoneId" value={z.id} defaultChecked={covered.has(z.id)} className="mt-1" />
              <span>
                <span className="font-medium">Zone {z.code} · {z.name}</span>
                <span className="block text-stone-500">{z.description}</span>
                <span className="block text-xs text-stone-400">
                  {z.travel_fee_cents ? `Families pay a ${formatCents(z.travel_fee_cents)} travel fee` : "No travel fee"}
                  {z.min_booking_minutes ? ` · ${z.min_booking_minutes}-minute minimum booking` : ""}
                </span>
              </span>
            </label>
          ))}
          <button className="btn-primary">Save zones</button>
        </form>
      </section>
    </div>
  );
}

function TimeSelect({ name, label: text, defaultValue }: { name: string; label: string; defaultValue: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium text-stone-700">
      {text}
      <select name={name} defaultValue={defaultValue} className="input">
        {TIME_OPTIONS.map((t) => (
          <option key={t} value={t}>
            {label(t)}
          </option>
        ))}
      </select>
    </label>
  );
}
