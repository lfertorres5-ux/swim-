import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/time";
import { one } from "@/lib/utils";

const LABEL: Record<string, string> = { introduced: "Introduced", progressing: "Progressing", mastered: "Mastered" };

export default async function ProgressPage() {
  await requireRole("parent");
  const supabase = await createClient();
  const { data: notes } = await supabase
    .from("lesson_notes")
    .select("id, summary, next_focus, skills, created_at, booking:bookings(starts_at, instructor:instructors!bookings_instructor_id_fkey(first_name))")
    .order("created_at", { ascending: false });

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold">Progress notes</h1>
      {(notes ?? []).map((n) => {
        const booking = one(n.booking);
        const skills = (n.skills ?? {}) as Record<string, Record<string, string>>;
        return (
          <article key={n.id} className="card space-y-2">
            <p className="text-sm text-stone-500">
              {booking ? formatDate(booking.starts_at) : ""} · {one(booking?.instructor)?.first_name}
            </p>
            <p className="text-stone-800">{n.summary}</p>
            {Object.entries(skills).map(([swimmer, list]) => (
              <div key={swimmer} className="text-sm">
                <p className="font-medium">{swimmer}</p>
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {Object.entries(list).map(([skill, level]) => (
                    <li key={skill} className={`badge ${level === "mastered" ? "bg-emerald-100 text-emerald-800" : level === "progressing" ? "bg-brand-100 text-brand-800" : "bg-stone-100 text-stone-700"}`}>
                      {skill.replaceAll("_", " ")} · {LABEL[level] ?? level}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {n.next_focus && <p className="text-sm text-stone-600"><strong>Next time:</strong> {n.next_focus}</p>}
          </article>
        );
      })}
      {!notes?.length && <p className="card text-stone-600">Your instructor&apos;s notes appear here after each lesson.</p>}
    </div>
  );
}
