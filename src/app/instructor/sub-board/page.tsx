import { ActionForm } from "@/components/action-form";
import { getInstructorContext } from "@/lib/instructor-context";
import { LEVEL_LABELS } from "@/lib/instructors";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatTime } from "@/lib/time";
import { one } from "@/lib/utils";
import { claim, postToBoard, withdrawPost } from "./actions";

type Summary = { duration_minutes?: number; swimmers?: { age: number | null; swim_level: string }[] };
type BoardRow = { id: string; zone_code: string; neighborhood: string | null; starts_at: string; ends_at: string; lesson_summary: Summary; released_by_first_name: string; can_claim: boolean; blocked_reason: string | null };

const when = (start: string, end: string) => `${formatDate(start, { weekday: "short", month: "short", day: "numeric" })} · ${formatTime(start)}–${formatTime(end)}`;
const swimmers = (s: Summary) => (s.swimmers ?? []).map((x) => `${x.age === null ? "" : `${x.age}-yr-old `}${(LEVEL_LABELS[x.swim_level] ?? x.swim_level).toLowerCase()}`).join(", ");
const STATUS: Record<string, string> = { open: "Waiting for a sub", pending_approval: "Sub found — owner approving", filled: "Covered", cancelled: "Withdrawn", expired: "Expired" };

const DONE: Record<string, string> = {
  posted: "Posted. We'll let you know when someone picks it up — until then it's still yours.",
  withdrawn: "Taken off the board. The lesson is yours.",
  filled: "It's yours! It's on your schedule now.",
  claimed: "Claimed — waiting for the owner to approve.",
};

export default async function SubBoard({ searchParams }: PageProps<"/instructor/sub-board">) {
  const { done } = await searchParams;
  const ctx = await getInstructorContext();
  if (!ctx.isActive) return <p className="card text-stone-600">The sub board opens once your account is activated.</p>;
  const supabase = await createClient();
  const [{ data: board }, { data: mine }, { data: lessons }, { data: settings }] = await Promise.all([
    supabase.rpc("sub_board_shifts"),
    supabase
      .from("open_shifts")
      .select("id, booking_id, status, starts_at, ends_at, neighborhood, released_by, claimed_by, decision_note, created_at, to:instructors!open_shifts_claimed_by_fkey(first_name), from:instructors!open_shifts_released_by_fkey(first_name)")
      .or(`released_by.eq.${ctx.user.id},claimed_by.eq.${ctx.user.id}`)
      .order("starts_at", { ascending: false })
      .limit(30),
    supabase.from("bookings").select("id, starts_at, ends_at, neighborhood, zone:zones(code)").eq("instructor_id", ctx.user.id).eq("status", "confirmed").gte("starts_at", new Date().toISOString()).order("starts_at").limit(30),
    supabase.from("platform_settings").select("sub_board_min_notice_hours, sub_board_requires_approval").single(),
  ]);
  const rows = (board ?? []) as BoardRow[];
  const posts = (mine ?? []).filter((s) => s.released_by === ctx.user.id);
  const claims = (mine ?? []).filter((s) => s.claimed_by === ctx.user.id && s.status === "pending_approval");
  const posted = new Set(posts.filter((p) => ["open", "pending_approval"].includes(p.status)).map((p) => p.booking_id));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Sub board</h1>
        <p className="mt-1 text-sm text-stone-500">
          Can&apos;t make a lesson? Post it here and another instructor can pick it up. {settings?.sub_board_requires_approval ? "The owner approves each swap. " : ""}The family hears who&apos;s coming; nobody&apos;s contact details change hands.
        </p>
      </div>

      {typeof done === "string" && DONE[done] && (
        <p className="rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-800" role="status">
          {DONE[done]}
        </p>
      )}

      <section>
        <h2 className="mb-3 text-lg font-semibold">Up for grabs</h2>
        <ul className="space-y-3">
          {rows.map((s) => (
            <li key={s.id} className="card flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-semibold">{when(s.starts_at, s.ends_at)}</p>
                <p className="text-sm text-stone-600">
                  Zone {s.zone_code} · {s.neighborhood ?? "—"} · {swimmers(s.lesson_summary)}
                </p>
                <p className="text-xs text-stone-500">Posted by {s.released_by_first_name}</p>
              </div>
              {s.can_claim ? (
                <ActionForm action={claim} submitLabel="I'll take it" pendingLabel="Claiming…" inline>
                  <input type="hidden" name="shiftId" value={s.id} />
                </ActionForm>
              ) : (
                <span className="text-sm text-stone-500">{s.blocked_reason}</span>
              )}
            </li>
          ))}
          {!rows.length && <li className="card text-sm text-stone-500">Nothing on the board in your zones right now.</li>}
        </ul>
      </section>

      {claims.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Waiting on the owner</h2>
          <ul className="space-y-2">
            {claims.map((c) => (
              <li key={c.id} className="card text-sm">
                {when(c.starts_at, c.ends_at)} · {c.neighborhood} — covering for {one(c.from)?.first_name}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-1 text-lg font-semibold">Need a sub?</h2>
        <p className="mb-3 text-sm text-stone-500">Post at least {settings?.sub_board_min_notice_hours ?? 2} hours ahead. Closer than that, call the owner.</p>
        <ul className="space-y-3">
          {(lessons ?? [])
            .filter((l) => !posted.has(l.id))
            .map((l) => (
              <li key={l.id} className="card">
                <details>
                  <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2">
                    <span>
                      <span className="font-medium">{when(l.starts_at, l.ends_at)}</span>
                      <span className="text-sm text-stone-500">
                        {" "}
                        · Zone {one(l.zone)?.code} · {l.neighborhood}
                      </span>
                    </span>
                    <span className="text-sm font-medium text-brand-700">Find a sub</span>
                  </summary>
                  <ActionForm action={postToBoard} submitLabel="Post to the sub board" className="mt-3 space-y-3">
                    <input type="hidden" name="bookingId" value={l.id} />
                    <input name="reason" className="input" maxLength={300} placeholder="Reason (other instructors and the owner see this)" />
                  </ActionForm>
                </details>
              </li>
            ))}
          {!lessons?.length && <li className="card text-sm text-stone-500">No upcoming confirmed lessons.</li>}
        </ul>
      </section>

      {posts.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Your posts</h2>
          <ul className="card divide-y divide-stone-100 p-0">
            {posts.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                <span>
                  {when(p.starts_at, p.ends_at)} · <span className="text-stone-500">{STATUS[p.status]}</span>
                  {p.status === "filled" && one(p.to)?.first_name && <span className="text-stone-500"> by {one(p.to)?.first_name}</span>}
                </span>
                {["open", "pending_approval"].includes(p.status) && (
                  <ActionForm action={withdrawPost} submitLabel="Take it back" variant="link" inline confirm="Take this lesson off the board? You'll teach it.">
                    <input type="hidden" name="shiftId" value={p.id} />
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
