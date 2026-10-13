import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { LEVEL_LABELS } from "@/lib/instructors";
import { getAvailability } from "@/lib/scheduling/service";
import { SchedulingError, SWIM_LEVELS, type SlotResult, type SwimLevel } from "@/lib/scheduling/types";
import { createClient } from "@/lib/supabase/server";
import { addDays, formatDate, formatTime, laDateString } from "@/lib/time";

export const metadata: Metadata = { title: "Scheduling preview" };

/**
 * Run any request through the scheduling engine and see exactly what a
 * family would be offered, with the ranking explained.
 */
export default async function SchedulingPreview({ searchParams }: PageProps<"/admin/scheduling">) {
  await requireRole("admin");
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);

  const supabase = await createClient();
  const [{ data: zones }, { data: instructors }, { data: prices }] = await Promise.all([
    supabase.from("zones").select("id, code, name, min_booking_minutes").eq("is_bookable", true).order("sort_order"),
    supabase.from("instructors").select("id, first_name").eq("is_active", true).order("sort_order"),
    supabase.from("lesson_prices").select("duration_minutes").eq("is_active", true).order("sort_order"),
  ]);

  const today = laDateString();
  const zoneId = str("zone") ?? zones?.[0]?.id;
  const duration = Number(str("duration") ?? 60);
  const swimmers = Math.min(6, Math.max(1, Number(str("swimmers") ?? 1)));
  const level = (SWIM_LEVELS as readonly string[]).includes(str("level") ?? "") ? (str("level") as SwimLevel) : "beginner";
  const ageYears = Number(str("age") ?? 6);
  const from = str("from") ?? addDays(today, 1);
  const days = Math.min(31, Math.max(1, Number(str("days") ?? 14)));
  const instructorId = str("instructor") || null;
  const ignoreNotice = str("ignoreNotice") === "on";
  const names = new Map((instructors ?? []).map((i) => [i.id, i.first_name]));

  let result: SlotResult | null = null;
  let error: string | null = null;
  if (zoneId) {
    try {
      result = await getAvailability({
        zoneId,
        durationMinutes: duration,
        swimmers: Array.from({ length: swimmers }, () => ({ ageMonths: ageYears * 12, level })),
        fromDate: from,
        toDate: addDays(from, days - 1),
        instructorId,
        ignoreNotice,
      });
    } catch (err) {
      error = err instanceof SchedulingError ? err.message : "Couldn't load availability (check SUPABASE_SERVICE_ROLE_KEY).";
    }
  }

  const byDate = new Map<string, SlotResult["slots"]>();
  for (const s of result?.slots ?? []) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Scheduling preview</h1>
        <p className="mt-1 text-sm text-slate-500">
          What a family would see. Slots respect weekly hours, overrides, existing lessons and zone-to-zone travel time.
          The <span className="badge bg-emerald-100 text-emerald-800">Neighborhood</span> badge marks slots next to a lesson in
          the same zone; they get the neighborhood discount.
        </p>
      </div>

      <form className="card grid gap-4 sm:grid-cols-4 lg:grid-cols-8 lg:items-end">
        <Field label="Zone">
          <select name="zone" defaultValue={zoneId} className="input">
            {(zones ?? []).map((z) => (
              <option key={z.id} value={z.id}>
                {z.code} · {z.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Length">
          <select name="duration" defaultValue={duration} className="input">
            {(prices ?? []).map((p) => (
              <option key={p.duration_minutes} value={p.duration_minutes}>
                {p.duration_minutes} min
              </option>
            ))}
          </select>
        </Field>
        <Field label="Swimmers">
          <input type="number" name="swimmers" min={1} max={6} defaultValue={swimmers} className="input" />
        </Field>
        <Field label="Age">
          <input type="number" name="age" min={0} max={18} defaultValue={ageYears} className="input" />
        </Field>
        <Field label="Level">
          <select name="level" defaultValue={level} className="input">
            {SWIM_LEVELS.map((l) => (
              <option key={l} value={l}>
                {LEVEL_LABELS[l]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Instructor">
          <select name="instructor" defaultValue={instructorId ?? ""} className="input">
            <option value="">First available</option>
            {(instructors ?? []).map((i) => (
              <option key={i.id} value={i.id}>
                {i.first_name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="From">
          <input type="date" name="from" defaultValue={from} className="input" />
        </Field>
        <Field label="Days">
          <input type="number" name="days" min={1} max={31} defaultValue={days} className="input" />
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2">
          <input type="checkbox" name="ignoreNotice" defaultChecked={ignoreNotice} /> Ignore minimum notice (admin booking)
        </label>
        <button className="btn-primary sm:col-span-2">Find slots</button>
      </form>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {result && (
        <>
          <section className="card">
            <h2 className="font-semibold">Suggested (best for routing)</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {result.suggested.map((s) => (
                <SlotChip key={s.start} slot={s} names={names} showDate />
              ))}
              {!result.suggested.length && <p className="text-sm text-slate-500">No availability in this range.</p>}
            </div>
          </section>

          <section className="space-y-3">
            {[...byDate.entries()].map(([date, slots]) => (
              <div key={date} className="card">
                <h3 className="text-sm font-semibold text-slate-700">{formatDate(`${date}T12:00:00Z`, { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" })}</h3>
                <div className="mt-2 flex flex-wrap gap-2">
                  {slots.map((s) => (
                    <SlotChip key={s.start} slot={s} names={names} />
                  ))}
                </div>
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
      {label}
      {children}
    </label>
  );
}

function SlotChip({ slot, names, showDate }: { slot: SlotResult["slots"][number]; names: Map<string, string>; showDate?: boolean }) {
  const best = slot.candidates[0];
  const explanation = slot.candidates
    .map((c) => `${names.get(c.instructorId) ?? "?"}: ${c.score.toFixed(0)}${c.reasons.length ? ` (${c.reasons.join("; ")})` : ""}`)
    .join("\n");
  return (
    <span
      title={explanation}
      className={`rounded-lg border px-2.5 py-1.5 text-sm ${slot.isNeighborhoodSlot ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-white"}`}
    >
      {showDate && <span className="mr-1 text-slate-500">{formatDate(new Date(slot.start))}</span>}
      <span className="font-medium">{formatTime(new Date(slot.start))}</span>
      <span className="ml-1 text-slate-500">· {names.get(best.instructorId)}</span>
      {slot.candidates.length > 1 && <span className="ml-1 text-xs text-slate-400">+{slot.candidates.length - 1}</span>}
      {slot.isNeighborhoodSlot && <span className="badge ml-2 bg-emerald-100 text-emerald-800">Neighborhood</span>}
    </span>
  );
}
