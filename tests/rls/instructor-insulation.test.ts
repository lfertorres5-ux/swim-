import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asOwner, asUser, CHECK_VIOLATION, expectSqlError, NO_DATA_FOUND, PERMISSION_DENIED } from "./helpers";
import { createFixtures, destroyFixtures, PARENT1_CONTACT, type Fixtures } from "./fixtures";

let f: Fixtures;

beforeAll(async () => {
  f = await createFixtures();
});

afterAll(async () => {
  if (f) await destroyFixtures(f);
});

const localRange = `(now() at time zone 'America/Los_Angeles')::date - 2, (now() at time zone 'America/Los_Angeles')::date + 5`;

describe("instructor cannot read parent contact fields", () => {
  it("cannot read any parent row in public.users (email, phone, last name)", async () => {
    await asUser(f.instructorA, async (db) => {
      const direct = await db.query("select email, phone, last_name from public.users where id = $1", [f.parent1]);
      expect(direct.rowCount).toBe(0);

      const all = await db.query("select id from public.users");
      expect(all.rows.map((r) => r.id)).toEqual([f.instructorA]);
    });
  });

  it("cannot read public.parents (home address, Stripe customer)", async () => {
    await asUser(f.instructorA, async (db) => {
      const res = await db.query("select * from public.parents");
      expect(res.rowCount).toBe(0);
    });
  });

  it("cannot read children directly — even their own students", async () => {
    await asUser(f.instructorA, async (db) => {
      expect((await db.query("select * from public.children")).rowCount).toBe(0);
      expect((await db.query("select * from public.booking_children")).rowCount).toBe(0);
    });
  });

  it("cannot read booking_locations directly — even for a lesson happening right now", async () => {
    await asUser(f.instructorA, async (db) => {
      const res = await db.query("select * from public.booking_locations where booking_id = $1", [f.bookings.aNow]);
      expect(res.rowCount).toBe(0);
    });
  });

  it("cannot see what the parent paid", async () => {
    await asUser(f.instructorA, async (db) => {
      expect((await db.query("select * from public.booking_pricing")).rowCount).toBe(0);
      expect((await db.query("select * from public.payments")).rowCount).toBe(0);
      expect((await db.query("select * from public.packages")).rowCount).toBe(0);
    });
  });

  it("cannot read day pass inquiries, flagged messages, discount codes or webhooks", async () => {
    await asUser(f.instructorA, async (db) => {
      for (const table of ["day_pass_inquiries", "flagged_messages", "discount_codes", "webhooks", "webhook_deliveries", "instructor_invites"]) {
        expect((await db.query(`select * from public.${table}`)).rowCount, table).toBe(0);
      }
    });
  });

  it("the audited lesson RPC exposes only first name, age, level and notes", async () => {
    await asUser(f.instructorA, async (db) => {
      const { rows } = await db.query("select * from public.instructor_lesson($1)", [f.bookings.aNow]);
      expect(rows).toHaveLength(1);
      const lesson = rows[0];

      expect(lesson.children).toHaveLength(1);
      expect(Object.keys(lesson.children[0]).sort()).toEqual(["age", "first_name", "notes", "swim_level"]);
      expect(lesson.children[0]).toMatchObject({ first_name: "Ruby", age: 6, swim_level: "beginner" });

      const serialized = JSON.stringify(lesson);
      expect(serialized).not.toContain(PARENT1_CONTACT.email);
      expect(serialized).not.toContain(PARENT1_CONTACT.phone);
      expect(serialized).not.toContain(PARENT1_CONTACT.lastName);
      expect(serialized).not.toContain(f.parent1); // no parent id either
      expect(Object.keys(lesson)).not.toContain("parent_id");
    });
  });

  it("cannot call the internal SECURITY DEFINER helpers directly", async () => {
    await asUser(f.instructorA, async (db) => {
      await expectSqlError(db, "select private.lesson_address_json($1)", [f.bookings.aFuture], PERMISSION_DENIED);
      await expectSqlError(db, "select private.lesson_children_json($1, current_date)", [f.bookings.aFuture], PERMISSION_DENIED);
      await expectSqlError(db, "select * from private.instructor_lesson_rows(null, null, $1)", [f.bookings.bNow], PERMISSION_DENIED);
      await expectSqlError(db, "select private.write_audit('x', 'y', null)", [], PERMISSION_DENIED);
    });
  });

  it("cannot change their own role, activation status or pay rate, or put contact info in their profile", async () => {
    await asUser(f.instructorA, async (db) => {
      await expectSqlError(db, "update public.users set role = 'admin' where id = $1", [f.instructorA], PERMISSION_DENIED);
      await expectSqlError(db, "update public.instructors set is_active = true where id = $1", [f.instructorA], PERMISSION_DENIED);
      // First name is shown to parents, so its format can't carry contact info.
      for (const smuggled of ["Ivy 619-555-0101", "ivy@mail.com", "@ivyswims", "Ivy.swims"]) {
        await expectSqlError(db, "update public.instructors set first_name = $2 where id = $1", [f.instructorA, smuggled], CHECK_VIOLATION);
      }
      expect((await db.query("update public.instructors set first_name = 'Ivy-Rose' where id = $1", [f.instructorA])).rowCount).toBe(1);
      // An active instructor can't blank out their bio or photo.
      await expectSqlError(db, "update public.instructors set bio = null where id = $1", [f.instructorA], CHECK_VIOLATION);
      await expectSqlError(db, "update public.instructors set photo_path = null where id = $1", [f.instructorA], CHECK_VIOLATION);
      // …or point the photo at someone else's upload.
      await expectSqlError(db, "update public.instructors set photo_path = $2 where id = $1", [f.instructorA, `${f.instructorB}/photo.jpg`], CHECK_VIOLATION);
      // Profile fields that are self-editable still work.
      expect((await db.query("update public.instructors set bio = 'Patient, playful lessons for nervous first-time swimmers.' where id = $1", [f.instructorA])).rowCount).toBe(1);
      await expectSqlError(
        db,
        "update public.instructor_private set pay_rate_cents_per_hour = 99999 where instructor_id = $1",
        [f.instructorA],
        PERMISSION_DENIED,
      );
    });
  });

  it("cannot create, modify or reassign bookings", async () => {
    await asUser(f.instructorA, async (db) => {
      await expectSqlError(db, "update public.bookings set instructor_id = $1 where id = $2", [f.instructorA, f.bookings.bNow], PERMISSION_DENIED);
      await expectSqlError(
        db,
        "insert into public.bookings (parent_id, zone_id, starts_at, ends_at) values ($1, $2, now(), now() + interval '1 hour')",
        [f.parent1, f.zoneId],
        PERMISSION_DENIED,
      );
    });
  });
});

