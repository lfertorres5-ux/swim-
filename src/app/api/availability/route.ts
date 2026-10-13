import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { getAvailability } from "@/lib/scheduling/service";
import { SchedulingError, SWIM_LEVELS } from "@/lib/scheduling/types";
import { createClient } from "@/lib/supabase/server";
import { daysBetween } from "@/lib/time";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hhmm = z.string().regex(/^\d{2}:\d{2}$/);

const bodySchema = z.object({
  zoneId: z.guid(),
  durationMinutes: z.number().int().positive().max(240),
  swimmers: z.array(z.object({ ageMonths: z.number().int().min(0).max(1200).nullable(), level: z.enum(SWIM_LEVELS) })).min(1).max(10),
  fromDate: isoDate,
  toDate: isoDate,
  instructorId: z.guid().nullable().optional(),
  preferences: z.object({ weekdays: z.array(z.number().int().min(0).max(6)).optional(), windows: z.array(z.object({ start: hhmm, end: hhmm })).optional() }).optional(),
  onlyPreferred: z.boolean().optional(),
});

/**
 * Available lesson slots for the booking calendar. Returns times, neighborhood
 * badges and which instructors could teach — never anyone's bookings.
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "sign_in_required" }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 });
  const body = parsed.data;
  if (daysBetween(body.fromDate, body.toDate) > 31 || body.toDate < body.fromDate) {
    return NextResponse.json({ error: "invalid_range", message: "Search up to 31 days at a time" }, { status: 400 });
  }

  let favoriteInstructorId: string | null = null;
  if (user.role === "parent") {
    const supabase = await createClient();
    const { data } = await supabase.from("parents").select("favorite_instructor_id").eq("id", user.id).maybeSingle();
    favoriteInstructorId = data?.favorite_instructor_id ?? null;
  }

  try {
    const result = await getAvailability({ ...body, favoriteInstructorId });
    const shape = (s: (typeof result.slots)[number]) => ({
      start: new Date(s.start).toISOString(),
      end: new Date(s.end).toISOString(),
      date: s.date,
      isNeighborhoodSlot: s.isNeighborhoodSlot,
      matchesPreferences: s.matchesPreferences,
      instructorIds: s.candidates.map((c) => c.instructorId),
    });
    return NextResponse.json({ slots: result.slots.map(shape), suggested: result.suggested.map(shape) });
  } catch (err) {
    if (err instanceof SchedulingError) return NextResponse.json({ error: err.code, message: err.message }, { status: 422 });
    throw err;
  }
}
