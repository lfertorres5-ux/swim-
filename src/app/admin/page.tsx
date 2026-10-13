import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { laDateString, addDays } from "@/lib/time";

export default async function AdminHome() {
  await requireRole("admin");
  const supabase = await createClient();
  const today = laDateString();
  const certCutoff = addDays(today, 30);

  const count = (q: PromiseLike<{ count: number | null }>) => q.then((r) => r.count ?? 0);
  const [upcoming, instructors, openFlags, newInquiries, openShifts, expiring, attention, awaiting] = await Promise.all([
    count(supabase.from("bookings").select("id", { count: "exact", head: true }).eq("status", "confirmed").gte("starts_at", new Date().toISOString())),
    count(supabase.from("instructors").select("id", { count: "exact", head: true }).eq("is_active", true)),
    count(supabase.from("flagged_messages").select("id", { count: "exact", head: true }).eq("status", "open")),
    count(supabase.from("day_pass_inquiries").select("id", { count: "exact", head: true }).eq("status", "new")),
    count(supabase.from("open_shifts").select("id", { count: "exact", head: true }).in("status", ["open", "pending_approval"])),
    count(supabase.from("instructor_certifications").select("id", { count: "exact", head: true }).lte("expires_on", certCutoff)),
    count(supabase.from("bookings").select("id", { count: "exact", head: true }).eq("needs_attention", true)),
    count(supabase.from("bookings").select("id", { count: "exact", head: true }).eq("status", "pending_instructor")),
  ]);

  const tiles = [
    { label: "Upcoming confirmed lessons", value: upcoming },
    { label: "Requests awaiting an instructor", value: awaiting },
    { label: "Bookings needing attention (no instructor matched)", value: attention, alert: attention > 0 },
    { label: "Active instructors", value: instructors },
    { label: "Open sub-board shifts", value: openShifts },
    { label: "Flagged messages to review", value: openFlags, alert: openFlags > 0 },
    { label: "New day-pass inquiries", value: newInquiries, alert: newInquiries > 0 },
    { label: "Certifications expiring ≤ 30 days", value: expiring, alert: expiring > 0 },
  ];

  return (
    <div>
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <p className="mt-1 text-sm text-stone-500">Full admin tools (instructors, pricing, zones, refunds, sub board) arrive in Phase 5.</p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((t) => (
          <div key={t.label} className={`card ${t.alert ? "border-amber-300 bg-amber-50" : ""}`}>
            <p className="text-sm text-stone-500">{t.label}</p>
            <p className="mt-1 text-3xl font-semibold">{t.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
