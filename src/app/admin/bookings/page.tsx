import Link from "next/link";
import { BOOKING_STATUS } from "@/lib/admin/labels";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatTime } from "@/lib/time";
import { one } from "@/lib/utils";

const VIEWS = [
  { key: "upcoming", label: "Upcoming" },
  { key: "attention", label: "Needs attention" },
  { key: "past", label: "Past" },
  { key: "cancelled", label: "Cancelled" },
] as const;

export default async function AdminBookings({ searchParams }: PageProps<"/admin/bookings">) {
  const sp = await searchParams;
  const view = (VIEWS.find((v) => v.key === sp.view)?.key ?? "upcoming") as (typeof VIEWS)[number]["key"];
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 60) : "";
  const supabase = await createClient();
  const nowIso = new Date().toISOString();

  let parentIds: string[] | null = null;
  if (q) {
    const safe = q.replace(/[%,()]/g, " ");
    const { data } = await supabase.from("users").select("id").eq("role", "parent").or(`first_name.ilike.%${safe}%,last_name.ilike.%${safe}%,email.ilike.%${safe}%`).limit(50);
    parentIds = (data ?? []).map((u) => u.id);
  }

  let query = supabase
    .from("bookings")
    .select("id, starts_at, ends_at, status, kind, neighborhood, needs_attention, attention_reason, zone:zones(code), instructor:instructors!bookings_instructor_id_fkey(first_name), parent:parents(user:users(first_name, last_name)), booking_children(child:children(first_name))")
    .limit(100);
  if (view === "upcoming") query = query.in("status", ["pending_payment", "pending_instructor", "confirmed"]).gte("starts_at", nowIso).order("starts_at");
  if (view === "attention") query = query.eq("needs_attention", true).order("starts_at");
  if (view === "past") query = query.in("status", ["confirmed", "completed", "no_show"]).lt("starts_at", nowIso).order("starts_at", { ascending: false });
  if (view === "cancelled") query = query.in("status", ["cancelled", "expired"]).order("starts_at", { ascending: false });
  if (parentIds) query = query.in("parent_id", parentIds.length ? parentIds : ["00000000-0000-0000-0000-000000000000"]);
  const { data: bookings } = await query;

  const dayOf = (iso: string) => formatDate(iso, { weekday: "long", month: "short", day: "numeric" });
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Bookings</h1>
          <p className="mt-1 text-sm text-stone-500">Open a lesson to reassign, cancel, refund or send a payment link.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/admin/scheduling" className="btn-secondary">
            Check availability
          </Link>
          <Link href="/admin/bookings/new" className="btn-primary">
            New booking
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="flex gap-1 overflow-x-auto">
          {VIEWS.map((v) => (
            <Link key={v.key} href={`/admin/bookings?view=${v.key}${q ? `&q=${encodeURIComponent(q)}` : ""}`} className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm ${view === v.key ? "bg-brand-600 font-medium text-white" : "bg-white text-stone-600"}`}>
              {v.label}
            </Link>
          ))}
        </nav>
        <form className="w-full sm:w-64">
          <input type="hidden" name="view" value={view} />
          <input name="q" defaultValue={q} className="input" placeholder="Search family name or email" />
        </form>
      </div>

      <ul className="card divide-y divide-stone-100 p-0">
        {(bookings ?? []).map((b, idx, all) => {
          const day = dayOf(b.starts_at);
          const header = idx === 0 || dayOf(all[idx - 1].starts_at) !== day;
          const parent = one(one(b.parent)?.user);
          const kids = (b.booking_children ?? []).map((bc) => one(bc.child)?.first_name).filter(Boolean).join(", ");
          const st = BOOKING_STATUS[b.status];
          return (
            <li key={b.id}>
              {header && <p className="bg-sand/60 px-5 py-2 text-xs font-semibold tracking-wide text-stone-500 uppercase">{day}</p>}
              <Link href={`/admin/bookings/${b.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 hover:bg-sand/40">
                <span className="w-32 shrink-0 text-sm font-medium">
                  {formatTime(b.starts_at)}–{formatTime(b.ends_at)}
                </span>
                <span className="min-w-0 flex-1 text-sm">
                  <span className="font-medium">
                    {parent?.first_name} {parent?.last_name}
                  </span>
                  <span className="text-stone-500"> · {kids || "—"} · Zone {one(b.zone)?.code} {b.neighborhood && `· ${b.neighborhood}`}</span>
                  {b.needs_attention && <span className="block text-xs text-amber-800">{b.attention_reason ?? "Needs attention"}</span>}
                </span>
                <span className="text-sm text-stone-600">{one(b.instructor)?.first_name ?? <em className="text-stone-400">no instructor</em>}</span>
                <span className={`badge ${st?.cls}`}>{st?.label ?? b.status}</span>
              </Link>
            </li>
          );
        })}
        {!bookings?.length && <li className="px-5 py-8 text-center text-sm text-stone-500">No bookings here.</li>}
      </ul>
    </div>
  );
}
