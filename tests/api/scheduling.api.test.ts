import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, laDateString, laWallTimeToUtc, weekdayOf } from "@/lib/time";
import { clientAs, configureServerEnv, enabled, ids } from "./setup";

const db = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
const created: string[] = [];

/** Next Saturday at least 2 days out — Maya, Jordan and Tyler all cover zone B then. */
function nextSaturday(): string {
  let d = addDays(laDateString(), 2);
  while (weekdayOf(d) !== 6) d = addDays(d, 1);
  return d;
}

async function createRequest(startLocal: string) {
  const date = nextSaturday();
  const [h, m] = startLocal.split(":").map(Number);
  const start = laWallTimeToUtc(date, h * 60 + m);
  const { rows } = await db.query(
    `insert into public.bookings (parent_id, instructor_id, zone_id, neighborhood, starts_at, ends_at, status)
     values ($1, null, $2, 'La Costa', to_timestamp($3 / 1000.0), to_timestamp($3 / 1000.0) + interval '1 hour', 'pending_instructor') returning id`,
    [ids.marcus, ids.zoneB, start],
  );
  await db.query("insert into public.booking_children (booking_id, child_id) values ($1, $2)", [rows[0].id, ids.childEli]);
  created.push(rows[0].id);
  return rows[0].id as string;
}

beforeAll(() => configureServerEnv());
afterAll(async () => {
  if (created.length) await db.query("delete from public.bookings where id = any($1)", [created]);
  await db.end();
});

