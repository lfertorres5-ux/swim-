"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { BookingError } from "@/lib/booking/checkout";
import { cancelBooking, rescheduleBooking } from "@/lib/booking/manage";
import { siteUrl } from "@/lib/env";
import { paymentsGateway } from "@/lib/payments/gateway";
import { ageInMonths } from "@/lib/scheduling/engine";
import { getAvailability } from "@/lib/scheduling/service";
import type { SwimLevel } from "@/lib/scheduling/types";
import { createClient } from "@/lib/supabase/server";
import { addDays, laDateString } from "@/lib/time";

export async function cancelLessonAction(formData: FormData) {
  const user = await requireRole("parent");
  const id = z.guid().parse(formData.get("bookingId"));
  try {
    await cancelBooking(user.id, id, String(formData.get("reason") ?? "") || null);
  } catch (err) {
    const msg = err instanceof BookingError ? err.message : "Couldn't cancel this lesson. Please contact us.";
    redirect(`/parent/lessons/${id}?error=${encodeURIComponent(msg)}`);
  }
  revalidatePath("/parent", "layout");
  redirect(`/parent/lessons/${id}?cancelled=1`);
}

export async function rescheduleLessonAction(bookingId: string, start: string): Promise<{ ok: boolean; error?: string; keptInstructor?: boolean }> {
  const user = await requireRole("parent");
  try {
    const r = await rescheduleBooking(user.id, z.guid().parse(bookingId), z.iso.datetime({ offset: true }).parse(start));
    revalidatePath("/parent", "layout");
    return { ok: true, keptInstructor: r.keptInstructor };
  } catch (err) {
    return { ok: false, error: err instanceof BookingError ? err.message : "Couldn't reschedule. Please try another time." };
  }
}

/** Open times for moving an existing lesson (same area, length and swimmers). */
export async function rescheduleSlotsAction(bookingId: string, fromDate: string) {
  await requireRole("parent");
  const supabase = await createClient();
  const { data: b } = await supabase
    .from("bookings")
    .select("id, zone_id, instructor_id, starts_at, ends_at, booking_children(child:children(birth_date, swim_level))")
    .eq("id", z.guid().parse(bookingId))
    .single();
  if (!b) return { ok: false as const, error: "Lesson not found" };
  const from = fromDate < addDays(laDateString(), 1) ? addDays(laDateString(), 1) : fromDate;
  const swimmers = (b.booking_children ?? [])
    .map((bc) => (Array.isArray(bc.child) ? bc.child[0] : bc.child))
    .filter(Boolean)
    .map((c) => ({ ageMonths: c!.birth_date ? ageInMonths(c!.birth_date, from) : null, level: c!.swim_level as SwimLevel }));
  const result = await getAvailability({
    zoneId: b.zone_id,
    durationMinutes: Math.round((Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60_000),
    swimmers,
    fromDate: from,
    toDate: addDays(from, 6),
    favoriteInstructorId: b.instructor_id,
  });
  return {
    ok: true as const,
    fromDate: from,
    slots: result.slots.map((s) => ({
      start: new Date(s.start).toISOString(),
      end: new Date(s.end).toISOString(),
      date: s.date,
      isNeighborhoodSlot: false,
      matchesPreferences: true,
      instructorIds: s.candidates.map((c) => c.instructorId),
    })),
    sameInstructor: result.slots.filter((s) => s.candidates.some((c) => c.instructorId === b.instructor_id)).map((s) => new Date(s.start).toISOString()),
  };
}

export async function toggleFavoriteAction(formData: FormData) {
  const user = await requireRole("parent");
  const instructorId = z.guid().parse(formData.get("instructorId"));
  const supabase = await createClient();
  const { data } = await supabase.from("parents").select("favorite_instructor_id").eq("id", user.id).single();
  await supabase
    .from("parents")
    .update({ favorite_instructor_id: data?.favorite_instructor_id === instructorId ? null : instructorId })
    .eq("id", user.id);
  revalidatePath("/parent", "layout");
}

export async function billingPortalAction() {
  const user = await requireRole("parent");
  const supabase = await createClient();
  const { data } = await supabase.from("parents").select("stripe_customer_id").eq("id", user.id).single();
  if (!data?.stripe_customer_id) redirect("/parent/receipts?error=no_payments");
  const url = await paymentsGateway().billingPortalUrl(data.stripe_customer_id, `${siteUrl()}/parent/receipts`);
  redirect(url);
}
