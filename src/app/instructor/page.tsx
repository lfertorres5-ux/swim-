import Link from "next/link";
import { getInstructorContext } from "@/lib/instructor-context";
import { createClient } from "@/lib/supabase/server";
import { formatTime, hasStarted, laDateString } from "@/lib/time";

type LessonChild = { first_name: string; age: number | null; swim_level: string; notes: string | null };
type Address = { line1: string; line2: string | null; city: string; postal_code: string; access_notes: string | null };
type Lesson = {
  booking_id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  zone_code: string;
  neighborhood: string | null;
  children: LessonChild[];
  address: Address | null;
  address_visible: boolean;
  address_visible_from: string;
  has_note: boolean;
};

/**
 * Today's route. Client details come ONLY from the audited instructor_lessons
 * RPC: each lesson shown here writes an audit_log row, and the street address
 * is present only inside the day-of reveal window.
 */
export default async function InstructorToday() {
  const ctx = await getInstructorContext();
  if (!ctx.isActive) return <p className="card text-stone-600">Lessons will appear here once your account is activated.</p>;
  const supabase = await createClient();
  const today = laDateString();
  const { data, error } = await supabase.rpc("instructor_lessons", { p_from: today, p_to: today });
  const lessons = (data ?? []) as Lesson[];

  return (
    <div>
      <h1 className="text-2xl font-semibold">Today&apos;s lessons</h1>
      <p className="mt-1 text-sm text-stone-500">
        Addresses show up on the day of each lesson. Families who bought a package are in{" "}
        <a href="/instructor/families" className="underline">
          Families
        </a>{" "}
        with their phone and email.
      </p>
      {error && <p className="mt-4 text-red-600">Couldn&apos;t load lessons.</p>}
      <ol className="mt-6 space-y-4">
        {lessons.map((l, i) => (
          <li key={l.booking_id} className="card">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-semibold">
                {i + 1}. {formatTime(l.starts_at)}–{formatTime(l.ends_at)}
                <span className="ml-2 font-normal text-stone-500">
                  Zone {l.zone_code} · {l.neighborhood}
                </span>
              </p>
              <span className="badge bg-stone-100 text-stone-600">{l.status.replace("_", " ")}</span>
            </div>
            <ul className="mt-2 text-sm text-stone-700">
              {l.children.map((c) => (
                <li key={c.first_name}>
                  <strong>{c.first_name}</strong>
                  {c.age !== null && `, ${c.age}`} · {c.swim_level.replaceAll("_", " ")}
                  {c.notes && <span className="block text-stone-500">“{c.notes}”</span>}
                </li>
              ))}
            </ul>
            {hasStarted(l.starts_at) && (
              <Link href={`/instructor/lessons/${l.booking_id}/note`} className={`mt-3 ${l.has_note ? "btn-secondary" : "btn-primary"} w-full sm:w-auto`}>
                {l.has_note ? "Edit progress note" : "Write progress note"}
              </Link>
            )}
            {l.address ? (
              <div className="mt-3 rounded-xl bg-brand-50 p-3 text-sm">
                <p className="font-medium">
                  {l.address.line1}
                  {l.address.line2 && `, ${l.address.line2}`}, {l.address.city} {l.address.postal_code}
                </p>
                {l.address.access_notes && <p className="text-stone-600">{l.address.access_notes}</p>}
                <a
                  className="mt-1 inline-block font-medium text-brand-700"
                  target="_blank"
                  rel="noreferrer"
                  href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
                    `${l.address.line1}, ${l.address.city}, CA ${l.address.postal_code}`,
                  )}`}
                >
                  Directions →
                </a>
              </div>
            ) : (
              <p className="mt-3 text-sm text-stone-500">{hasStarted(l.address_visible_from) ? "Address is hidden again after the lesson." : "Address appears on lesson day."}</p>
            )}
          </li>
        ))}
        {!lessons.length && !error && <li className="card text-stone-600">No lessons today.</li>}
      </ol>
      <p className="mt-6 text-sm text-stone-500">
        Can&apos;t make an upcoming lesson?{" "}
        <Link href="/instructor/sub-board" className="font-medium text-brand-700">
          Find a sub →
        </Link>
      </p>
    </div>
  );
}
