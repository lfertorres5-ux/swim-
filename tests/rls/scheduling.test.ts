import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asOwner,
  becomeOwner,
  becomeServiceRole,
  becomeUser,
  CHECK_VIOLATION,
  expectSqlError,
  inTransaction,
  NO_DATA_FOUND,
  OFFER_NOT_PENDING,
  PERMISSION_DENIED,
} from "./helpers";
import { createFixtures, destroyFixtures, PARENT1_CONTACT, type Fixtures } from "./fixtures";
import { Scheduler } from "@/lib/scheduling/engine";
import { toSchedulingData, type RawSnapshot } from "@/lib/scheduling/snapshot";
import { boundaryVerticesOutsideCounty, isSanDiegoCountyZip, type GeoJsonPolygon } from "@/lib/geo/san-diego-county";
import { addDays, laDateString } from "@/lib/time";

let f: Fixtures;
beforeAll(async () => {
  f = await createFixtures();
});
afterAll(async () => {
  if (f) await destroyFixtures(f);
});

const SEED_ZONE_A = "00000000-0000-4000-b000-00000000000a";
const SEED_MAYA = "00000000-0000-4000-a000-000000000101";

describe("service area is San Diego County only", () => {
  it("every zone in the database is inside the county (ZIPs and boundary vertices)", async () => {
    await asOwner(async (db) => {
      const { rows } = await db.query("select code, postal_codes, boundary from public.zones");
      expect(rows.length).toBeGreaterThan(0);
      for (const z of rows) {
        expect(z.postal_codes.filter((zip: string) => !isSanDiegoCountyZip(zip)), `zone ${z.code} ZIPs`).toEqual([]);
        if (z.boundary) expect(boundaryVerticesOutsideCounty(z.boundary as GeoJsonPolygon), `zone ${z.code} boundary`).toEqual([]);
      }
    });
  });

  it("rejects zones with out-of-county ZIPs or boundaries", async () => {
    await inTransaction(async (db) => {
      await expectSqlError(db, "insert into public.zones (code, name, postal_codes) values ('OC', 'San Clemente', '{92672}')", [], CHECK_VIOLATION);
      await expectSqlError(db, "insert into public.zones (code, name, postal_codes) values ('RV', 'Temecula', '{92024,92592}')", [], CHECK_VIOLATION);
      const temecula = { type: "Polygon", coordinates: [[[-117.2, 33.45], [-117.1, 33.55], [-117.0, 33.45], [-117.2, 33.45]]] };
      await expectSqlError(db, "insert into public.zones (code, name, boundary) values ('RV2', 'Temecula', $1)", [temecula], CHECK_VIOLATION);
      await expectSqlError(db, "insert into public.zones (code, name, boundary) values ('BAD', 'Not a polygon', '{\"type\":\"Point\",\"coordinates\":[-117.2,33]}')", [], CHECK_VIOLATION);
    });
  });

  it("rejects out-of-county home and lesson addresses", async () => {
    await inTransaction(async (db) => {
      await expectSqlError(db, "update public.parents set postal_code = '92675' where id = $1", [f.parent1], CHECK_VIOLATION);
      await expectSqlError(db, "update public.parents set lat = 33.49, lng = -117.15 where id = $1", [f.parent1], CHECK_VIOLATION);
      await expectSqlError(db, "update public.booking_locations set postal_code = '85001' where booking_id = $1", [f.bookings.aFuture], CHECK_VIOLATION);
      await expectSqlError(db, "update public.booking_locations set state = 'AZ' where booking_id = $1", [f.bookings.aFuture], CHECK_VIOLATION);
    });
  });
});