describe("instructor cannot read another instructor's clients", () => {
  it("sees only bookings assigned to them", async () => {
    await asUser(f.instructorA, async (db) => {
      const { rows } = await db.query("select id, instructor_id from public.bookings");
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.instructor_id === f.instructorA)).toBe(true);
      expect(rows.map((r) => r.id)).not.toContain(f.bookings.bNow);
    });
  });

  it("instructor_lesson() refuses another instructor's booking", async () => {
    await asUser(f.instructorA, async (db) => {
      await expectSqlError(db, "select * from public.instructor_lesson($1)", [f.bookings.bNow], NO_DATA_FOUND);
    });
  });

  it("instructor_lessons() never returns another instructor's lessons", async () => {
    await asUser(f.instructorA, async (db) => {
      const { rows } = await db.query(`select booking_id from public.instructor_lessons(${localRange})`);
      const ids = rows.map((r) => r.booking_id);
      expect(ids).toContain(f.bookings.aNow);
      expect(ids).not.toContain(f.bookings.bNow);
      expect(ids).not.toContain(f.bookings.pendingNow);
    });
  });

  it("cannot read or post messages on another instructor's lesson", async () => {
    await asUser(f.instructorA, async (db) => {
      expect((await db.query("select * from public.messages where booking_id = $1", [f.bookings.bNow])).rowCount).toBe(0);
      await expectSqlError(db, "insert into public.messages (booking_id, body) values ($1, 'hi')", [f.bookings.bNow], PERMISSION_DENIED);
    });
  });

  it("cannot read another instructor's lesson notes, earnings, pay rate or availability", async () => {
    await asUser(f.instructorA, async (db) => {
      const notes = await db.query("select instructor_id from public.lesson_notes");
      expect(notes.rows.every((r) => r.instructor_id === f.instructorA)).toBe(true);

      const earnings = await db.query("select instructor_id from public.instructor_earnings");
      expect(earnings.rows.map((r) => r.instructor_id)).toEqual([f.instructorA]);

      const priv = await db.query("select instructor_id, pay_rate_cents_per_hour from public.instructor_private");
      expect(priv.rows).toEqual([{ instructor_id: f.instructorA, pay_rate_cents_per_hour: 4000 }]);

      const rules = await db.query("select instructor_id from public.availability_rules");
      expect(rules.rows.every((r) => r.instructor_id === f.instructorA)).toBe(true);
    });
  });

  it("cannot write a lesson note on another instructor's booking", async () => {
    await asUser(f.instructorA, async (db) => {
      await expectSqlError(
        db,
        "insert into public.lesson_notes (booking_id, instructor_id, summary) values ($1, $2, 'x')",
        [f.bookings.pendingNow, f.instructorA],
        PERMISSION_DENIED,
      );
    });
  });

  it("loses access the moment a lesson is reassigned (sub), and the new instructor gains it", async () => {
    await asOwner(async (db) => {
      await db.query("begin");
      try {
        await db.query("update public.bookings set instructor_id = $1 where id = $2", [f.instructorB, f.bookings.aFuture]);

        await db.query("set local role authenticated");
        await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: f.instructorA })]);
        expect((await db.query("select 1 from public.bookings where id = $1", [f.bookings.aFuture])).rowCount).toBe(0);

        await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: f.instructorB })]);
        expect((await db.query("select 1 from public.bookings where id = $1", [f.bookings.aFuture])).rowCount).toBe(1);
      } finally {
        await db.query("rollback");
      }
    });
  });
});

