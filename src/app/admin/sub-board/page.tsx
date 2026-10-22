import { requireRole } from "@/lib/auth";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime, formatTime } from "@/lib/time";
import { one } from "@/lib/utils";
import { decideShiftAction } from "./actions";

type Summary = { duration_minutes?: number; swimmers?: { age: number | null; swim_level: string }[] };
const who = (s: Summary) => (s.swimmers ?? []).map((x) => `${x.age ?? "?"}y ${x.swim_level.replaceAll("_", " ")}`).join(", ");

export default async function AdminSubBoard({ searchParams }: PageProps<"/admin/sub-board">) {
  await requireRole("admin"); // every admin page checks on its own, never only via the layout
  const { done } = await searchParams;
  const supabase = await createClient();
  const [{ data: shifts }, { data: settings }] = await Promise.all([
    supabase
      .from("open_shifts")
      .select("id, booking_id, status, reason, starts_at, ends_at, neighborhood, lesson_summary, claimed_at, decided_at, decision_note, created_at, zone:zones(code), from:instructors!open_shifts_released_by_fkey(first_name), to:instructors!open_shifts_claimed_by_fkey(first_name)")
      .order("starts_at", { ascending: true })
      .limit(200),
    supabase.from("platform_settings").select("sub_board_requires_approval").single(),
  ]);
  const all = shifts ?? [];
  const pending = all.filter((s) => s.status === "pending_approval");
  const open = all.filter((s) => s.status === "open");
  const recent = all.filter((s) => ["filled", "cancelled", "expired"].includes(s.status)).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 20);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Sub board</h1>
        <p className="mt-1 text-sm text-stone-500">
          Instructors post lessons they can&apos;t teach; qualified, free instructors claim them. Families only ever see the sub&apos;s first name, and contact details stay private.{" "}
          {settings?.sub_board_requires_approval ? "You approve each sub." : "Claims fill instantly."}{" "}
          <Link href="/admin/settings/policies" className="text-brand-700 underline">
            Change
          </Link>
        </p>
      </div>

      {done && (
        <p className="rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-800" role="status">
          {done === "approved" ? "Approved — the family and both instructors have been told." : "Turned down — the lesson is back on the board."}
        </p>
      )}

      <section>
        <h2 className="mb-3 font-semibold">Waiting for you ({pending.length})</h2>
        <ul className="space-y-3">
          {pending.map((s) => (
            <li key={s.id} className="card flex flex-wrap items-center justify-between gap-4 border-amber-200">
              <div>
                <p className="font-medium">
                  {one(s.to)?.first_name} wants to cover {one(s.from)?.first_name}
                </p>
                <p className="text-sm text-stone-600">
                  <Link href={`/admin/bookings/${s.booking_id}`} className="hover:underline">
                    {formatDate(s.starts_at, { weekday: "long", month: "short", day: "numeric" })} · {formatTime(s.starts_at)}–{formatTime(s.ends_at)}
                  </Link>{" "}
                  · Zone {one(s.zone)?.code} {s.neighborhood} · {who(s.lesson_summary as Summary)}
                </p>
                {s.reason && <p className="text-sm text-stone-500">“{s.reason}”</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                <ActionForm action={decideShiftAction} submitLabel="Approve" inline>
                  <input type="hidden" name="shiftId" value={s.id} />
                  <input type="hidden" name="decision" value="approve" />
                </ActionForm>
                <ActionForm action={decideShiftAction} submitLabel="Turn down" variant="secondary" inline>
                  <input type="hidden" name="shiftId" value={s.id} />
                  <input type="hidden" name="decision" value="reject" />
                  <input name="note" className="input w-44 py-2" placeholder="Note (optional)" />
                </ActionForm>
              </div>
            </li>
          ))}
          {!pending.length && <li className="card text-sm text-stone-500">Nothing to approve.</li>}
        </ul>
      </section>

      <section>
        <h2 className="mb-3 font-semibold">Open ({open.length})</h2>
        <ul className="card divide-y divide-stone-100 p-0">
          {open.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
              <span>
                <Link href={`/admin/bookings/${s.booking_id}`} className="font-medium hover:underline">
                  {formatDateTime(s.starts_at)}
                </Link>{" "}
                · Zone {one(s.zone)?.code} {s.neighborhood} · {who(s.lesson_summary as Summary)}
              </span>
              <span className="text-stone-500">
                posted by {one(s.from)?.first_name}
                {s.reason && ` — “${s.reason}”`}
              </span>
            </li>
          ))}
          {!open.length && <li className="px-5 py-4 text-sm text-stone-500">No open lessons.</li>}
        </ul>
      </section>

      <section>
        <h2 className="mb-3 font-semibold">Recent</h2>
        <ul className="card divide-y divide-stone-100 p-0">
          {recent.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
              <span>
                {formatDateTime(s.starts_at)} · {one(s.from)?.first_name} → {one(s.to)?.first_name ?? "—"}
              </span>
              <span className={`badge ${s.status === "filled" ? "bg-brand-50 text-brand-800" : "bg-stone-100 text-stone-600"}`}>{s.status}</span>
            </li>
          ))}
          {!recent.length && <li className="px-5 py-4 text-sm text-stone-500">Nothing yet.</li>}
        </ul>
      </section>
    </div>
  );
}
