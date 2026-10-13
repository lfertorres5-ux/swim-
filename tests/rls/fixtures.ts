import { randomUUID } from "node:crypto";
import { asOwner } from "./helpers";

/**
 * A self-contained cast of characters, created fresh for each test run with
 * random ids so the suite can also run against a seeded Supabase database.
 *
 *   instructorA  active, accepted terms, zone T — assigned to parent1's lessons
 *   instructorB  active, accepted terms, zone T — assigned to parent2's lesson
 *   pendingInstr active, has NOT accepted current terms — assigned one lesson
 *   parent1      Ruby's parent
 *   parent2      Theo's parent
 *   admin
 *
 * Bookings are placed relative to now() so the address-window assertions are
 * deterministic regardless of when the suite runs.
 */
export type Fixtures = Awaited<ReturnType<typeof createFixtures>>;

export const PARENT1_CONTACT = {
  email: `p1-${randomUUID().slice(0, 8)}@rls.test`,
  phone: "+16195550901",
  lastName: "Zebrowski",
  address: "4242 Secret Cove Rd",
};

export async function createFixtures() {
  const id = () => randomUUID();
  const f = {
    zoneId: id(),
    zoneCode: `T${randomUUID().slice(0, 6)}`,
    admin: id(),
    instructorA: id(),
    instructorB: id(),
    pendingInstr: id(),
    parent1: id(),
    parent2: id(),
    childRuby: id(),
    childTheo: id(),
    bookings: {
      aNow: id(), //           parent1 · A · in progress right now
      aEndedRecently: id(), // parent1 · A · ended 60 min ago (inside 2h window)
      aEndedLongAgo: id(), //  parent1 · A · ended 3.5h ago (outside window)
      aFuture: id(), //        parent1 · A · in 3 days
      aCancelled: id(), //     parent1 · A · cancelled, in 2 hours
      bNow: id(), //           parent2 · B · in progress right now
      pendingNow: id(), //     parent2 · pendingInstr · in progress right now
    },
  };

  await asOwner(async (db) => {
    await db.query("begin");

    await db.query(
      `insert into public.zones (id, code, name, postal_codes) values ($1, $2, 'RLS Test Zone', '{99999}')`,
      [f.zoneId, f.zoneCode],
    );

    const mkUser = async (uid: string, email: string, first: string, last: string, role: string, phone: string | null) => {
      await db.query(
        `insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, email_confirmed_at)
         values ($1, 'authenticated', 'authenticated', $2, $3, $4, now())`,
        [uid, email, JSON.stringify({ role }), JSON.stringify({ first_name: first, last_name: last })],
      );
      await db.query(`update public.users set phone = $2 where id = $1`, [uid, phone]);
    };

    await mkUser(f.admin, `admin-${f.admin.slice(0, 8)}@rls.test`, "Ada", "Admin", "admin", "+16195550900");
    await mkUser(f.instructorA, `ia-${f.instructorA.slice(0, 8)}@rls.test`, "Ivy", "Alpha", "instructor", "+16195550911");
    await mkUser(f.instructorB, `ib-${f.instructorB.slice(0, 8)}@rls.test`, "Ian", "Bravo", "instructor", "+16195550912");
    await mkUser(f.pendingInstr, `ip-${f.pendingInstr.slice(0, 8)}@rls.test`, "Pat", "Pending", "instructor", null);
    await mkUser(f.parent1, PARENT1_CONTACT.email, "Paula", PARENT1_CONTACT.lastName, "parent", PARENT1_CONTACT.phone);
    await mkUser(f.parent2, `p2-${f.parent2.slice(0, 8)}@rls.test`, "Quinn", "Quartz", "parent", "+16195550902");

    await db.query(`update public.instructors set is_active = true where id = any($1)`, [
      [f.instructorA, f.instructorB, f.pendingInstr],
    ]);
    await db.query(
      `insert into public.instructor_terms_acceptances (instructor_id, terms_version)
       select i, s.instructor_terms_version from unnest($1::uuid[]) i, public.platform_settings s`,
      [[f.instructorA, f.instructorB]],
    );
    await db.query(`insert into public.instructor_zones (instructor_id, zone_id) select i, $2 from unnest($1::uuid[]) i`, [
      [f.instructorA, f.instructorB, f.pendingInstr],
      f.zoneId,
    ]);
    await db.query(`update public.instructor_private set pay_rate_cents_per_hour = 5100 where instructor_id = $1`, [
      f.instructorB,
    ]);

    await db.query(
      `update public.parents set address_line1 = $2, city = 'Encinitas', postal_code = '92024', zone_id = $3,
              stripe_customer_id = 'cus_' || left(md5($1::text), 12)
       where id = $1`,
      [f.parent1, PARENT1_CONTACT.address, f.zoneId],
    );

    await db.query(
      `insert into public.children (id, parent_id, first_name, birth_date, swim_level, notes) values
         ($1, $2, 'Ruby', (now() - interval '6 years 2 months')::date, 'beginner', 'Likes goggles'),
         ($3, $4, 'Theo', (now() - interval '4 years')::date, 'water_acclimation', null)`,
      [f.childRuby, f.parent1, f.childTheo, f.parent2],
    );

    const b = f.bookings;
    const rows: [string, string, string, string, string, string][] = [
      [b.aNow, f.parent1, f.instructorA, "-30 minutes", "30 minutes", "confirmed"],
      [b.aEndedRecently, f.parent1, f.instructorA, "-90 minutes", "-60 minutes", "confirmed"],
      [b.aEndedLongAgo, f.parent1, f.instructorA, "-4 hours", "-210 minutes", "confirmed"],
      [b.aFuture, f.parent1, f.instructorA, "3 days", "3 days 1 hour", "confirmed"],
      [b.aCancelled, f.parent1, f.instructorA, "2 hours", "150 minutes", "cancelled"],
      [b.bNow, f.parent2, f.instructorB, "-30 minutes", "30 minutes", "confirmed"],
      [b.pendingNow, f.parent2, f.pendingInstr, "-30 minutes", "30 minutes", "confirmed"],
    ];
    for (const [bid, parent, instr, start, end, status] of rows) {
      await db.query(
        `insert into public.bookings (id, parent_id, instructor_id, zone_id, neighborhood, starts_at, ends_at, status)
         values ($1, $2, $3, $4, 'Leucadia', now() + $5::interval, now() + $6::interval, $7)`,
        [bid, parent, instr, f.zoneId, start, end, status],
      );
      const child = parent === f.parent1 ? f.childRuby : f.childTheo;
      await db.query(`insert into public.booking_children (booking_id, child_id) values ($1, $2)`, [bid, child]);
      await db.query(
        `insert into public.booking_locations (booking_id, address_line1, city, postal_code, access_notes)
         values ($1, $2, 'Encinitas', '92024', 'Gate code 1234')`,
        [bid, parent === f.parent1 ? PARENT1_CONTACT.address : "77 Other Family Ln"],
      );
      await db.query(
        `insert into public.booking_pricing (booking_id, base_cents, total_cents) values ($1, 9000, 9000)`,
        [bid],
      );
      await db.query(
        `insert into public.payments (parent_id, booking_id, amount_cents, status) values ($1, $2, 9000, 'succeeded')`,
        [parent, bid],
      );
    }

    await db.query(
      `insert into public.instructor_earnings (instructor_id, booking_id, minutes, rate_cents_per_hour, amount_cents, earned_on)
       values ($1, $2, 30, 4000, 2000, current_date), ($3, $4, 60, 5100, 5100, current_date)`,
      [f.instructorA, b.aEndedRecently, f.instructorB, b.bNow],
    );
    await db.query(
      `insert into public.lesson_notes (booking_id, instructor_id, summary) values ($1, $2, 'Ruby floated!'), ($3, $4, 'Theo blew bubbles')`,
      [b.aEndedRecently, f.instructorA, b.bNow, f.instructorB],
    );
    await db.query(
      `insert into public.messages (booking_id, sender_id, body) values ($1, $2, 'See you soon'), ($3, $4, 'Theo is excited')`,
      [b.aNow, f.parent1, b.bNow, f.parent2],
    );
    await db.query(
      `insert into public.availability_rules (instructor_id, weekday, start_time, end_time) values ($1, 1, '09:00', '12:00'), ($2, 2, '09:00', '12:00')`,
      [f.instructorA, f.instructorB],
    );
    await db.query(
      `insert into public.day_pass_inquiries (parent_id, contact_name, contact_email) values ($1, 'Paula Zebrowski', $2)`,
      [f.parent1, PARENT1_CONTACT.email],
    );

    await db.query("commit");
  });

  return f;
}

/** Best-effort cleanup so the suite can run against a shared dev database. */
export async function destroyFixtures(f: Fixtures) {
  await asOwner(async (db) => {
    const users = [f.admin, f.instructorA, f.instructorB, f.pendingInstr, f.parent1, f.parent2];
    await db.query("begin");
    await db.query(`delete from public.instructor_earnings where instructor_id = any($1)`, [users]);
    await db.query(`delete from public.payments where parent_id = any($1)`, [users]);
    await db.query(`delete from public.bookings where parent_id = any($1)`, [users]);
    await db.query(`delete from auth.users where id = any($1)`, [users]);
    await db.query(`delete from public.zones where id = $1`, [f.zoneId]);
    await db.query("commit");
  });
}
