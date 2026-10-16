import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import { becomeOwner, becomeServiceRole, becomeUser, expectSqlError, inTransaction, NO_DATA_FOUND, OFFER_NOT_PENDING, PERMISSION_DENIED, TRAVEL_BUFFER_CONFLICT } from "./helpers";
import { createFixtures, destroyFixtures, PARENT1_CONTACT, type Fixtures } from "./fixtures";

/**
 * Sub board: an instructor posts a lesson they can't teach; another active,
 * qualified, free instructor in the zone claims it; the owner approves (when
 * required). The board never carries names, contact details or addresses,
 * and the booking moves to the sub only when the shift is filled.
 */
let f: Fixtures;
beforeAll(async () => {
  f = await createFixtures();
});
afterAll(async () => {
  if (f) await destroyFixtures(f);
});

async function post(db: PoolClient, bookingId = f.bookings.aFuture, as = f.instructorA) {
  await becomeUser(db, as);
  return (await db.query("select public.release_lesson_to_board($1, 'Doctor appointment') as id", [bookingId])).rows[0].id as string;
}
const board = async (db: PoolClient, as: string) => {
  await becomeUser(db, as);
  return (await db.query("select * from public.sub_board_shifts()")).rows;
};
const bookingInstructor = async (db: PoolClient, bookingId = f.bookings.aFuture) => {
  await becomeOwner(db);
  return (await db.query("select instructor_id from public.bookings where id = $1", [bookingId])).rows[0].instructor_id as string;
};
const setApproval = async (db: PoolClient, on: boolean) => {
  await becomeOwner(db);
  await db.query("update public.platform_settings set sub_board_requires_approval = $1", [on]);
};