describe("street address reveal window (day-of only, hidden 2h after the lesson)", () => {
  async function lesson(bookingId: string) {
    return asUser(f.instructorA, async (db) => {
      const { rows } = await db.query("select * from public.instructor_lesson($1)", [bookingId]);
      return rows[0];
    });
  }

  it("is revealed during today's lesson", async () => {
    const l = await lesson(f.bookings.aNow);
    expect(l.address_visible).toBe(true);
    expect(l.address).toMatchObject({ line1: PARENT1_CONTACT.address, city: "Encinitas", access_notes: "Gate code 1234" });
  });

  it("is still revealed 1 hour after the lesson ended", async () => {
    const l = await lesson(f.bookings.aEndedRecently);
    expect(l.address_visible).toBe(true);
    expect(l.address.line1).toBe(PARENT1_CONTACT.address);
  });

  it("is hidden again more than 2 hours after the lesson ended", async () => {
    const l = await lesson(f.bookings.aEndedLongAgo);
    expect(l.address_visible).toBe(false);
    expect(l.address).toBeNull();
  });

  it("is hidden before the day of the lesson", async () => {
    const l = await lesson(f.bookings.aFuture);
    expect(l.address_visible).toBe(false);
    expect(l.address).toBeNull();
    expect(l.children[0].first_name).toBe("Ruby"); // non-sensitive details still available
  });

  it("cancelled lessons are not returned at all", async () => {
    await asUser(f.instructorA, async (db) => {
      await expectSqlError(db, "select * from public.instructor_lesson($1)", [f.bookings.aCancelled], NO_DATA_FOUND);
    });
  });

  it("window boundaries are computed in America/Los_Angeles, including across DST", async () => {
    await asOwner(async (db) => {
      // 2026-11-01 is the PDT→PST fallback day. Local midnight = 07:00Z (still PDT).
      const q = `select private.address_window_open($1::timestamptz, $2::timestamptz, $3::timestamptz, 120) as open`;
      const start = "2026-11-01T17:00:00Z"; // 09:00 PST
      const end = "2026-11-01T18:00:00Z";
      const at = async (t: string) => (await db.query(q, [start, end, t])).rows[0].open;
      expect(await at("2026-11-01T06:59:59Z")).toBe(false); // 23:59 PDT Oct 31
      expect(await at("2026-11-01T07:00:00Z")).toBe(true); //  00:00 PDT Nov 1
      expect(await at("2026-11-01T20:00:00Z")).toBe(true); //  end + 120 min
      expect(await at("2026-11-01T20:00:01Z")).toBe(false);

      // A summer lesson: local midnight = 07:00Z (PDT, UTC-7).
      expect((await db.query(q, ["2026-07-04T16:00:00Z", "2026-07-04T17:00:00Z", "2026-07-04T06:59:00Z"])).rows[0].open).toBe(false);
      expect((await db.query(q, ["2026-07-04T16:00:00Z", "2026-07-04T17:00:00Z", "2026-07-04T07:00:00Z"])).rows[0].open).toBe(true);
    });
  });
});

