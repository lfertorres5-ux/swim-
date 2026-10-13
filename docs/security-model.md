# Security model: client insulation

The business only works if instructors can't take clients off-platform. Hiding fields in the UI isn't
enough: any signed-in user holds a Supabase JWT and can query the REST API directly. So every guarantee
below is enforced by **Postgres itself**, and each one is covered by `tests/rls/`.

## Three layers

1. **Grants.** Supabase's default "API roles can touch every table" privileges are revoked
   (`20261013000300_rls.sql`, section 0). Each table is then granted explicitly, with **column-level** grants
   for updates. A new table is invisible to the API until someone grants it.
2. **Row-level security** on every table in `public` (a test fails if one is missing). Policies call small
   `SECURITY DEFINER` helpers in the non-exposed `private` schema (`is_admin()`, `is_active_instructor()`,
   `is_booking_parent()`, …).
3. **Audited RPCs.** Instructors have *no* row access to children, addresses or contact data. They read
   lesson details only through `public.instructor_lessons(from, to)` / `public.instructor_lesson(id)`, which
   check authorization, shape the output, apply the address window, and write an `audit_log` row for every
   lesson returned.

## Where sensitive data lives

| Data | Table | Who can read |
| --- | --- | --- |
| Parent email, phone, last name | `users` | self, admin. Instructor: **only** via the audited `my_family_contacts()` RPC, and only for package families (see Contact sharing) |
| Home address, Stripe customer | `parents` | self, admin |
| Child first name, birth date, level, notes | `children` | parent, admin. Instructor: **RPC only**, as first name + *age* + level + notes |
| Lesson street address + gate code | `booking_locations` | parent, admin. Instructor: **RPC only**, from local midnight on lesson day until end + 2 h (configurable) |
| What the parent paid | `booking_pricing`, `payments`, `packages` | parent, admin. **Never** instructors |
| Instructor pay rate, iCal token | `instructor_private` | that instructor, admin. Nobody can edit their own rate |
| Instructor earnings / payouts | `instructor_earnings`, `instructor_payouts` | that instructor, admin |
| Lesson time, zone, neighborhood | `bookings` | parent, **assigned** instructor, admin. No PII and no prices on this table |
| Instructor public profile (first name, bio, photo) | `instructors` | everyone, for active instructors. **First name only**, never a last name; the format allows letters, spaces, hyphens and apostrophes, so it can't carry a phone number, email or handle |
| Pre-acceptance request / sub-board details | `booking_offers.lesson_summary`, `open_shifts.lesson_summary` | ages + levels + zone + time only, no names |
| Flagged-message originals | `flagged_messages` | admin |
| Audit trail | `audit_log` | admin (append-only, enforced by trigger even for the DB owner) |

The rule behind the table: **columns are never "hidden" inside a table an instructor can read.**
Anything an instructor must not see sits in a table they have no policy on.

## Instructor access conditions

`private.is_active_instructor()` is true only when **all** of these hold:

- `users.role = 'instructor'`;
- `instructors.is_active` (an admin activates after verifying certifications);
- an `instructor_terms_acceptances` row exists for the **current** `platform_settings.instructor_terms_version`.

Publishing new terms (bumping the version) immediately cuts off every instructor's access to client data
until they accept again. Reassigning a booking (a sub) moves access to the new instructor instantly.

## Contact sharing (package families)

**Owner decision:** once a family has **paid for a package** and an instructor has **accepted a lesson from
it**, that family and that instructor may see each other's name, phone and email. Both sides use audited RPCs:
- `my_family_contacts()` for instructors;
- `my_instructor_contacts()` for parents.

Nothing else changes:
- **Masked:** single lessons and weekly series; other instructors; unpaid, refunded or expired packages.
- **No new table access:** instructors still have no row access to `users`/`parents`, so the RPC is the only
  path.
- **Address:** the lesson address keeps its day-of reveal window.
- **Off switch:** `platform_settings.contact_sharing = 'never'` turns sharing off everywhere.

Every contact view writes an `audit_log` row. Instructor terms version `2026-10-16` covers this: contact is
allowed, but booking and payment must stay on the platform.

## Instructor profiles

An instructor can't be **active** (shown to families, offered bookings) unless they have a first name, a bio
of at least 40 characters, and a photo. The photo must be their own upload in `instructor-photos/<their
id>/…` or a bundled seed image. Active instructors can't blank these fields. All of this is enforced by CHECK
constraints. The bio is free text and will be screened by the Phase 4 contact filter.

## Service area

Every zone ZIP, home address and lesson address must be a San Diego County ZIP (919xx–921xx), and every zone
vertex and stored coordinate must fall inside the county outline (`private.within_sd_county`, identical to
`SD_COUNTY_OUTLINE` in the app; a test keeps the two in sync).

## Roles can't be self-assigned

- `users.role` has no UPDATE grant, so it can't be changed through the API.
- On signup, `private.handle_new_auth_user()` assigns the role from a pending `instructor_invites` row,
  or from `raw_app_meta_data` (only writable with the service role). It **ignores** `raw_user_meta_data`,
  which the user controls. Everyone else becomes a parent.

## Writes that must stay server-side

Bookings, pricing, payments, refunds, role and pay changes, and address/zone assignment have **no** client
grants. They run in server actions and route handlers with the service-role client
(`src/lib/supabase/admin.ts`), only after `requireRole()` or an ownership check, and they write to
`audit_log`. That way pricing rules, Stripe payment and zone validation can't be skipped by calling the API
directly.

## Communication (Phase 4)

- `messages.sender_id` defaults to `auth.uid()` and can't be supplied (column grant); `sender_role` is set by
  a trigger.
- Phase 4 adds a `BEFORE INSERT` trigger on `messages` and `lesson_notes`. It redacts phone numbers, emails,
  social handles, URLs and payment-app names (Venmo, Zelle, Cash App, …), stores the original in
  `flagged_messages`, and alerts the admin. Because it's a trigger, it also covers direct API inserts.
- Phone and SMS go through Twilio Proxy sessions that expire after the lesson. Real numbers are never sent to
  the other party.

## Export resistance

- No list endpoints return client data to instructors. The lesson RPC range is capped by
  `platform_settings.max_lesson_view_range_days` (default 31).
- Every lesson view is logged with actor, booking, whether the address was revealed, IP and user agent, so
  unusual access patterns can be reviewed in Admin → Audit log (Phase 5).
- Calendar sync and iCal feeds (Phase 6) emit busy blocks only, with no client PII.
