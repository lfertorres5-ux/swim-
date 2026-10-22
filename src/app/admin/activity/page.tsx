import { requireRole } from "@/lib/auth";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/time";

const FILTERS = [
  { key: "admin", label: "Admin changes", prefix: "admin." },
  { key: "instructor", label: "Instructor activity", prefix: "instructor." },
  { key: "parent", label: "Family activity", prefix: "parent." },
  { key: "system", label: "System & payments", prefix: "system." },
  { key: "all", label: "Everything", prefix: "" },
] as const;

export default async function Activity({ searchParams }: PageProps<"/admin/activity">) {
  await requireRole("admin"); // every admin page checks on its own, never only via the layout
  const sp = await searchParams;
  const f = FILTERS.find((x) => x.key === sp.f) ?? FILTERS[0];
  const supabase = await createClient();
  let q = supabase.from("audit_log").select("id, occurred_at, actor_id, actor_role, action, entity_type, entity_id, booking_id, metadata").order("occurred_at", { ascending: false }).limit(200);
  if (f.key === "system") q = q.or("action.like.system.%,action.like.payment.%");
  else if (f.prefix) q = q.like("action", `${f.prefix}%`);
  const { data: rows } = await q;

  const actorIds = [...new Set((rows ?? []).map((r) => r.actor_id).filter(Boolean))] as string[];
  const { data: actors } = actorIds.length ? await supabase.from("users").select("id, first_name, last_name, email").in("id", actorIds) : { data: [] };
  const name = (id: string | null) => {
    const a = actors?.find((x) => x.id === id);
    return a ? [a.first_name, a.last_name].filter(Boolean).join(" ") || a.email : "system";
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Activity log</h1>
          <p className="mt-1 text-sm text-stone-500">Every change and every time an instructor opens a family&apos;s details. The log can&apos;t be edited or deleted.</p>
        </div>
        <Link href="/admin/notifications" className="btn-secondary">
          Emails & texts sent
        </Link>
      </div>
      <nav className="flex gap-1 overflow-x-auto">
        {FILTERS.map((x) => (
          <Link key={x.key} href={`/admin/activity?f=${x.key}`} className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm ${f.key === x.key ? "bg-brand-600 font-medium text-white" : "bg-white text-stone-600"}`}>
            {x.label}
          </Link>
        ))}
      </nav>
      <ul className="card divide-y divide-stone-100 p-0 text-sm">
        {(rows ?? []).map((r) => (
          <li key={r.id} className="grid gap-1 px-5 py-2.5 sm:grid-cols-[150px_160px_1fr]">
            <span className="text-stone-500">{formatDateTime(r.occurred_at)}</span>
            <span className="truncate">
              {name(r.actor_id)} <span className="text-stone-400">{r.actor_role}</span>
            </span>
            <span>
              <span className="font-medium">{r.action.split(".").slice(1).join(".").replaceAll("_", " ") || r.action}</span>
              {r.booking_id && (
                <Link href={`/admin/bookings/${r.booking_id}`} className="ml-2 text-brand-700 hover:underline">
                  lesson →
                </Link>
              )}
              {r.metadata && Object.keys(r.metadata).length > 0 && <span className="block truncate font-mono text-xs text-stone-400">{JSON.stringify(r.metadata)}</span>}
            </span>
          </li>
        ))}
        {!rows?.length && <li className="px-5 py-6 text-center text-stone-500">Nothing yet.</li>}
      </ul>
    </div>
  );
}
