import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { becomeOwner, becomeUser, expectSqlError, inTransaction, PERMISSION_DENIED } from "./helpers";
import { createFixtures, destroyFixtures, type Fixtures } from "./fixtures";

let f: Fixtures;
beforeAll(async () => {
  f = await createFixtures();
});
afterAll(async () => {
  if (f) await destroyFixtures(f);
});

const note = (bookingId: string, summary = "Ruby floated on her own!"): [string, unknown[]] => [
  "select public.submit_lesson_note($1, $2, $3, $4) as first",
  [bookingId, JSON.stringify({ Ruby: { "Floats on front": "mastered" } }), summary, "Back float"],
];

describe("progress notes", () => {
  it("the assigned instructor submits once: lesson completed, pay recorded, parent can read it", async () => {
    await inTransaction(async (db) => {
      await becomeUser(db, f.instructorA);
      expect((await db.query(...note(f.bookings.aNow))).rows[0].first).toBe(true);
      // Editing later is allowed and isn't a "first" submission.
      expect((await db.query(...note(f.bookings.aNow, "Edited"))).rows[0].first).toBe(false);

      await becomeOwner(db);
      expect((await db.query("select status, completed_at is not null as done from public.bookings where id = $1", [f.bookings.aNow])).rows[0]).toEqual({ status: "completed", done: true });
      const pay = await db.query("select minutes, rate_cents_per_hour, amount_cents from public.instructor_earnings where booking_id = $1", [f.bookings.aNow]);
      expect(pay.rows).toEqual([{ minutes: 60, rate_cents_per_hour: 4000, amount_cents: 4000 }]);

      await becomeUser(db, f.parent1);
      const { rows } = await db.query("select summary, next_focus, skills from public.lesson_notes where booking_id = $1", [f.bookings.aNow]);
      expect(rows[0]).toEqual({ summary: "Edited", next_focus: "Back float", skills: { Ruby: { "Floats on front": "mastered" } } });
    });
  });

  it("can't be written before the lesson starts, by another instructor, or by a parent", async () => {
    await inTransaction(async (db) => {
      await becomeUser(db, f.instructorA);
      await expectSqlError(db, ...note(f.bookings.aFuture), "SB005");
      await becomeUser(db, f.instructorB);
      await expectSqlError(db, ...note(f.bookings.aNow), PERMISSION_DENIED);
      await becomeUser(db, f.parent1);
      await expectSqlError(db, ...note(f.bookings.aNow), PERMISSION_DENIED);
    });
  });

  it("requires a comment and refuses cancelled lessons", async () => {
    await inTransaction(async (db) => {
      await becomeUser(db, f.instructorA);
      await expectSqlError(db, "select public.submit_lesson_note($1, '{}', '  ')", [f.bookings.aNow], "22023");
      await becomeOwner(db);
      await db.query("update public.bookings set status = 'cancelled' where id = $1", [f.bookings.aNow]);
      await becomeUser(db, f.instructorA);
      await expectSqlError(db, ...note(f.bookings.aNow), "SB002");
    });
  });
});

describe("notification history", () => {
  it("each person sees only their own messages; admins see all", async () => {
    await inTransaction(async (db) => {
      await db.query(
        `insert into public.notifications (user_id, to_address, channel, template, body_text, dedupe_key) values
           ($1, 'p1@x.test', 'email', 't', 'hello p1', 'k1-' || gen_random_uuid()),
           ($2, 'p2@x.test', 'email', 't', 'hello p2', 'k2-' || gen_random_uuid())`,
        [f.parent1, f.parent2],
      );
      await becomeUser(db, f.parent1);
      expect((await db.query("select body_text from public.notifications")).rows).toEqual([{ body_text: "hello p1" }]);
      await becomeUser(db, f.instructorA);
      expect((await db.query("select 1 from public.notifications")).rowCount).toBe(0);
      await expectSqlError(db, "insert into public.notifications (to_address, channel, template, body_text, dedupe_key) values ('x', 'sms', 't', 'spam', 'k')", [], PERMISSION_DENIED);
      await becomeUser(db, f.admin);
      expect((await db.query("select 1 from public.notifications where user_id = any($1)", [[f.parent1, f.parent2]])).rowCount).toBe(2);
    });
  });
});
