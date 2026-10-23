import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asOwner, asUser, expectSqlError, inTransaction, OFFER_NOT_PENDING, PERMISSION_DENIED } from "./helpers";
import { createFixtures, destroyFixtures, type Fixtures } from "./fixtures";

let f: Fixtures;
beforeAll(async () => {
  f = await createFixtures();
});
afterAll(async () => {
  if (f) await destroyFixtures(f);
});

const NOT_YET = "SB005";

describe("marking a no-show", () => {
  it("only the lesson's own instructor can, and only 10 minutes after it starts", async () => {
    await asUser(f.instructorA, async (db) => {
      await expectSqlError(db, "select public.mark_no_show($1)", [f.bookings.bNow], PERMISSION_DENIED);
      await expectSqlError(db, "select public.mark_no_show($1)", [f.bookings.aFuture], NOT_YET);
    });
    await asUser(f.parent1, async (db) => {
      await expectSqlError(db, "select public.mark_no_show($1)", [f.bookings.aNow], PERMISSION_DENIED);
    });
  });

  it("logs the lesson as a no-show and pays the no-show share, once", async () => {
    await asOwner((db) => db.query("update public.platform_settings set no_show_pay_pct = 50"));
    const rate = await asOwner(async (db) => (await db.query("select pay_rate_cents_per_hour as r from public.instructor_private where instructor_id = $1", [f.instructorA])).rows[0].r as number);
    await asUser(f.instructorA, async (db) => {
      const { rows } = await db.query("select public.mark_no_show($1) as amount", [f.bookings.aNow]);
      expect(rows[0].amount).toBe(Math.round(((60 * rate) / 60) * 0.5));
      // Instructors see their own no-show and its pay.
      expect((await db.query("select status from public.bookings where id = $1", [f.bookings.aNow])).rows[0].status).toBe("no_show");
      expect((await db.query("select amount_cents from public.instructor_earnings where booking_id = $1", [f.bookings.aNow])).rows[0].amount_cents).toBe(rows[0].amount);
      await expectSqlError(db, "select public.mark_no_show($1)", [f.bookings.aNow], OFFER_NOT_PENDING);
    });
    // Another instructor never sees it.
    await asUser(f.instructorB, async (db) => {
      expect((await db.query("select id from public.instructor_earnings where booking_id = $1", [f.bookings.aNow])).rowCount).toBe(0);
    });
    await asOwner((db) => db.query("update public.platform_settings set no_show_pay_pct = 100"));
  });

  it("no-show pay must be between 0 and 100%", async () => {
    await inTransaction(async (db) => {
      await expectSqlError(db, "update public.platform_settings set no_show_pay_pct = 120", [], "23514");
    });
  });
});
