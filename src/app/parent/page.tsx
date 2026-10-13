import Link from "next/link";
import { ContactCard } from "@/components/contact-card";
import { InstructorCard } from "@/components/instructor-card";
import { requireRole } from "@/lib/auth";
import { loadInstructorCards } from "@/lib/instructor-cards";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime } from "@/lib/time";
import { one } from "@/lib/utils";
import { toggleFavoriteAction } from "./actions";

const STATUS: Record<string, { label: string; cls: string }> = {
  pending_payment: { label: "Awaiting payment", cls: "bg-amber-50 text-amber-800" },
  pending_instructor: { label: "Awaiting instructor", cls: "bg-amber-50 text-amber-800" },
  confirmed: { label: "Confirmed", cls: "bg-emerald-50 text-emerald-800" },
};

export default async function ParentHome() {
  const user = await requireRole("parent");
  const supabase = await createClient();

  const [{ data: upcoming }, { data: packages }, { data: notes }, { data: parent }] = await Promise.all([
    supabase
      .from("bookings")
      .select("id, starts_at, ends_at, status, kind, instructor:instructors!bookings_instructor_id_fkey(first_name), booking_children(child:children(first_name))")
      .gte("ends_at", new Date().toISOString())
      .in("status", ["pending_instructor", "confirmed"])
      .order("starts_at")
      .limit(20),
    supabase.from("packages").select("id, lesson_count, lessons_remaining, duration_minutes, expires_at").eq("status", "active").gt("lessons_remaining", 0),
    supabase.from("lesson_notes").select("id, summary, created_at, booking:bookings(starts_at)").order("created_at", { ascending: false }).limit(3),
    supabase.from("parents").select("favorite_instructor_id").eq("id", user.id).single(),
  ]);
  const [favorite] = parent?.favorite_instructor_id ? await loadInstructorCards([parent.favorite_instructor_id]) : [];
  // Audited RPC: instructors who accepted a lesson from one of your packages.
  const { data: contacts } = await supabase.rpc("my_instructor_contacts");
  const instructorContacts = (contacts ?? []) as { first_name: string; last_name: string | null; email: string | null; phone: string | null }[];

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <section className="space-y-4 lg:col-span-2">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Hi {user.firstName ?? "there"} 👋</h1>
          <Link href="/book" className="btn-primary">
            Book a lesson
          </Link>
        </div>
        <h2 className="font-semibold text-slate-700">Upcoming lessons</h2>
        {upcoming?.length ? (
          <ul className="space-y-3">
            {upcoming.map((b) => {
              const s = STATUS[b.status] ?? { label: b.status, cls: "bg-slate-100" };
              const kids = (b.booking_children ?? []).map((bc) => one(bc.child)?.first_name).filter(Boolean).join(", ");
              return (
                <li key={b.id}>
                  <Link href={`/parent/lessons/${b.id}`} className="card flex items-center justify-between hover:border-sky-300">
                    <div>
                      <p className="font-medium">{formatDateTime(b.starts_at)}</p>
                      <p className="text-sm text-slate-500">
                        {kids} · with {one(b.instructor)?.first_name ?? "your instructor (matching)"}
                        {b.kind === "recurring" ? " · weekly" : ""}
                      </p>
                    </div>
                    <span className={`badge ${s.cls}`}>{s.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="card text-slate-600">No upcoming lessons. Ready to get in the pool?</p>
        )}
      </section>

      <aside className="space-y-4">
        <ContactCard
          title={instructorContacts.length > 1 ? "Your instructors" : "Your instructor"}
          people={instructorContacts.map((c) => ({ name: [c.first_name, c.last_name].filter(Boolean).join(" "), email: c.email, phone: c.phone }))}
          note="Reach out directly to coordinate. Please keep booking and paying through your account so your lessons stay covered."
        />
        {favorite && (
          <div className="space-y-2">
            <h2 className="font-semibold text-slate-700">Your favorite instructor</h2>
            <InstructorCard instructor={favorite} favorite compact />
            <div className="flex gap-3 text-sm">
              <Link className="btn-secondary" href={`/book?instructor=${favorite.id}`}>
                Book {favorite.firstName} again
              </Link>
              <form action={toggleFavoriteAction}>
                <input type="hidden" name="instructorId" value={favorite.id} />
                <button className="text-slate-500 underline">Remove</button>
              </form>
            </div>
          </div>
        )}
        {!!packages?.length && (
          <div className="card">
            <h2 className="font-semibold">Package credits</h2>
            <ul className="mt-2 space-y-1 text-sm">
              {packages.map((p) => (
                <li key={p.id}>
                  {p.lessons_remaining} of {p.lesson_count} × {p.duration_minutes}-min lessons left
                  {p.expires_at && <span className="text-slate-500"> · use by {formatDate(p.expires_at)}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="card">
          <h2 className="font-semibold">Recent progress</h2>
          <ul className="mt-2 space-y-3 text-sm">
            {(notes ?? []).map((n) => (
              <li key={n.id}>
                <p className="text-xs text-slate-500">{one(n.booking) ? formatDate(one(n.booking)!.starts_at) : ""}</p>
                <p className="text-slate-700">{n.summary}</p>
              </li>
            ))}
            {!notes?.length && <li className="text-slate-500">Your instructor&apos;s notes appear here after each lesson.</li>}
          </ul>
          <Link href="/parent/progress" className="mt-3 inline-block text-sm text-sky-700 underline">
            All progress notes
          </Link>
        </div>
      </aside>
    </div>
  );
}