describe("posting a lesson", () => {
  it("the assigned instructor posts it; the board shows ages and levels only", () =>
    inTransaction(async (db) => {
      const id = await post(db);
      const rows = await board(db, f.instructorB);
      expect(rows).toHaveLength(1);
      const row = rows[0];
      expect(row.id).toBe(id);
      expect(row.can_claim).toBe(true);
      expect(row.lesson_summary.swimmers).toEqual([{ age: 6, swim_level: "beginner" }]);
      const text = JSON.stringify(row);
      for (const secret of ["Ruby", "Paula", PARENT1_CONTACT.lastName, PARENT1_CONTACT.email, PARENT1_CONTACT.phone, PARENT1_CONTACT.address, "Gate code"]) {
        expect(text).not.toContain(secret);
      }
      // The raw table has no address/contact columns at all.
      await becomeOwner(db);
      const cols = (await db.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'open_shifts'")).rows.map((r) => r.column_name);
      expect(cols.some((c) => /address|email|phone|last_name|child/.test(c))).toBe(false);
    }));

  it("nobody else can post it (other instructor, the parent)", () =>
    inTransaction(async (db) => {
      await becomeUser(db, f.instructorB);
      await expectSqlError(db, "select public.release_lesson_to_board($1)", [f.bookings.aFuture], PERMISSION_DENIED);
      await becomeUser(db, f.parent1);
      await expectSqlError(db, "select public.release_lesson_to_board($1)", [f.bookings.aFuture], PERMISSION_DENIED);
    }));

  it("can't post a lesson that's too soon, cancelled, or already on the board", () =>
    inTransaction(async (db) => {
      await becomeOwner(db);
      const soon = (
        await db.query(
          `insert into public.bookings (parent_id, instructor_id, zone_id, starts_at, ends_at, status) values ($1, $2, $3, now() + interval '1 hour', now() + interval '90 minutes', 'confirmed') returning id`,
          [f.parent1, f.instructorA, f.zoneId],
        )
      ).rows[0].id;
      await becomeUser(db, f.instructorA);
      await expectSqlError(db, "select public.release_lesson_to_board($1)", [soon], "SB006");
      await expectSqlError(db, "select public.release_lesson_to_board($1)", [f.bookings.aCancelled], OFFER_NOT_PENDING);
      await post(db);
      await expectSqlError(db, "select public.release_lesson_to_board($1)", [f.bookings.aFuture], "SB003");
    }));

  it("the poster doesn't see their own lesson on the board; an instructor who hasn't accepted the terms sees nothing", () =>
    inTransaction(async (db) => {
      await post(db);
      expect(await board(db, f.instructorA)).toHaveLength(0);
      expect(await board(db, f.pendingInstr)).toHaveLength(0);
    }));
});

describe("claiming", () => {
  it("with approval on: claim → pending; only an admin can approve; the booking then moves to the sub", () =>
    inTransaction(async (db) => {
      await setApproval(db, true);
      const id = await post(db);
      await becomeUser(db, f.instructorB);
      expect((await db.query("select public.claim_open_shift($1) as s", [id])).rows[0].s).toBe("pending_approval");
      expect(await bookingInstructor(db)).toBe(f.instructorA);

      // B still can't see the booking or its family.
      await becomeUser(db, f.instructorB);
      expect((await db.query("select id from public.bookings where id = $1", [f.bookings.aFuture])).rows).toHaveLength(0);

      for (const who of [f.instructorB, f.instructorA, f.parent1]) {
        await becomeUser(db, who);
        await expectSqlError(db, "select public.decide_open_shift($1, true)", [id], PERMISSION_DENIED);
      }
      await becomeUser(db, f.admin);
      expect((await db.query("select public.decide_open_shift($1, true) as s", [id])).rows[0].s).toBe("filled");
      expect(await bookingInstructor(db)).toBe(f.instructorB);

      // The original instructor loses access the moment it's filled; the sub gains it.
      await becomeUser(db, f.instructorA);
      expect((await db.query("select id from public.bookings where id = $1", [f.bookings.aFuture])).rows).toHaveLength(0);
      await becomeUser(db, f.instructorB);
      expect((await db.query("select id from public.bookings where id = $1", [f.bookings.aFuture])).rows).toHaveLength(1);

      await becomeOwner(db);
      const audit = (await db.query("select action from public.audit_log where entity_id = $1 order by id", [id])).rows.map((r) => r.action);
      expect(audit).toEqual(["instructor.release_to_board", "instructor.claim_shift", "admin.approve_shift"]);
    }));

  it("with approval off: the first claim fills it immediately; a second claim is refused", () =>
    inTransaction(async (db) => {
      await setApproval(db, false);
      const id = await post(db);
      await becomeUser(db, f.instructorB);
      expect((await db.query("select public.claim_open_shift($1) as s", [id])).rows[0].s).toBe("filled");
      expect(await bookingInstructor(db)).toBe(f.instructorB);
      await becomeUser(db, f.instructorB);
      await expectSqlError(db, "select public.claim_open_shift($1)", [id], OFFER_NOT_PENDING);
    }));

  it("turning a claim down puts the lesson back on the board", () =>
    inTransaction(async (db) => {
      await setApproval(db, true);
      const id = await post(db);
      await becomeUser(db, f.instructorB);
      await db.query("select public.claim_open_shift($1)", [id]);
      await becomeUser(db, f.admin);
      expect((await db.query("select public.decide_open_shift($1, false, 'Keeping Ivy') as s", [id])).rows[0].s).toBe("open");
      expect(await bookingInstructor(db)).toBe(f.instructorA);
      expect((await board(db, f.instructorB)).map((r) => r.id)).toEqual([id]);
    }));

  it("an instructor with a lesson too close to it can't claim (travel buffer)", () =>
    inTransaction(async (db) => {
      const id = await post(db);
      await becomeOwner(db);
      await db.query(
        `insert into public.bookings (parent_id, instructor_id, zone_id, starts_at, ends_at, status)
         select $1, $2, zone_id, ends_at + interval '10 minutes', ends_at + interval '70 minutes', 'confirmed' from public.bookings where id = $3`,
        [f.parent2, f.instructorB, f.bookings.aFuture],
      );
      const [row] = await board(db, f.instructorB);
      expect(row.can_claim).toBe(false);
      expect(row.blocked_reason).toMatch(/too close/);
      await becomeUser(db, f.instructorB);
      await expectSqlError(db, "select public.claim_open_shift($1)", [id], TRAVEL_BUFFER_CONFLICT);
    }));

  it("an instructor who doesn't teach the swimmer's level can't claim", () =>
    inTransaction(async (db) => {
      const id = await post(db);
      await becomeOwner(db);
      await db.query("update public.instructors set levels_taught = '{advanced,stroke_technique}' where id = $1", [f.instructorB]);
      const [row] = await board(db, f.instructorB);
      expect(row.can_claim).toBe(false);
      await becomeUser(db, f.instructorB);
      await expectSqlError(db, "select public.claim_open_shift($1)", [id], TRAVEL_BUFFER_CONFLICT);
    }));

  it("an instructor outside the zone doesn't see it and can't claim it", () =>
    inTransaction(async (db) => {
      const id = await post(db);
      await becomeOwner(db);
      await db.query("delete from public.instructor_zones where instructor_id = $1", [f.instructorB]);
      expect(await board(db, f.instructorB)).toHaveLength(0);
      await becomeUser(db, f.instructorB);
      await expectSqlError(db, "select public.claim_open_shift($1)", [id], NO_DATA_FOUND);
    }));
});

describe("lifecycle", () => {
  it("the poster can withdraw it; nobody else can", () =>
    inTransaction(async (db) => {
      const id = await post(db);
      await becomeUser(db, f.instructorB);
      await expectSqlError(db, "select public.withdraw_open_shift($1)", [id], NO_DATA_FOUND);
      await becomeUser(db, f.instructorA);
      await db.query("select public.withdraw_open_shift($1)", [id]);
      expect(await board(db, f.instructorB)).toHaveLength(0);
    }));

  it("cancelling or moving the lesson takes it off the board", () =>
    inTransaction(async (db) => {
      const id = await post(db);
      await becomeOwner(db);
      await db.query("update public.bookings set starts_at = starts_at + interval '1 day', ends_at = ends_at + interval '1 day' where id = $1", [f.bookings.aFuture]);
      expect((await db.query("select status from public.open_shifts where id = $1", [id])).rows[0].status).toBe("cancelled");
    }));

  it("covering a package lesson never unlocks the family's contact details for the sub", () =>
    inTransaction(async (db) => {
      await becomeOwner(db);
      const pkg = (
        await db.query(
          `insert into public.packages (parent_id, lesson_count, lessons_remaining, duration_minutes, children_count, unit_price_cents, total_cents, status)
           values ($1, 6, 5, 60, 1, 8550, 51300, 'active') returning id`,
          [f.parent1],
        )
      ).rows[0].id;
      await db.query("update public.bookings set package_id = $2, kind = 'package' where id = $1", [f.bookings.aFuture, pkg]);
      await setApproval(db, false);
      const id = await post(db);
      await becomeUser(db, f.instructorB);
      await db.query("select public.claim_open_shift($1)", [id]);
      expect(await bookingInstructor(db)).toBe(f.instructorB);

      await becomeUser(db, f.instructorB);
      expect((await db.query("select * from public.my_family_contacts()")).rows).toHaveLength(0);
      await becomeUser(db, f.parent1);
      expect((await db.query("select instructor_id from public.my_instructor_contacts()")).rows.map((r) => r.instructor_id)).not.toContain(f.instructorB);
    }));

  it("automation RPCs and internal helpers are off-limits to signed-in users", () =>
    inTransaction(async (db) => {
      const id = await post(db);
      await becomeUser(db, f.admin);
      await expectSqlError(db, "select * from public.open_shift_candidates($1)", [id], PERMISSION_DENIED);
      await expectSqlError(db, "select public.expire_open_shifts()", [], PERMISSION_DENIED);
      await expectSqlError(db, "select private.instructor_schedule_conflict($1, $2, now(), now(), null)", [f.instructorB, f.zoneId], PERMISSION_DENIED);
      await expectSqlError(db, "select private.fill_open_shift($1, $2)", [id, f.instructorB], PERMISSION_DENIED);
      await becomeServiceRole(db);
      expect((await db.query("select * from public.open_shift_candidates($1) as id", [id])).rows.map((r) => r.id)).toEqual([f.instructorB]);
      expect((await db.query("select public.expire_open_shifts() as n")).rows[0].n).toBe(0);
    }));
});
