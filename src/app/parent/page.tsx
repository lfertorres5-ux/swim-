import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/time";
import { one } from "@/lib/utils";

export default async function ParentHome() {
  const user = await requireRole("parent");
  const supabase = await createClient();

  // RLS scopes every query to this family — no parent_id filter is needed for
  // safety; filters below are for intent and index use.
  const [{ data: upcoming }, { data: children }, { data: parent }] = await Promise.all([
    supabase
      .from("bookings")
      .select("id, starts_at, ends_at, status, neighborhood, instructor:instructors!bookings_instructor_id_fkey(display_name)")
      .eq("parent_id", user.id)
      .gte("ends_at", new Date().toISOString())
      .in("status", ["pending_payment", "pending_instructor", "confirmed"])
      .order("starts_at")
      .limit(20),
    supabase.from("children").select("id, first_name, swim_level").eq("is_active", true).order("first_name"),
    supabase.from("parents").select("favorite:instructors!parents_favorite_instructor_id_fkey(display_name)").eq("id", user.id).maybeSingle(),
  ]);

  const favorite = one(parent?.favorite)?.display_name;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <section className="lg:col-span-2">
        <h1 className="text-2xl font-semibold">Hi {user.firstName ?? "there"} 👋</h1>
        <h2 className="mt-6 mb-3 font-semibold text-slate-700">Upcoming lessons</h2>
        {upcoming?.length ? (
          <ul className="space-y-3">
            {upcoming.map((b) => (
              <li key={b.id} className="card flex items-center justify-between">
                <div>
                  <p className="font-medium">{formatDateTime(b.starts_at)}</p>
                  <p className="text-sm text-slate-500">
                    with {one(b.instructor)?.display_name ?? "an instructor (being matched)"}
                  </p>
                </div>
                <span className="badge bg-sky-50 text-sky-700">{b.status.replace("_", " ")}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="card text-slate-600">No upcoming lessons yet. Booking opens in the next release.</p>
        )}
      </section>
      <aside className="space-y-4">
        <div className="card">
          <h2 className="font-semibold">Swimmers</h2>
          <ul className="mt-2 text-sm text-slate-700">
            {(children ?? []).map((c) => (
              <li key={c.id}>
                {c.first_name} · <span className="text-slate-500">{c.swim_level.replaceAll("_", " ")}</span>
              </li>
            ))}
            {!children?.length && <li className="text-slate-500">Add swimmers when you book.</li>}
          </ul>
        </div>
        {favorite && (
          <div className="card">
            <h2 className="font-semibold">Favorite instructor</h2>
            <p className="mt-1 text-sm text-slate-700">{favorite}</p>
          </div>
        )}
      </aside>
    </div>
  );
}
