"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { laDateString, parseTimeOfDay } from "@/lib/time";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Pick a time");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date");

function done(error?: string): never {
  revalidatePath("/instructor", "layout");
  redirect(error ? `/instructor/availability?error=${encodeURIComponent(error)}` : "/instructor/availability");
}

export async function addWeeklyHours(formData: FormData) {
  const user = await requireRole("instructor");
  const parsed = z
    .object({ weekdays: z.array(z.coerce.number().int().min(0).max(6)).min(1, "Pick at least one day"), start: hhmm, end: hhmm })
    .safeParse({ weekdays: formData.getAll("weekday"), start: formData.get("start"), end: formData.get("end") });
  if (!parsed.success) done(parsed.error.issues[0].message);
  const { weekdays, start, end } = parsed.data;
  if (parseTimeOfDay(end) - parseTimeOfDay(start) < 30) done("End time must be at least 30 minutes after start");

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("availability_rules")
    .select("weekday, start_time, end_time")
    .eq("instructor_id", user.id)
    .in("weekday", weekdays)
    .is("effective_until", null);
  const overlaps = (existing ?? []).some(
    (r) => parseTimeOfDay(r.start_time) < parseTimeOfDay(end) && parseTimeOfDay(start) < parseTimeOfDay(r.end_time),
  );
  if (overlaps) done("Those hours overlap hours you already set — remove or adjust the existing block first");

  const { error } = await supabase.from("availability_rules").insert(
    weekdays.map((weekday) => ({ instructor_id: user.id, weekday, start_time: start, end_time: end, effective_from: laDateString() })),
  );
  done(error ? "Couldn't save those hours" : undefined);
}

export async function removeWeeklyHours(formData: FormData) {
  await requireRole("instructor");
  const id = z.guid().parse(formData.get("id"));
  const supabase = await createClient();
  // RLS restricts the delete to the instructor's own rows.
  await supabase.from("availability_rules").delete().eq("id", id);
  done();
}

export async function addDateOverride(formData: FormData) {
  const user = await requireRole("instructor");
  const kind = formData.get("kind") === "available" ? "available" : "blackout";
  const wholeDay = kind === "blackout" && formData.get("wholeDay") === "on";
  const parsed = z
    .object({ date: isoDate, endDate: isoDate.optional(), start: hhmm.optional(), end: hhmm.optional() })
    .safeParse({
      date: formData.get("date"),
      endDate: formData.get("endDate") || undefined,
      start: wholeDay ? undefined : formData.get("start"),
      end: wholeDay ? undefined : formData.get("end"),
    });
  if (!parsed.success) done(parsed.error.issues[0].message);
  const { date, endDate, start, end } = parsed.data;
  if (date < laDateString()) done("Pick today or a future date");
  if (!wholeDay && (!start || !end || parseTimeOfDay(end) <= parseTimeOfDay(start))) done("End time must be after start time");

  // Blackouts may span a range of dates (vacations); extra hours are one day at a time.
  const last = kind === "blackout" && endDate && endDate > date ? endDate : date;
  const dates: string[] = [];
  for (let d = new Date(`${date}T12:00:00Z`); d.toISOString().slice(0, 10) <= last && dates.length < 60; d.setUTCDate(d.getUTCDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10));
  }

  const supabase = await createClient();
  const { error } = await supabase.from("availability_overrides").insert(
    dates.map((d) => ({
      instructor_id: user.id,
      date: d,
      kind,
      start_time: wholeDay ? null : start,
      end_time: wholeDay ? null : end,
      note: String(formData.get("note") ?? "").slice(0, 200) || null,
    })),
  );
  done(error ? "Couldn't save that date" : undefined);
}

export async function removeDateOverride(formData: FormData) {
  await requireRole("instructor");
  const id = z.guid().parse(formData.get("id"));
  const supabase = await createClient();
  await supabase.from("availability_overrides").delete().eq("id", id);
  done();
}

export async function saveZones(formData: FormData) {
  const user = await requireRole("instructor");
  const selected = z.array(z.guid()).parse(formData.getAll("zoneId"));
  const supabase = await createClient();
  const { data: current } = await supabase.from("instructor_zones").select("zone_id").eq("instructor_id", user.id);
  const have = new Set((current ?? []).map((z) => z.zone_id as string));
  const want = new Set(selected);

  const toRemove = [...have].filter((id) => !want.has(id));
  const toAdd = [...want].filter((id) => !have.has(id));
  if (toRemove.length) await supabase.from("instructor_zones").delete().eq("instructor_id", user.id).in("zone_id", toRemove);
  if (toAdd.length) {
    const { error } = await supabase.from("instructor_zones").insert(toAdd.map((zone_id) => ({ instructor_id: user.id, zone_id })));
    if (error) done("Couldn't save your zones");
  }
  done();
}
