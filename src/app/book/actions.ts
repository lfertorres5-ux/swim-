"use server";

import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { addressInputSchema, verifyAddress, type AddressCheck } from "@/lib/booking/address";
import { BookingError, checkoutInputSchema, createBookingCheckout, planSchema } from "@/lib/booking/checkout";
import { loadInstructorCards, type InstructorCardData } from "@/lib/instructor-cards";
import { loadCatalog, lookupPromo } from "@/lib/pricing/catalog";
import { PricingError, quoteLesson, type Plan, type Quote } from "@/lib/pricing/quote";
import { ageInMonths } from "@/lib/scheduling/engine";
import { getAvailability, schedulerForInstant } from "@/lib/scheduling/service";
import { SchedulingError, SWIM_LEVELS, type SwimLevel } from "@/lib/scheduling/types";
import { createClient } from "@/lib/supabase/server";
import { addDays, daysBetween, laDateString } from "@/lib/time";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };
const fail = (error: string) => ({ ok: false as const, error });

function messageOf(err: unknown): string {
  if (err instanceof BookingError || err instanceof PricingError || err instanceof SchedulingError) return err.message;
  console.error(err);
  return "Something went wrong. Please try again.";
}

export async function checkAddressAction(raw: unknown): Promise<AddressCheck> {
  await requireRole("parent");
  const parsed = addressInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "not_found", message: parsed.error.issues[0].message };
  return verifyAddress(parsed.data);
}

const childSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(60),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a birth date"),
  swimLevel: z.enum(SWIM_LEVELS),
  notes: z.string().trim().max(500).optional(),
});

export async function addChildAction(raw: unknown): Promise<Result<{ id: string; firstName: string; birthDate: string; swimLevel: SwimLevel }>> {
  const user = await requireRole("parent");
  const parsed = childSchema.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  if (parsed.data.birthDate > laDateString() || parsed.data.birthDate < "1990-01-01") return fail("Check the birth date");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("children")
    .insert({ parent_id: user.id, first_name: parsed.data.firstName, birth_date: parsed.data.birthDate, swim_level: parsed.data.swimLevel, notes: parsed.data.notes || null })
    .select("id, first_name, birth_date, swim_level")
    .single();
  if (error) return fail("Couldn't add that swimmer.");
  return { ok: true, data: { id: data.id, firstName: data.first_name, birthDate: data.birth_date, swimLevel: data.swim_level } };
}

/** Swimmers for the engine, computed from the family's own children rows (RLS). */
async function swimmersFor(childIds: string[], onDate: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("children").select("id, birth_date, swim_level").in("id", childIds).eq("is_active", true);
  if (!data || data.length !== new Set(childIds).size) throw new BookingError("invalid_swimmers", "Please choose your swimmers again.");
  return data.map((c) => ({ ageMonths: c.birth_date ? ageInMonths(c.birth_date, onDate) : null, level: c.swim_level as SwimLevel }));
}

const searchSchema = z.object({
  zoneId: z.guid(),
  durationMinutes: z.number().int().positive(),
  childIds: z.array(z.guid()).min(1).max(10),
});

export async function eligibleInstructorsAction(raw: unknown): Promise<Result<InstructorCardData[]>> {
  await requireRole("parent");
  const parsed = searchSchema.safeParse(raw);
  if (!parsed.success) return fail("Invalid request");
  try {
    const today = laDateString();
    const swimmers = await swimmersFor(parsed.data.childIds, today);
    const result = await getAvailability({ ...parsed.data, swimmers, fromDate: today, toDate: addDays(today, 21) });
    return { ok: true, data: await loadInstructorCards(result.eligibleInstructorIds) };
  } catch (err) {
    return fail(messageOf(err));
  }
}

export type SlotView = { start: string; end: string; date: string; isNeighborhoodSlot: boolean; matchesPreferences: boolean; instructorIds: string[] };

const slotsSchema = searchSchema.extend({
  instructorId: z.guid().nullable(),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  days: z.number().int().min(1).max(14),
  weeks: z.number().int().min(2).max(26).nullable(),
  preferences: z.object({ weekdays: z.array(z.number().int().min(0).max(6)), windows: z.array(z.object({ start: z.string(), end: z.string() })) }).optional(),
  onlyPreferred: z.boolean().optional(),
});

