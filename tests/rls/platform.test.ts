import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asOwner, asUser, EXCLUSION_VIOLATION, expectSqlError, PERMISSION_DENIED, TRAVEL_BUFFER_CONFLICT } from "./helpers";
import { createFixtures, destroyFixtures, type Fixtures } from "./fixtures";

let f: Fixtures;

beforeAll(async () => {
  f = await createFixtures();
});

afterAll(async () => {
  if (f) await destroyFixtures(f);
});

describe("schema-wide guarantees", () => {
  it("every table in public has row-level security enabled", async () => {
    await asOwner(async (db) => {
      const { rows } = await db.query(`
        select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity`);
      expect(rows.map((r) => r.relname)).toEqual([]);
    });
  });

  it("only public configuration tables are readable by everyone (using true)", async () => {
    await asOwner(async (db) => {
      const { rows } = await db.query(`
        select distinct tablename from pg_policies
        where schemaname = 'public' and cmd in ('SELECT', 'ALL') and qual = 'true'`);
      expect(rows.map((r) => r.tablename).sort()).toEqual(["platform_settings", "pricing_config", "zones"]);
    });
  });

  it("no SECURITY DEFINER function in public is executable by anon", async () => {
    await asOwner(async (db) => {
      const { rows } = await db.query(`
        select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')`);
      expect(rows).toEqual([]);
    });
  });

  it("contact columns are only granted on tables instructors have no policy for", async () => {
    await asOwner(async (db) => {
      // Tables holding parent contact / address / payment data.
      const sensitive = ["users", "parents", "booking_locations", "booking_pricing", "payments", "day_pass_inquiries"];
      const { rows } = await db.query(
        `select tablename, policyname, qual from pg_policies where schemaname = 'public' and tablename = any($1)`,
        [sensitive],
      );
      for (const p of rows) {
        // Every policy on these tables is self-, parent- or admin-scoped.
        expect(p.qual, `${p.tablename}.${p.policyname}`).toMatch(/auth\.uid\(\)|is_admin\(\)|is_booking_parent\(/);
        expect(p.qual, `${p.tablename}.${p.policyname}`).not.toMatch(/instructor/);
      }
    });
  });
});

describe("parents are isolated from each other", () => {
  it("cannot read another family's children, bookings, addresses or payments", async () => {
    await asUser(f.parent2, async (db) => {
      expect((await db.query("select * from public.children where parent_id = $1", [f.parent1])).rowCount).toBe(0);
      expect((await db.query("select * from public.bookings where parent_id = $1", [f.parent1])).rowCount).toBe(0);
      expect((await db.query("select * from public.booking_locations where booking_id = $1", [f.bookings.aNow])).rowCount).toBe(0);
      expect((await db.query("select * from public.payments where parent_id = $1", [f.parent1])).rowCount).toBe(0);
      expect((await db.query("select * from public.messages where booking_id = $1", [f.bookings.aNow])).rowCount).toBe(0);
      expect((await db.query("select * from public.lesson_notes where booking_id = $1", [f.bookings.aEndedRecently])).rowCount).toBe(0);
      expect((await db.query("select * from public.users where id = $1", [f.parent1])).rowCount).toBe(0);
    });
  });

  it("can read their own data, including their lesson's address and progress notes", async () => {
    await asUser(f.parent1, async (db) => {
      expect((await db.query("select * from public.children")).rows.map((r) => r.first_name)).toEqual(["Ruby"]);
      expect((await db.query("select * from public.booking_locations where booking_id = $1", [f.bookings.aFuture])).rowCount).toBe(1);
      expect((await db.query("select summary from public.lesson_notes")).rows).toEqual([{ summary: "Ruby floated!" }]);
      expect((await db.query("select * from public.booking_pricing")).rowCount).toBe(5);
    });
  });

  it("cannot add a child to another family", async () => {
    await asUser(f.parent1, async (db) => {
      await expectSqlError(
        db,
        "insert into public.children (parent_id, first_name) values ($1, 'Sneaky')",
        [f.parent2],
        PERMISSION_DENIED,
      );
    });
  });

  it("cannot create bookings or payments directly (server-only, priced + paid via Stripe)", async () => {
    await asUser(f.parent1, async (db) => {
      await expectSqlError(
        db,
        "insert into public.bookings (parent_id, zone_id, starts_at, ends_at, status) values ($1, $2, now(), now() + interval '1h', 'confirmed')",
        [f.parent1, f.zoneId],
        PERMISSION_DENIED,
      );
      await expectSqlError(db, "update public.bookings set status = 'cancelled' where id = $1", [f.bookings.aFuture], PERMISSION_DENIED);
      await expectSqlError(db, "insert into public.payments (amount_cents) values (1)", [], PERMISSION_DENIED);
    });
  });

  it("cannot escalate their role or edit their Stripe customer / zone", async () => {
    await asUser(f.parent1, async (db) => {
      await expectSqlError(db, "update public.users set role = 'admin' where id = $1", [f.parent1], PERMISSION_DENIED);
      await expectSqlError(db, "update public.parents set stripe_customer_id = 'cus_x' where id = $1", [f.parent1], PERMISSION_DENIED);
      await expectSqlError(db, "update public.parents set zone_id = null where id = $1", [f.parent1], PERMISSION_DENIED);
      // Allowed: preferences + favorite instructor.
      const res = await db.query("update public.parents set favorite_instructor_id = $2 where id = $1", [f.parent1, f.instructorA]);
      expect(res.rowCount).toBe(1);
    });
  });

  it("cannot see instructor contact details, pay rates or earnings", async () => {
    await asUser(f.parent1, async (db) => {
      expect((await db.query("select * from public.users where id = $1", [f.instructorA])).rowCount).toBe(0);
      expect((await db.query("select * from public.instructor_private")).rowCount).toBe(0);
      expect((await db.query("select * from public.instructor_earnings")).rowCount).toBe(0);
      // Public profile is fine.
      const profile = await db.query("select first_name, bio, photo_path from public.instructors where id = $1", [f.instructorA]);
      expect(profile.rows[0].first_name).toBe("Ivy");
    });
  });

  it("cannot call the instructor lesson RPC", async () => {
    await asUser(f.parent1, async (db) => {
      await expectSqlError(db, "select * from public.instructor_lesson($1)", [f.bookings.aNow], PERMISSION_DENIED);
    });
  });
});

describe("messaging integrity", () => {
  it("sender cannot be spoofed and sender_role is derived server-side", async () => {
    await asUser(f.instructorA, async (db) => {
      await expectSqlError(
        db,
        "insert into public.messages (booking_id, sender_id, body) values ($1, $2, 'pretending to be the parent')",
        [f.bookings.aNow, f.parent1],
        PERMISSION_DENIED,
      );
      const { rows } = await db.query(
        "insert into public.messages (booking_id, body) values ($1, 'On my way') returning sender_id, sender_role",
        [f.bookings.aNow],
      );
      expect(rows[0]).toEqual({ sender_id: f.instructorA, sender_role: "instructor" });
    });
  });

  it("message bodies cannot be edited after sending", async () => {
    await asUser(f.parent1, async (db) => {
      await expectSqlError(db, "update public.messages set body = 'edited'", [], PERMISSION_DENIED);
    });
  });
});

describe("anonymous visitors", () => {
  it("can read pricing, zones and active instructor profiles", async () => {
    await asAnon(async (db) => {
      expect((await db.query("select * from public.zones where id = $1", [f.zoneId])).rowCount).toBe(1);
      expect((await db.query("select * from public.pricing_config")).rowCount).toBe(1);
      const instr = await db.query("select id from public.instructors where id = $1", [f.instructorA]);
      expect(instr.rowCount).toBe(1);
    });
  });

  it("cannot see inactive instructors", async () => {
    await asOwner((db) => db.query("update public.instructors set is_active = false where id = $1", [f.pendingInstr]));
    try {
      await asAnon(async (db) => {
        expect((await db.query("select id from public.instructors where id = $1", [f.pendingInstr])).rowCount).toBe(0);
      });
    } finally {
      await asOwner((db) => db.query("update public.instructors set is_active = true where id = $1", [f.pendingInstr]));
    }
  });

  it("has no access to any personal data", async () => {
    await asAnon(async (db) => {
      for (const table of ["users", "parents", "children", "bookings", "booking_locations", "payments", "messages", "audit_log"]) {
        await expectSqlError(db, `select * from public.${table}`, [], PERMISSION_DENIED);
      }
      await expectSqlError(db, "select * from public.instructor_lessons(current_date, current_date)", [], PERMISSION_DENIED);
    });
  });

  it("reads public policy settings but not internal ones (pay rate, buffers, hold times)", async () => {
    for (const run of [asAnon, (fn: Parameters<typeof asAnon>[0]) => asUser(f.parent1, fn), (fn: Parameters<typeof asAnon>[0]) => asUser(f.instructorA, fn)]) {
      await run(async (db) => {
        const { rows } = await db.query("select cancellation_window_hours, support_email, day_pass_enabled, instructor_terms_version from public.platform_settings");
        expect(rows).toHaveLength(1);
        for (const col of ["default_instructor_pay_cents_per_hour", "default_travel_buffer_minutes", "payment_hold_minutes", "offer_min_lead_minutes", "*"]) {
          await expectSqlError(db, `select ${col} from public.platform_settings`, [], PERMISSION_DENIED);
        }
      });
    }
  });
});

describe("admin", () => {
  it("can read every family and every instructor's bookings", async () => {
    await asUser(f.admin, async (db) => {
      const users = await db.query("select id from public.users where id = any($1)", [[f.parent1, f.parent2, f.instructorA]]);
      expect(users.rowCount).toBe(3);
      const bookings = await db.query("select id from public.bookings where zone_id = $1", [f.zoneId]);
      expect(bookings.rowCount).toBe(Object.keys(f.bookings).length);
      expect((await db.query("select * from public.booking_locations where booking_id = $1", [f.bookings.bNow])).rowCount).toBe(1);
    });
  });
});

describe("double-booking prevention (exclusion constraint)", () => {
  it("rejects an overlapping live booking for the same instructor", async () => {
    await asOwner(async (db) => {
      await db.query("begin");
      try {
        const overlap = `insert into public.bookings (parent_id, instructor_id, zone_id, starts_at, ends_at, status, buffer_override)
           values ($1, $2, $3, now() + interval '3 days 30 minutes', now() + interval '3 days 90 minutes', 'pending_payment', $4)`;
        // The travel-buffer trigger rejects it first…
        await expectSqlError(db, overlap, [f.parent2, f.instructorA, f.zoneId, false], TRAVEL_BUFFER_CONFLICT);
        // …and the exclusion constraint is the hard backstop even when the buffer is overridden.
        await expectSqlError(db, overlap, [f.parent2, f.instructorA, f.zoneId, true], EXCLUSION_VIOLATION);
        // Back-to-back with no travel time is rejected by the buffer trigger…
        await expectSqlError(
          db,
          `insert into public.bookings (parent_id, instructor_id, zone_id, starts_at, ends_at, status)
           select $1, $2, $3, b.ends_at, b.ends_at + interval '30 minutes', 'confirmed' from public.bookings b where b.id = $4`,
          [f.parent2, f.instructorA, f.zoneId, f.bookings.aFuture],
          TRAVEL_BUFFER_CONFLICT,
        );
        // …but exactly the buffer apart is fine, and so is an explicit admin override.
        await db.query(
          `insert into public.bookings (parent_id, instructor_id, zone_id, starts_at, ends_at, status)
           select $1, $2, $3, b.ends_at + interval '30 minutes', b.ends_at + interval '60 minutes', 'confirmed' from public.bookings b where b.id = $4`,
          [f.parent2, f.instructorA, f.zoneId, f.bookings.aFuture],
        );
        await db.query(
          `insert into public.bookings (parent_id, instructor_id, zone_id, starts_at, ends_at, status, buffer_override)
           select $1, $2, $3, b.starts_at - interval '30 minutes', b.starts_at, 'confirmed', true from public.bookings b where b.id = $4`,
          [f.parent2, f.instructorA, f.zoneId, f.bookings.aFuture],
        );
        // Overlapping a cancelled lesson is fine.
        await db.query(
          `insert into public.bookings (parent_id, instructor_id, zone_id, starts_at, ends_at, status)
           select $1, $2, $3, b.starts_at, b.ends_at, 'confirmed' from public.bookings b where b.id = $4`,
          [f.parent2, f.instructorA, f.zoneId, f.bookings.aCancelled],
        );
        // A different instructor can take the same time.
        await db.query(
          `insert into public.bookings (parent_id, instructor_id, zone_id, starts_at, ends_at, status)
           select $1, $2, $3, b.starts_at, b.ends_at, 'confirmed' from public.bookings b where b.id = $4`,
          [f.parent2, f.instructorB, f.zoneId, f.bookings.aFuture],
        );
      } finally {
        await db.query("rollback");
      }
    });
  });
});

describe("signup role assignment", () => {
  it("ignores a self-declared role in user metadata", async () => {
    await asOwner(async (db) => {
      await db.query("begin");
      try {
        const uid = randomUUID();
        await db.query(
          `insert into auth.users (id, aud, role, email, raw_user_meta_data) values ($1, 'authenticated', 'authenticated', $2, $3)`,
          [uid, `hacker-${uid.slice(0, 8)}@rls.test`, JSON.stringify({ role: "admin", full_name: "Hack Er" })],
        );
        const { rows } = await db.query("select role, first_name, last_name from public.users where id = $1", [uid]);
        expect(rows[0]).toEqual({ role: "parent", first_name: "Hack", last_name: "Er" });
        expect((await db.query("select 1 from public.parents where id = $1", [uid])).rowCount).toBe(1);
      } finally {
        await db.query("rollback");
      }
    });
  });

  it("an admin invite turns the signup into an inactive instructor at the invited pay rate", async () => {
    await asOwner(async (db) => {
      await db.query("begin");
      try {
        const uid = randomUUID();
        const email = `Invited-${uid.slice(0, 8)}@RLS.test`;
        await db.query("insert into public.instructor_invites (email, pay_rate_cents_per_hour) values (lower($1), 4400)", [email]);
        await db.query(
          `insert into auth.users (id, aud, role, email, raw_user_meta_data) values ($1, 'authenticated', 'authenticated', $2, '{"first_name":"Nia","last_name":"Novak"}')`,
          [uid, email],
        );
        expect((await db.query("select role from public.users where id = $1", [uid])).rows[0].role).toBe("instructor");
        const instr = (await db.query("select first_name, is_active from public.instructors where id = $1", [uid])).rows[0];
        expect(instr).toEqual({ first_name: "Nia", is_active: false });
        const rate = (await db.query("select pay_rate_cents_per_hour from public.instructor_private where instructor_id = $1", [uid])).rows[0];
        expect(rate.pay_rate_cents_per_hour).toBe(4400);
        expect((await db.query("select accepted_user_id from public.instructor_invites where lower(email) = lower($1)", [email])).rows[0].accepted_user_id).toBe(uid);
      } finally {
        await db.query("rollback");
      }
    });
  });
});
