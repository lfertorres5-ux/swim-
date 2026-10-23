import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getInstructorContext } from "@/lib/instructor-context";
import { LEVEL_LABELS } from "@/lib/instructors";
import type { SwimLevel } from "@/lib/scheduling/types";
import { SKILLS_BY_LEVEL, type SkillsBySwimmer } from "@/lib/skills";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatTime, hasStarted } from "@/lib/time";
import { readFlash } from "@/lib/flash";
import { markNoShowAction } from "./actions";
import { NoteForm } from "./note-form";

export const metadata: Metadata = { title: "Progress note" };

type LessonRow = { booking_id: string; starts_at: string; ends_at: string; status: string; children: { first_name: string; age: number | null; swim_level: SwimLevel }[] };

export default async function NotePage({ params, searchParams }: PageProps<"/instructor/lessons/[id]/note">) {
  const flashError = readFlash(await searchParams, "error");
  const ctx = await getInstructorContext();
  if (!ctx.isActive) notFound();
  const { id } = await params;
  const supabase = await createClient();

  // Audited RPC; only returns the lesson if it's this instructor's.
  const { data, error } = await supabase.rpc("instructor_lesson", { p_booking_id: id });
  if (error || !data) notFound();
  const lesson = data as LessonRow;
  const { data: existing } = await supabase.from("lesson_notes").select("skills, summary, next_focus").eq("booking_id", id).maybeSingle();
  const started = hasStarted(lesson.starts_at);
  // A no-show can be marked once the lesson has been underway 10 minutes, and only if nothing is logged yet.
  const canMarkNoShow = lesson.status === "confirmed" && !existing && hasStarted(new Date(Date.parse(lesson.starts_at) + 10 * 60_000).toISOString());

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <Link href="/instructor" className="text-sm text-brand-700">
        ← Today
      </Link>
      <div>
        <h1 className="text-2xl font-semibold">Progress note</h1>
        <p className="text-stone-600">
          {formatDate(lesson.starts_at)} · {formatTime(lesson.starts_at)}–{formatTime(lesson.ends_at)}
        </p>
      </div>
      {flashError && (
        <p className="card text-sm text-coral-700" role="alert">
          {flashError}
        </p>
      )}
      {lesson.status === "no_show" ? (
        <p className="card text-stone-600">This lesson was marked as a no-show. Your pay for it is on your Earnings page.</p>
      ) : !started ? (
        <p className="card text-stone-600">You can write the note once the lesson starts.</p>
      ) : (
        <NoteForm
          bookingId={id}
          swimmers={lesson.children.map((c) => ({ firstName: c.first_name, age: c.age, levelLabel: LEVEL_LABELS[c.swim_level] ?? c.swim_level, skills: SKILLS_BY_LEVEL[c.swim_level] ?? [] }))}
          initial={existing ? { skills: (existing.skills ?? {}) as SkillsBySwimmer, summary: existing.summary ?? "", nextFocus: existing.next_focus ?? "" } : null}
        />
      )}
      {canMarkNoShow && (
        <details className="card text-sm">
          <summary className="cursor-pointer font-semibold text-stone-800">Family didn&apos;t show?</summary>
          <p className="mt-2 text-stone-600">
            If nobody was at the pool, mark the lesson as a no-show instead of writing a note. The family and the owner are told, the lesson isn&apos;t refunded, and your pay
            for it is logged.
          </p>
          <form action={markNoShowAction} className="mt-3">
            <input type="hidden" name="bookingId" value={id} />
            <button className="btn-secondary border-coral-300 text-coral-700">Mark as no-show</button>
          </form>
        </details>
      )}
    </div>
  );
}