describe.skipIf(!enabled)("scheduling through the real API", () => {
  it("getAvailability returns ranked slots for zone A from the live snapshot", async () => {
    const { getAvailability } = await import("@/lib/scheduling/service");
    const today = laDateString();
    const result = await getAvailability({
      zoneId: ids.zoneA,
      durationMinutes: 60,
      swimmers: [{ ageMonths: 72, level: "beginner" }],
      fromDate: today,
      toDate: addDays(today, 13),
    });
    expect(result.slots.length).toBeGreaterThan(20);
    expect(result.suggested.length).toBeGreaterThan(0);
    // Tyler doesn't cover zone A.
    expect(result.slots.flatMap((s) => s.candidates.map((c) => c.instructorId))).not.toContain(ids.tyler);
  });

  it("a booking request is auto-offered down the ranked list until someone accepts — or nobody does", async () => {
    const { offerNextInstructor } = await import("@/lib/scheduling/offers");
    const bookingId = await createRequest("10:00");
    const offeredTo: string[] = [];

    for (let round = 0; round < 3; round++) {
      const outcome = await offerNextInstructor(bookingId);
      expect(outcome.status).toBe("offered");
      if (outcome.status !== "offered") return;
      offeredTo.push(outcome.instructorId);

      // The instructor sees the request with a non-identifying summary…
      const instructor = clientAs(outcome.instructorId);
      const { data: offers, error } = await instructor
        .from("booking_offers")
        .select("id, lesson_summary, expires_at, booking:bookings(starts_at, ends_at)")
        .eq("status", "pending")
        .eq("booking_id", bookingId);
      expect(error).toBeNull();
      expect(offers).toHaveLength(1);
      expect(offers![0].lesson_summary).toMatchObject({ zone: "B", swimmers: [{ age: 7, swim_level: "beginner" }] });
      expect(JSON.stringify(offers![0])).not.toMatch(/Eli|Johnson/);
      expect(offers![0].booking).not.toBeNull();

      // …and declines.
      const { data: status, error: rpcError } = await instructor.rpc("respond_to_booking_offer", {
        p_offer_id: offers![0].id,
        p_accept: false,
        p_reason: "Unavailable",
      });
      expect(rpcError).toBeNull();
      expect(status).toBe("declined");
    }

    expect(new Set(offeredTo)).toEqual(new Set([ids.maya, ids.jordan, ids.tyler]));

    // Sofia only covers zone A, so nobody is left.
    const last = await offerNextInstructor(bookingId);
    expect(last).toMatchObject({ status: "unmatched" });
    const { rows } = await db.query("select needs_attention, attention_reason, instructor_id from public.bookings where id = $1", [bookingId]);
    expect(rows[0]).toMatchObject({ needs_attention: true, instructor_id: null });
  });

  it("accepting confirms the lesson and unlocks the audited lesson view", async () => {
    const { offerNextInstructor } = await import("@/lib/scheduling/offers");
    const bookingId = await createRequest("11:30");
    const outcome = await offerNextInstructor(bookingId);
    if (outcome.status !== "offered") throw new Error(`expected an offer, got ${outcome.status}`);

    const instructor = clientAs(outcome.instructorId);
    const { data } = await instructor.rpc("respond_to_booking_offer", { p_offer_id: outcome.offerId, p_accept: true });
    expect(data).toBe("accepted");

    const { data: lesson, error } = await instructor.rpc("instructor_lesson", { p_booking_id: bookingId });
    expect(error).toBeNull();
    expect(lesson).toMatchObject({ status: "confirmed", zone_code: "B", address: null }); // not lesson day yet
    expect(lesson.children[0].first_name).toBe("Eli");
  });

  it("maintenance cron expires stale offers and re-offers", async () => {
    const { offerNextInstructor, runSchedulingMaintenance } = await import("@/lib/scheduling/offers");
    // 09:00 Saturday: Maya and Jordan are both free (Tyler starts at 10:00).
    const bookingId = await createRequest("09:00");
    const first = await offerNextInstructor(bookingId);
    if (first.status !== "offered") throw new Error("expected an offer");
    await db.query("update public.booking_offers set expires_at = now() - interval '1 minute' where id = $1", [first.offerId]);

    const result = await runSchedulingMaintenance();
    expect(result.expiredOffers).toBeGreaterThanOrEqual(1);
    expect(result.offers[bookingId]).toBe("offered");
    const { rows } = await db.query("select instructor_id from public.booking_offers where booking_id = $1 and status = 'pending'", [bookingId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].instructor_id).not.toBe(first.instructorId);
  });

  it("the queries behind the parent and instructor pages work under RLS", async () => {
    const emily = clientAs(ids.emily);
    const { data: upcoming, error } = await emily
      .from("bookings")
      .select("id, starts_at, instructor:instructors!bookings_instructor_id_fkey(first_name)")
      .gte("ends_at", new Date().toISOString());
    expect(error).toBeNull();
    expect(upcoming!.length).toBeGreaterThan(0);
    expect(upcoming![0].instructor).toMatchObject({ first_name: "Maya" });

    const { data: fav } = await emily.from("parents").select("favorite:instructors!parents_favorite_instructor_id_fkey(first_name)").eq("id", ids.emily).single();
    expect(fav!.favorite).toMatchObject({ first_name: "Maya" });

    const maya = clientAs(ids.maya);
    const today = laDateString();
    const { data: lessons, error: lessonsError } = await maya.rpc("instructor_lessons", { p_from: today, p_to: today });
    expect(lessonsError).toBeNull();
    // Address shown day-of, hidden again 2h after each lesson ends.
    const rows = lessons as { ends_at: string; address: unknown; address_visible: boolean }[];
    expect(rows.length).toBeGreaterThan(0);
    for (const l of rows) {
      const visible = Date.now() <= Date.parse(l.ends_at) + 2 * 3_600_000;
      expect(l.address_visible).toBe(visible);
      expect(l.address !== null).toBe(visible);
    }

    const { data: missing } = await maya.rpc("instructor_profile_missing");
    expect(missing).toEqual([]);
  });

  it("instructors manage their own availability and zones through the API", async () => {
    const sofia = clientAs(ids.sofia);
    const { data: rule, error } = await sofia
      .from("availability_rules")
      .insert({ instructor_id: ids.sofia, weekday: 6, start_time: "07:00", end_time: "08:00" })
      .select("id")
      .single();
    expect(error).toBeNull();
    const { error: forged } = await sofia.from("availability_rules").insert({ instructor_id: ids.maya, weekday: 6, start_time: "07:00", end_time: "08:00" });
    expect(forged?.code).toBe("42501");
    await sofia.from("availability_rules").delete().eq("id", rule!.id);

    const { error: zoneError } = await sofia.from("instructor_zones").insert({ instructor_id: ids.sofia, zone_id: ids.zoneB });
    expect(zoneError).toBeNull();
    await sofia.from("instructor_zones").delete().eq("instructor_id", ids.sofia).eq("zone_id", ids.zoneB);
  });

  it("the snapshot and automation RPCs are closed to signed-in users", async () => {
    const { error } = await clientAs(ids.maya).rpc("scheduling_snapshot", { p_from: laDateString(), p_to: laDateString() });
    expect(error?.code).toBe("42501");
    const { error: anonError } = await clientAs("anon").rpc("expire_stale_offers");
    expect(anonError?.code).toBe("42501");
  });
});