describe("audit log", () => {
  it("records every instructor view of a client record", async () => {
    const before = await asOwner(async (db) =>
      Number((await db.query("select count(*) from public.audit_log where actor_id = $1", [f.instructorA])).rows[0].count),
    );

    // Commit for real (asUser rolls back) so the audit rows persist.
    await asOwner(async (db) => {
      await db.query("begin");
      await db.query("set local role authenticated");
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: f.instructorA })]);
      await db.query("select * from public.instructor_lesson($1)", [f.bookings.aNow]);
      await db.query(`select * from public.instructor_lessons(${localRange})`);
      await db.query("commit");
    });

    await asOwner(async (db) => {
      const { rows } = await db.query(
        `select action, booking_id, actor_role, metadata from public.audit_log
         where actor_id = $1 order by id desc limit 50`,
        [f.instructorA],
      );
      const single = rows.find((r) => r.metadata.via === "instructor_lesson" && r.booking_id === f.bookings.aNow);
      expect(single).toMatchObject({ action: "instructor.view_lesson", actor_role: "instructor" });
      expect(single.metadata.address_revealed).toBe(true);

      const listed = rows.filter((r) => r.metadata.via === "instructor_lessons").map((r) => r.booking_id);
      expect(listed).toEqual(expect.arrayContaining([f.bookings.aNow, f.bookings.aFuture, f.bookings.aEndedRecently]));
    });

    const after = await asOwner(async (db) =>
      Number((await db.query("select count(*) from public.audit_log where actor_id = $1", [f.instructorA])).rows[0].count),
    );
    expect(after).toBeGreaterThan(before);
  });

  it("instructors cannot read, forge or tamper with the audit log", async () => {
    await asUser(f.instructorA, async (db) => {
      expect((await db.query("select * from public.audit_log")).rowCount).toBe(0);
      await expectSqlError(db, "insert into public.audit_log (action) values ('forged')", [], PERMISSION_DENIED);
      await expectSqlError(db, "delete from public.audit_log", [], PERMISSION_DENIED);
    });
  });

  it("is append-only even for the database owner", async () => {
    await asOwner(async (db) => {
      await db.query("begin");
      try {
        await db.query("insert into public.audit_log (action) values ('test.append_only')");
        await expectSqlError(db, "update public.audit_log set action = 'x' where action = 'test.append_only'", [], PERMISSION_DENIED);
        await expectSqlError(db, "delete from public.audit_log where action = 'test.append_only'", [], PERMISSION_DENIED);
      } finally {
        await db.query("rollback");
      }
    });
  });

  it("admins can read the audit log", async () => {
    await asUser(f.admin, async (db) => {
      const { rowCount } = await db.query("select 1 from public.audit_log where actor_id = $1", [f.instructorA]);
      expect(rowCount).toBeGreaterThan(0);
    });
  });
});