describe("instructor profiles: first name, bio and photo are required to be active", () => {
  it("cannot activate an instructor without a photo or bio", async () => {
    await inTransaction(async (db) => {
      await db.query("update public.instructors set is_active = false, photo_path = null where id = $1", [f.pendingInstr]);
      await expectSqlError(db, "update public.instructors set is_active = true where id = $1", [f.pendingInstr], CHECK_VIOLATION);
      await db.query("update public.instructors set photo_path = id::text || '/me.jpg', bio = 'Too short' where id = $1", [f.pendingInstr]);
      await expectSqlError(db, "update public.instructors set is_active = true where id = $1", [f.pendingInstr], CHECK_VIOLATION);
    });
  });

  it("reports what's missing to the instructor", async () => {
    await inTransaction(async (db) => {
      await db.query("update public.instructors set is_active = false, photo_path = null where id = $1", [f.pendingInstr]);
      await db.query("delete from public.instructor_zones where instructor_id = $1", [f.pendingInstr]);
      await becomeUser(db, f.pendingInstr);
      const { rows } = await db.query("select public.instructor_profile_missing() as missing");
      expect(rows[0].missing).toEqual(["photo", "zones", "availability"]);
      // Can't ask about another instructor.
      const other = await db.query("select public.instructor_profile_missing($1) as missing", [f.instructorA]);
      expect(other.rows[0].missing).toBeNull();
    });
  });

  it("parents see only the first name, bio and photo — never a last name", async () => {
    await inTransaction(async (db) => {
      await becomeUser(db, f.parent1);
      const { rows } = await db.query("select * from public.instructors where id = $1", [f.instructorA]);
      expect(rows[0].first_name).toBe("Ivy");
      expect(JSON.stringify(rows[0])).not.toContain("Alpha"); // instructorA's last name
    });
  });
});

describe("scheduling snapshot", () => {
  const today = laDateString();

  it("is callable only with the service role", async () => {
    await inTransaction(async (db) => {
      await becomeUser(db, f.parent1);
      await expectSqlError(db, "select public.scheduling_snapshot(current_date, current_date + 7)", [], PERMISSION_DENIED);
      await becomeOwner(db);
      await db.query("set local role anon");
      await expectSqlError(db, "select public.scheduling_snapshot(current_date, current_date + 7)", [], PERMISSION_DENIED);
    });
  });

  it("contains no client PII", async () => {
    await inTransaction(async (db) => {
      await becomeServiceRole(db);
      const { rows } = await db.query("select public.scheduling_snapshot($1::date, $2::date) as s", [today, addDays(today, 14)]);
      const text = JSON.stringify(rows[0].s);
      for (const needle of [PARENT1_CONTACT.email, PARENT1_CONTACT.phone, PARENT1_CONTACT.lastName, PARENT1_CONTACT.address, f.parent1, "Ruby", "Neptune", "emily@example.com"]) {
        expect(text).not.toContain(needle);
      }
      expect(rows[0].s.bookings.length).toBeGreaterThan(0);
    });
  });

  it("excludes inactive instructors and those who haven't accepted current terms", async () => {
    await inTransaction(async (db) => {
      await becomeServiceRole(db);
      const { rows } = await db.query("select public.scheduling_snapshot($1::date, $2::date) as s", [today, addDays(today, 7)]);
      const ids = rows[0].s.instructors.map((i: { id: string }) => i.id);
      expect(ids).toContain(f.instructorA);
      expect(ids).not.toContain(f.pendingInstr);
    });
  });
});

