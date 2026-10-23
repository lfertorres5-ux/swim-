"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { flashQuery } from "@/lib/flash";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { notifyLessonCompleted, notifyNoShow, safely } from "@/lib/notifications/events";
import { SKILL_STATES } from "@/lib/skills";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({
  bookingId: z.guid(),
  skills: z.record(z.string().max(60), z.record(z.string().max(80), z.enum(SKILL_STATES))),
  summary: z.string().trim().min(1, "Add a quick comment for the family").max(2000),
  nextFocus: z.string().trim().max(500).optional(),
});

export async function submitNoteAction(raw: unknown): Promise<{ ok: true; firstTime: boolean } | { ok: false; error: string }> {
  await requireRole("instructor");
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const v = parsed.data;

  // Runs as the instructor: the RPC checks it's their lesson and that it has started.
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submit_lesson_note", {
    p_booking_id: v.bookingId,
    p_skills: v.skills,
    p_summary: v.summary,
    p_next_focus: v.nextFocus ?? null,
  });
  if (error) {
    const msg = error.code === "SB005" ? "You can send the note once the lesson has started." : error.code === "42501" ? "This isn't your lesson." : error.message;
    return { ok: false, error: msg };
  }
  if (data === true) await safely("lesson completed", () => notifyLessonCompleted(v.bookingId));
  revalidatePath("/instructor", "layout");
  return { ok: true, firstTime: data === true };
}

/** "Family didn't show": logs the lesson as a no-show and the instructor's no-show pay. */
export async function markNoShowAction(formData: FormData) {
  await requireRole("instructor");
  const bookingId = z.guid().parse(formData.get("bookingId"));
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_no_show", { p_booking_id: bookingId });
  if (error) {
    const msg = error.code === "SB005" ? "You can mark a no-show 10 minutes after the lesson starts." : error.code === "SB002" ? "This lesson was already logged." : "Couldn't mark the no-show.";
    redirect(`/instructor/lessons/${bookingId}/note?${flashQuery("error", msg)}`);
  }
  await safely("no-show", () => notifyNoShow(bookingId));
  revalidatePath("/instructor", "layout");
  redirect(`/instructor/earnings?${flashQuery("notice", "Marked as a no-show. Your pay for it is logged below.")}`);
}