describe("no bulk export", () => {
  it("instructor_lessons() rejects ranges wider than the configured maximum", async () => {
    await asUser(f.instructorA, async (db) => {
      await expectSqlError(db, "select * from public.instructor_lessons(current_date, current_date + 365)", [], "22023");
      await expectSqlError(db, "select * from public.instructor_lessons(current_date, current_date - 1)", [], "22023");
    });
  });
});

describe("platform terms gate", () => {
  it("an instructor who has not accepted the current terms sees no client data", async () => {
    await asUser(f.pendingInstr, async (db) => {
      expect((await db.query("select * from public.bookings")).rowCount).toBe(0);
      await expectSqlError(db, "select * from public.instructor_lesson($1)", [f.bookings.pendingNow], PERMISSION_DENIED);
      await expectSqlError(db, `select * from public.instructor_lessons(${localRange})`, [], PERMISSION_DENIED);
    });
  });

  it("accepting the current version unlocks access; a stale version is rejected", async () => {
    await asUser(f.pendingInstr, async (db) => {
      await expectSqlError(db, "select public.accept_instructor_terms('1999-01-01')", [], "22023");

      const { rows } = await db.query("select instructor_terms_version as v from public.platform_settings");
      await db.query("select public.accept_instructor_terms($1)", [rows[0].v]);

      expect((await db.query("select id from public.bookings")).rows.map((r) => r.id)).toEqual([f.bookings.pendingNow]);
      const lesson = (await db.query("select * from public.instructor_lesson($1)", [f.bookings.pendingNow])).rows[0];
      expect(lesson.children[0].first_name).toBe("Theo");
    });
  });

  it("publishing a new terms version cuts off access until re-accepted", async () => {
    await asOwner(async (db) => {
      await db.query("begin");
      try {
        await db.query("update public.platform_settings set instructor_terms_version = 'next-version'");
        await db.query("set local role authenticated");
        await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: f.instructorA })]);
        expect((await db.query("select * from public.bookings")).rowCount).toBe(0);
      } finally {
        await db.query("rollback");
      }
    });
  });

  it("parents cannot accept instructor terms", async () => {
    await asUser(f.parent1, async (db) => {
      await expectSqlError(db, "select public.accept_instructor_terms('2026-10-01')", [], PERMISSION_DENIED);
    });
  });
});

describe("contact details stay out of instructor profiles and old bookings", () => {
  it("a bio or first name with a phone, email, link or handle is rejected", async () => {
    for (const bio of [
      "Former D1 swimmer, text me at (619) 555-0100 to book directly",
      "Former D1 swimmer — email coach.sam at gmail dot com for lessons",
      "Former D1 swimmer, see my site swimwithsam.com for more lessons",
      "Former D1 swimmer, find me on insta @samswims for direct bookings",
      "Former D1 swimmer, Venmo me and skip the platform fees entirely ok",
    ]) {
      await asUser(f.instructorA, async (db) => {
        await expectSqlError(db, "update public.instructors set bio = $1 where id = $2", [bio, f.instructorA], CHECK_VIOLATION);
      });
    }
    await asUser(f.instructorA, async (db) => {
      await expectSqlError(db, "update public.instructors set first_name = 'Sam 6195550100' where id = $1", [f.instructorA], CHECK_VIOLATION);
      const ok = await db.query("update public.instructors set bio = 'Swam D1 2015-2020, WSI certified, 8 years teaching kids ages 3 to 12.' where id = $1 returning id", [f.instructorA]);
      expect(ok.rowCount).toBe(1);
    });
  });

  it("an instructor can't read their cancelled bookings (parents' cancellation reasons)", async () => {
    await asUser(f.instructorA, async (db) => {
      expect((await db.query("select id from public.bookings where id = $1", [f.bookings.aCancelled])).rowCount).toBe(0);
      expect((await db.query("select id from public.bookings where id = $1", [f.bookings.aFuture])).rowCount).toBe(1);
    });
  });
});