export async function slotsAction(raw: unknown): Promise<Result<{ slots: SlotView[]; suggested: string[] }>> {
  const user = await requireRole("parent");
  const parsed = slotsSchema.safeParse(raw);
  if (!parsed.success) return fail("Invalid request");
  const p = parsed.data;
  try {
    const toDate = addDays(p.fromDate, p.days - 1);
    if (daysBetween(laDateString(), toDate) > 120) return { ok: true, data: { slots: [], suggested: [] } };
    const swimmers = await swimmersFor(p.childIds, p.fromDate);
    const supabase = await createClient();
    const { data: parent } = await supabase.from("parents").select("favorite_instructor_id").eq("id", user.id).single();
    const req = {
      zoneId: p.zoneId,
      durationMinutes: p.durationMinutes,
      swimmers,
      fromDate: p.fromDate,
      toDate,
      instructorId: p.instructorId,
      favoriteInstructorId: parent?.favorite_instructor_id ?? null,
      preferences: p.preferences && (p.preferences.weekdays.length || p.preferences.windows.length) ? p.preferences : undefined,
      onlyPreferred: p.onlyPreferred,
    };
    let result;
    if (p.weeks) {
      const { scheduler } = await schedulerForInstant(Date.parse(`${p.fromDate}T12:00:00Z`), Date.now(), { weeks: p.weeks + Math.ceil(p.days / 7) });
      result = scheduler.findRecurringSlots(req, p.weeks);
    } else {
      result = await getAvailability(req);
    }
    const view = (s: (typeof result.slots)[number]): SlotView => ({
      start: new Date(s.start).toISOString(),
      end: new Date(s.end).toISOString(),
      date: s.date,
      isNeighborhoodSlot: s.isNeighborhoodSlot,
      matchesPreferences: s.matchesPreferences,
      instructorIds: s.candidates.map((c) => c.instructorId),
    });
    return { ok: true, data: { slots: result.slots.map(view), suggested: result.suggested.map((s) => new Date(s.start).toISOString()) } };
  } catch (err) {
    return fail(messageOf(err));
  }
}

const quoteSchema = z.object({
  zoneId: z.guid(),
  durationMinutes: z.number().int().positive(),
  childrenCount: z.number().int().min(1).max(10),
  isNeighborhoodSlot: z.boolean(),
  plan: planSchema,
  promoCode: z.string().max(40).optional(),
});

/** Display quote. The real charge is recomputed in createBookingCheckout. */
export async function quoteAction(raw: unknown): Promise<Result<Quote & { promoMessage?: string }>> {
  await requireRole("parent");
  const parsed = quoteSchema.safeParse(raw);
  if (!parsed.success) return fail("Invalid request");
  const q = parsed.data;
  try {
    const supabase = await createClient();
    const [{ data: zone }, catalog] = await Promise.all([
      supabase.from("zones").select("id, code, travel_fee_cents, min_booking_minutes, is_bookable").eq("id", q.zoneId).single(),
      loadCatalog(),
    ]);
    if (!zone) return fail("Unknown zone");
    let plan: Plan;
    if (q.plan.kind === "package") {
      const offeringId = q.plan.offeringId;
      const offering = catalog.offerings.find((o) => o.id === offeringId);
      if (!offering) return fail("That package isn't available.");
      plan = { kind: "package", offering };
    } else if (q.plan.kind === "recurring") plan = { kind: "recurring", weeks: q.plan.weeks };
    else if (q.plan.kind === "package_credit") plan = { kind: "package_credit" };
    else plan = { kind: "single" };

    let promo = null;
    let promoMessage: string | undefined;
    if (q.promoCode && plan.kind !== "package_credit") {
      const found = await lookupPromo(q.promoCode, plan.kind);
      if (found.ok) promo = found.promo;
      else promoMessage = found.message;
    }
    const quote = quoteLesson(
      {
        durationMinutes: q.durationMinutes,
        childrenCount: q.childrenCount,
        zone: { id: zone.id, code: zone.code, travelFeeCents: zone.travel_fee_cents, minBookingMinutes: zone.min_booking_minutes, isBookable: zone.is_bookable },
        isNeighborhoodSlot: q.isNeighborhoodSlot,
        plan,
        promo,
      },
      catalog,
    );
    return { ok: true, data: { ...quote, promoMessage } };
  } catch (err) {
    return fail(messageOf(err));
  }
}

export async function checkoutAction(raw: unknown): Promise<Result<{ url: string }>> {
  const user = await requireRole("parent");
  const parsed = checkoutInputSchema.safeParse(raw);
  if (!parsed.success) return fail("Please review your booking details.");
  try {
    const result = await createBookingCheckout(user.id, parsed.data);
    return { ok: true, data: { url: result.url } };
  } catch (err) {
    return fail(messageOf(err));
  }
}
