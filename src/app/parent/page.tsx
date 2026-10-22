import Link from "next/link";
import { ContactCard } from "@/components/contact-card";
import { InstructorCard } from "@/components/instructor-card";
import { requireRole } from "@/lib/auth";
import { loadInstructorCards } from "@/lib/instructor-cards";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime } from "@/lib/time";
import { one } from "@/lib/utils";
import { readFlash } from "@/lib/flash";
import { setAutoRenewAction, toggleFavoriteAction } from "./actions";

const STATUS: Record<string, { label: string; cls: string }> = {
  pending_payment: { label: "Awaiting payment", cls: "bg-amber-50 text-amber-800" },
  pending_instructor: { label: "Awaiting instructor", cls: "bg-amber-50 text-amber-800" },
  confirmed: { label: "Confirmed", cls: "bg-emerald-50 text-emerald-800" },
};

const money = (c: number) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;

export default async function ParentHome({ searchParams }: PageProps<"/parent">) {
  const user = await requireRole("parent");
  const sp = await searchParams;
  const notice = readFlash(sp, "notice");
  const flashError = readFlash(sp, "error");
  const supabase = await createClient();

  const [{ data: upcoming }, { data: packages }, { data: notes }, { data: parent }] = await Promise.all([
    supabase
      .from("bookings")
      .select("id, starts_at, ends_at, status, kind, instructor:instructors!bookings_instructor_id_fkey(first_name), booking_children(child:children(first_name))")
      .gte("ends_at", new Date().toISOString())
      .in("status", ["pending_instructor", "confirmed"])
      .order("starts_at")
      .limit(20),
    supabase
      .from("packages")
      .select("id, lesson_count, lessons_remaining, duration_minutes, expires_at, status, total_cents, auto_renew, renewal_amount_cents, renewal_charge_at, renewal_started_at, renewed_to_package_id, renewal_failed_at")
      .in("status", ["active", "exhausted"])
      .is("renewed_to_package_id", null)
      .order("created_at"),
    supabase.from("lesson_notes").select("id, summary, created_at, booking:bookings(starts_at)").order("created_at", { ascending: false }).limit(3),
    supabase.from("parents").select("favorite_instructor_id").eq("id", user.id).single(),
  ]);
  // Packages with lessons left, plus used-up ones still set to renew.
  const shownPackages = (packages ?? []).filter((p) => p.lessons_remaining > 0 || p.auto_renew);
  const [favorite] = parent?.favorite_instructor_id ? await loadInstructorCards([parent.favorite_instructor_id]) : [];
  // Audited RPC: instructors who accepted a lesson from one of your packages.
  const { data: contacts } = await supabase.rpc("my_instructor_contacts");
  const instructorContacts = (contacts ?? []) as { first_name: string; last_name: string | null; email: string | null; phone: string | null }[];

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <section className="space-y-4 lg:col-span-2">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Hi {user.firstName ?? "there"}</h1>
          <Link href="/book" className="btn-primary">
            Book a lesson
          </Link>
        </div>
        <h2 className="font-semibold text-stone-700">Upcoming lessons</h2>
        {upcoming?.length ? (
          <ul className="space-y-3">
            {upcoming.map((b) => {
              const s = STATUS[b.status] ?? { label: b.status, cls: "bg-stone-100" };
              const kids = (b.booking_children ?? []).map((bc) => one(bc.child)?.first_name).filter(Boolean).join(", ");
              return (
                <li key={b.id}>
                  <Link href={`/parent/lessons/${b.id}`} className="card flex items-center justify-between hover:border-brand-300">
                    <div>
                      <p className="font-medium">{formatDateTime(b.starts_at)}</p>
                      <p className="text-sm text-stone-500">
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
          <p className="card text-stone-600">Nothing on the calendar yet.</p>
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
            <h2 className="font-semibold text-stone-700">Your favorite instructor</h2>
            <InstructorCard instructor={favorite} favorite compact />
            <div className="flex gap-3 text-sm">
              <Link className="btn-secondary" href={`/book?instructor=${favorite.id}`}>
                Book {favorite.firstName} again
              </Link>
              <form action={toggleFavoriteAction}>
                <input type="hidden" name="instructorId" value={favorite.id} />
                <button className="text-stone-500 underline">Remove</button>
              </form>
            </div>
          </div>
        )}
        {(notice || flashError) && (
          <p className={`card text-sm ${flashError ? "text-coral-700" : "text-emerald-800"}`} role="status">
            {flashError ?? notice}
          </p>
        )}
        {!!shownPackages.length && (
          <div className="card" id="packages">
            <h2 className="font-semibold">Your packages</h2>
            <ul className="mt-2 space-y-4 text-sm">
              {shownPackages.map((p) => {
                const price = money(p.renewal_amount_cents ?? p.total_cents);
                const locked = Boolean(p.renewal_started_at);
                return (
                  <li key={p.id} className="space-y-1.5">
                    <p>
                      {p.lessons_remaining} of {p.lesson_count} × {p.duration_minutes}-min lessons left
                      {p.expires_at && p.lessons_remaining > 0 && <span className="text-stone-500"> · use by {formatDate(p.expires_at)}</span>}
                    </p>
                    {p.auto_renew ? (
                      <div className="rounded-xl bg-brand-50 p-3 text-brand-900">
                        <p>
                          <span className="font-semibold">Auto-renew is on.</span>{" "}
                          {p.renewal_charge_at
                            ? `Renews for ${price} on or after ${formatDate(p.renewal_charge_at)}.`
                            : `After you book the last lesson, we'll renew this package for ${price}. We email you at least 3 days before.`}
                        </p>
                        {!locked && (
                          <form action={setAutoRenewAction} className="mt-2">
                            <input type="hidden" name="packageId" value={p.id} />
                            <input type="hidden" name="on" value="false" />
                            <button className="font-semibold text-brand-800 underline">Turn off auto-renew</button>
                          </form>
                        )}
                      </div>
                    ) : (
                      <form action={setAutoRenewAction} className="text-stone-500">
                        <input type="hidden" name="packageId" value={p.id} />
                        <input type="hidden" name="on" value="true" />
                        {p.renewal_failed_at ? "Auto-renew stopped: the card didn't go through. " : "Auto-renew is off. "}
                        <button className="text-brand-700 underline">Turn on</button>
                        <span className="block text-xs">Renews this package for {price} on the card you used, after its last lesson is booked. We email 3 days before; turn off any time.</span>
                      </form>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        <div className="card">
          <h2 className="font-semibold">Recent progress</h2>
          <ul className="mt-2 space-y-3 text-sm">
            {(notes ?? []).map((n) => (
              <li key={n.id}>
                <p className="text-xs text-stone-500">{one(n.booking) ? formatDate(one(n.booking)!.starts_at) : ""}</p>
                <p className="text-stone-700">{n.summary}</p>
              </li>
            ))}
            {!notes?.length && <li className="text-stone-500">Your instructor&apos;s notes appear here after each lesson.</li>}
          </ul>
          <Link href="/parent/progress" className="mt-3 inline-block text-sm text-brand-700 underline">
            All progress notes
          </Link>
        </div>
      </aside>
    </div>
  );
}