describe("engine ⇄ database agreement", () => {
  it("every slot the engine offers is accepted by the DB's overlap + travel-buffer guards", async () => {
    const today = laDateString();
    const to = addDays(today, 10);
    await inTransaction(async (db) => {
      await becomeServiceRole(db);
      const { rows } = await db.query("select public.scheduling_snapshot($1::date, $2::date) as s", [today, to]);
      await becomeOwner(db);

      const scheduler = new Scheduler(toSchedulingData(rows[0].s as RawSnapshot));
      const { slots } = scheduler.findSlots({
        zoneId: SEED_ZONE_A,
        durationMinutes: 60,
        swimmers: [{ ageMonths: 72, level: "beginner" }],
        fromDate: today,
        toDate: to,
        ignoreNotice: true,
      });
      expect(slots.length).toBeGreaterThan(10);

      const { rows: parents } = await db.query("select id from public.parents where id = '00000000-0000-4000-a000-000000000203'");
      let checked = 0;
      for (const slot of slots) {
        for (const c of slot.candidates) {
          await db.query("savepoint s");
          await db.query(
            `insert into public.bookings (parent_id, instructor_id, zone_id, starts_at, ends_at, status)
             values ($1, $2, $3, to_timestamp($4 / 1000.0), to_timestamp($5 / 1000.0), 'confirmed')`,
            [parents[0].id, c.instructorId, SEED_ZONE_A, slot.start, slot.end],
          );
          await db.query("rollback to savepoint s");
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(10);
    });
  });

  it("the engine never offers Maya inside the travel buffer of her seeded lesson", async () => {
    const today = laDateString();
    await inTransaction(async (db) => {
      await becomeServiceRole(db);
      const { rows } = await db.query("select public.scheduling_snapshot($1::date, $2::date) as s", [today, addDays(today, 8)]);
      const snapshot = rows[0].s as RawSnapshot;
      const scheduler = new Scheduler(toSchedulingData(snapshot));
      const maya = snapshot.bookings.filter((b) => b.instructorId === SEED_MAYA).map((b) => [Date.parse(b.start), Date.parse(b.end)]);
      const { slots } = scheduler.findSlots({
        zoneId: SEED_ZONE_A,
        durationMinutes: 30,
        swimmers: [{ ageMonths: 60, level: "beginner" }],
        fromDate: today,
        toDate: addDays(today, 8),
        instructorId: SEED_MAYA,
        ignoreNotice: true,
      });
      const buffer = 30 * 60_000;
      for (const s of slots) {
        for (const [bs, be] of maya) expect(s.start < be + buffer && bs < s.end + buffer).toBe(false);
      }
    });
  });
});

describe("booking requests: accept / decline", () => {
  async function pendingBooking(db: import("pg").PoolClient, instructorId: string, expiresIn = "11 hours") {
    const { rows } = await db.query(
      `insert into public.bookings (parent_id, instructor_id, zone_id, starts_at, ends_at, status)
       values ($1, $2, $3, now() + interval '5 days', now() + interval '5 days 1 hour', 'pending_instructor') returning id`,
      [f.parent2, instructorId, f.zoneId],
    );
    const offer = await db.query(
      `insert into public.booking_offers (booking_id, instructor_id, expires_at, lesson_summary)
       values ($1, $2, now() + $3::interval, '{"swimmers":[{"age":4,"swim_level":"beginner"}]}') returning id`,
      [rows[0].id, instructorId, expiresIn],
    );
    return { bookingId: rows[0].id as string, offerId: offer.rows[0].id as string };
  }

  it("accepting confirms the booking; responding twice is rejected", async () => {
    await inTransaction(async (db) => {
      const { bookingId, offerId } = await pendingBooking(db, f.instructorA);
      await becomeUser(db, f.instructorA);
      expect((await db.query("select public.respond_to_booking_offer($1, true) as s", [offerId])).rows[0].s).toBe("accepted");
      expect((await db.query("select status, instructor_id from public.bookings where id = $1", [bookingId])).rows[0]).toEqual({
        status: "confirmed",
        instructor_id: f.instructorA,
      });
      await expectSqlError(db, "select public.respond_to_booking_offer($1, false)", [offerId], OFFER_NOT_PENDING);
    });
  });

  it("declining releases the booking for the next instructor", async () => {
    await inTransaction(async (db) => {
      const { bookingId, offerId } = await pendingBooking(db, f.instructorA);
      await becomeUser(db, f.instructorA);
      expect((await db.query("select public.respond_to_booking_offer($1, false, 'Out of town') as s", [offerId])).rows[0].s).toBe("declined");
      // The booking left this instructor's view entirely.
      expect((await db.query("select 1 from public.bookings where id = $1", [bookingId])).rowCount).toBe(0);
      await becomeOwner(db);
      const b = (await db.query("select status, instructor_id from public.bookings where id = $1", [bookingId])).rows[0];
      expect(b).toEqual({ status: "pending_instructor", instructor_id: null });
      const o = (await db.query("select status, decline_reason from public.booking_offers where id = $1", [offerId])).rows[0];
      expect(o).toEqual({ status: "declined", decline_reason: "Out of town" });
    });
  });

  it("an expired offer can't be accepted and releases the booking", async () => {
    await inTransaction(async (db) => {
      const { bookingId, offerId } = await pendingBooking(db, f.instructorA, "-1 minute");
      await becomeUser(db, f.instructorA);
      expect((await db.query("select public.respond_to_booking_offer($1, true) as s", [offerId])).rows[0].s).toBe("expired");
      await becomeOwner(db);
      expect((await db.query("select instructor_id from public.bookings where id = $1", [bookingId])).rows[0].instructor_id).toBeNull();
    });
  });

  it("instructors can't answer someone else's offer, and parents can't answer any", async () => {
    await inTransaction(async (db) => {
      const { offerId } = await pendingBooking(db, f.instructorA);
      await becomeUser(db, f.instructorB);
      await expectSqlError(db, "select public.respond_to_booking_offer($1, true)", [offerId], NO_DATA_FOUND);
      await becomeUser(db, f.parent1);
      await expectSqlError(db, "select public.respond_to_booking_offer($1, true)", [offerId], PERMISSION_DENIED);
    });
  });

  it("offer summaries contain no names", async () => {
    await inTransaction(async (db) => {
      await pendingBooking(db, f.instructorA);
      await becomeUser(db, f.instructorA);
      const { rows } = await db.query("select lesson_summary from public.booking_offers");
      expect(JSON.stringify(rows)).not.toMatch(/Theo|Quartz|first_name/);
    });
  });
});

describe("county outline", () => {
  it("the SQL outline is identical to the app's", async () => {
    const { SD_COUNTY_OUTLINE } = await import("@/lib/geo/san-diego-county");
    await asOwner(async (db) => {
      const { rows } = await db.query("select private.sd_county_outline() as ring");
      expect(rows[0].ring).toEqual(SD_COUNTY_OUTLINE);
    });
  });

  it("SQL and app agree on in/out for real places", async () => {
    const { withinSanDiegoCounty } = await import("@/lib/geo/san-diego-county");
    const points: [number, number][] = [
      [-117.2919, 33.0369], [-117.0842, 32.6401], [-116.3747, 33.2559], [-117.2511, 33.3764],
      [-117.612, 33.4269], [-117.1484, 33.4936], [-115.5631, 32.792], [-117.0382, 32.5149], [-117.6, 32.9],
    ];
    await asOwner(async (db) => {
      for (const [lng, lat] of points) {
        const { rows } = await db.query("select private.within_sd_county($1, $2) as inside", [lng, lat]);
        expect(rows[0].inside, `${lng},${lat}`).toBe(withinSanDiegoCounty([lng, lat]));
      }
    });
  });
});

describe("offer automation (service role)", () => {
  async function released(db: import("pg").PoolClient) {
    const { rows } = await db.query(
      `insert into public.bookings (parent_id, instructor_id, zone_id, starts_at, ends_at, status)
       values ($1, null, $2, now() + interval '6 days', now() + interval '6 days 1 hour', 'pending_instructor') returning id`,
      [f.parent2, f.zoneId],
    );
    return rows[0].id as string;
  }

  it("assigns an instructor and creates the next-ranked offer atomically", async () => {
    await inTransaction(async (db) => {
      const bookingId = await released(db);
      await db.query("insert into public.booking_offers (booking_id, instructor_id, rank, status, expires_at) values ($1, $2, 1, 'declined', now())", [bookingId, f.instructorA]);
      await becomeServiceRole(db);
      await db.query("select public.assign_booking_offer($1, $2, now() + interval '12 hours', '{}')", [bookingId, f.instructorB]);
      await becomeOwner(db);
      expect((await db.query("select instructor_id from public.bookings where id = $1", [bookingId])).rows[0].instructor_id).toBe(f.instructorB);
      expect((await db.query("select rank, status from public.booking_offers where booking_id = $1 and instructor_id = $2", [bookingId, f.instructorB])).rows[0]).toEqual({ rank: 2, status: "pending" });
    });
  });

  it("refuses to re-offer an instructor who already saw the request", async () => {
    await inTransaction(async (db) => {
      const bookingId = await released(db);
      await db.query("insert into public.booking_offers (booking_id, instructor_id, rank, status, expires_at) values ($1, $2, 1, 'declined', now())", [bookingId, f.instructorA]);
      await becomeServiceRole(db);
      await expectSqlError(db, "select public.assign_booking_offer($1, $2, now() + interval '1 hour', '{}')", [bookingId, f.instructorA], "SB003");
    });
  });

  it("the buffer trigger still guards automatic assignment", async () => {
    await inTransaction(async (db) => {
      const { rows } = await db.query(
        `insert into public.bookings (parent_id, instructor_id, zone_id, starts_at, ends_at, status)
         select $1, null, $2, b.ends_at + interval '10 minutes', b.ends_at + interval '70 minutes', 'pending_instructor'
         from public.bookings b where b.id = $3 returning id`,
        [f.parent2, f.zoneId, f.bookings.aFuture],
      );
      await becomeServiceRole(db);
      await expectSqlError(db, "select public.assign_booking_offer($1, $2, now() + interval '1 hour', '{}')", [rows[0].id, f.instructorA], "SB001");
    });
  });

  it("expires stale offers and lapsed payment holds", async () => {
    await inTransaction(async (db) => {
      const { rows } = await db.query(
        `insert into public.bookings (parent_id, instructor_id, zone_id, starts_at, ends_at, status)
         values ($1, $2, $3, now() + interval '8 days', now() + interval '8 days 1 hour', 'pending_instructor') returning id`,
        [f.parent2, f.instructorB, f.zoneId],
      );
      await db.query("insert into public.booking_offers (booking_id, instructor_id, expires_at) values ($1, $2, now() - interval '1 minute')", [rows[0].id, f.instructorB]);
      const hold = await db.query(
        `insert into public.bookings (parent_id, instructor_id, zone_id, starts_at, ends_at, status, hold_expires_at)
         values ($1, $2, $3, now() + interval '9 days', now() + interval '9 days 1 hour', 'pending_payment', now() - interval '1 minute') returning id`,
        [f.parent2, f.instructorB, f.zoneId],
      );

      await becomeServiceRole(db);
      const expired = await db.query("select public.expire_stale_offers() as id");
      expect(expired.rows.map((r) => r.id)).toContain(rows[0].id);
      const holds = await db.query("select public.expire_payment_holds() as id");
      expect(holds.rows.map((r) => r.id)).toContain(hold.rows[0].id);
      const awaiting = await db.query("select public.bookings_awaiting_offer() as id");
      expect(awaiting.rows.map((r) => r.id)).toContain(rows[0].id);
    });
  });

  it("is not callable by signed-in users", async () => {
    await inTransaction(async (db) => {
      await becomeUser(db, f.instructorA);
      await expectSqlError(db, "select public.expire_stale_offers()", [], PERMISSION_DENIED);
      await expectSqlError(db, "select public.assign_booking_offer(gen_random_uuid(), $1, now(), '{}')", [f.instructorA], PERMISSION_DENIED);
    });
  });
});
