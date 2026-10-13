import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import { becomeOwner, becomeUser, expectSqlError, inTransaction, PERMISSION_DENIED } from "./helpers";
import { createFixtures, destroyFixtures, PARENT1_CONTACT, type Fixtures } from "./fixtures";

/**
 * Contact sharing: a family and an instructor see each other's name, phone and
 * email only after the family has PAID for a package and that instructor has
 * ACCEPTED a lesson from it. Everything else stays masked.
 */
let f: Fixtures;
beforeAll(async () => {
  f = await createFixtures();
});
afterAll(async () => {
  if (f) await destroyFixtures(f);
});

async function packageLesson(db: PoolClient, opts: { status: string; packageStatus?: string; instructorId?: string; dayOffset?: number }) {
  const pkg = await db.query(
    `insert into public.packages (parent_id, lesson_count, lessons_remaining, duration_minutes, children_count, unit_price_cents, total_cents, status)
     values ($1, 6, 5, 60, 1, 8550, 51300, $2) returning id`,
    [f.parent1, opts.packageStatus ?? "active"],
  );
  const b = await db.query(
    `insert into public.bookings (parent_id, instructor_id, zone_id, starts_at, ends_at, status, kind, package_id, buffer_override)
     values ($1, $2, $3, now() + make_interval(days => $6), now() + make_interval(days => $6) + interval '1 hour', $4, 'package', $5, true) returning id`,
    [f.parent1, opts.instructorId ?? f.instructorA, f.zoneId, opts.status, pkg.rows[0].id, opts.dayOffset ?? 20],
  );
  await db.query("insert into public.booking_children (booking_id, child_id) values ($1, $2)", [b.rows[0].id, f.childRuby]);
  return { packageId: pkg.rows[0].id as string, bookingId: b.rows[0].id as string };
}

const families = async (db: PoolClient, instructorId: string) => {
  await becomeUser(db, instructorId);
  return (await db.query("select * from public.my_family_contacts()")).rows;
};
const instructorsOf = async (db: PoolClient, parentId: string) => {
  await becomeUser(db, parentId);
  return (await db.query("select * from public.my_instructor_contacts()")).rows;
};

describe("contact sharing", () => {
  it("nothing is shared for single lessons (parent1 has several with instructor A)", async () => {
    await inTransaction(async (db) => {
      expect(await families(db, f.instructorA)).toEqual([]);
      expect(await instructorsOf(db, f.parent1)).toEqual([]);
    });
  });

  it("nothing is shared while the package lesson awaits the instructor's acceptance", async () => {
    await inTransaction(async (db) => {
      await packageLesson(db, { status: "pending_instructor" });
      expect(await families(db, f.instructorA)).toEqual([]);
    });
  });

  it("once a paid package lesson is accepted, both sides see each other's contact details", async () => {
    await inTransaction(async (db) => {
      await packageLesson(db, { status: "confirmed" });
      const fam = await families(db, f.instructorA);
      expect(fam).toEqual([
        { parent_id: f.parent1, first_name: "Paula", last_name: PARENT1_CONTACT.lastName, email: PARENT1_CONTACT.email, phone: PARENT1_CONTACT.phone, children: ["Ruby"] },
      ]);
      await becomeOwner(db);
      const ins = await instructorsOf(db, f.parent1);
      expect(ins).toMatchObject([{ instructor_id: f.instructorA, first_name: "Ivy", last_name: "Alpha", phone: "+16195550911" }]);
    });
  });

  it("other instructors and other families still see nothing", async () => {
    await inTransaction(async (db) => {
      await packageLesson(db, { status: "confirmed" });
      expect(await families(db, f.instructorB)).toEqual([]);
      await becomeOwner(db);
      expect(await instructorsOf(db, f.parent2)).toEqual([]);
    });
  });

  it("direct table access stays blocked even after sharing", async () => {
    await inTransaction(async (db) => {
      await packageLesson(db, { status: "confirmed" });
      await becomeUser(db, f.instructorA);
      expect((await db.query("select * from public.users where id = $1", [f.parent1])).rowCount).toBe(0);
      expect((await db.query("select * from public.parents where id = $1", [f.parent1])).rowCount).toBe(0);
    });
  });

  it("refunded or unpaid packages don't unlock contact", async () => {
    await inTransaction(async (db) => {
      await packageLesson(db, { status: "confirmed", packageStatus: "refunded" });
      await packageLesson(db, { status: "confirmed", packageStatus: "pending_payment", dayOffset: 21 });
      expect(await families(db, f.instructorA)).toEqual([]);
    });
  });

  it("the admin switch turns sharing off everywhere", async () => {
    await inTransaction(async (db) => {
      await packageLesson(db, { status: "confirmed" });
      await db.query("update public.platform_settings set contact_sharing = 'never'");
      expect(await families(db, f.instructorA)).toEqual([]);
      await becomeOwner(db);
      expect(await instructorsOf(db, f.parent1)).toEqual([]);
    });
  });

  it("every contact view is audited", async () => {
    await inTransaction(async (db) => {
      await packageLesson(db, { status: "confirmed" });
      await families(db, f.instructorA);
      await becomeOwner(db);
      await instructorsOf(db, f.parent1);
      await becomeOwner(db);
      const { rows } = await db.query(
        "select action, actor_id, entity_id from public.audit_log where action in ('instructor.view_family_contact', 'parent.view_instructor_contact') order by id desc limit 2",
      );
      expect(rows).toEqual(
        expect.arrayContaining([
          { action: "instructor.view_family_contact", actor_id: f.instructorA, entity_id: f.parent1 },
          { action: "parent.view_instructor_contact", actor_id: f.parent1, entity_id: f.instructorA },
        ]),
      );
    });
  });

  it("each side can only call its own function; instructors without current terms are refused", async () => {
    await inTransaction(async (db) => {
      await becomeUser(db, f.parent1);
      await expectSqlError(db, "select * from public.my_family_contacts()", [], PERMISSION_DENIED);
      await becomeUser(db, f.instructorA);
      await expectSqlError(db, "select * from public.my_instructor_contacts()", [], PERMISSION_DENIED);
      await becomeUser(db, f.pendingInstr);
      await expectSqlError(db, "select * from public.my_family_contacts()", [], PERMISSION_DENIED);
    });
  });
});
