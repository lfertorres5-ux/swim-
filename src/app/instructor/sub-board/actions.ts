"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { FormState } from "@/components/action-form";
import { requireRole } from "@/lib/auth";
import { claimShift, releaseLesson, withdrawShift } from "@/lib/sub-board";
import { createClient } from "@/lib/supabase/server";

// The row an action changes moves to another section, so success is shown as a banner after a redirect.
const done = (r: { ok: true } | { ok: false; error: string }, outcome: string): FormState => {
  if (!r.ok) return { error: r.error };
  revalidatePath("/instructor", "layout");
  redirect(`/instructor/sub-board?done=${outcome}`);
};

export async function postToBoard(_: FormState, fd: FormData): Promise<FormState> {
  await requireRole("instructor");
  const reason = String(fd.get("reason") ?? "").trim().slice(0, 300) || null;
  const r = await releaseLesson(await createClient(), z.guid().parse(fd.get("bookingId")), reason);
  return done(r, "posted");
}

export async function withdrawPost(_: FormState, fd: FormData): Promise<FormState> {
  await requireRole("instructor");
  return done(await withdrawShift(await createClient(), z.guid().parse(fd.get("shiftId"))), "withdrawn");
}

export async function claim(_: FormState, fd: FormData): Promise<FormState> {
  await requireRole("instructor");
  const r = await claimShift(await createClient(), z.guid().parse(fd.get("shiftId")));
  return r.ok ? done(r, r.value === "filled" ? "filled" : "claimed") : { error: r.error };
}
