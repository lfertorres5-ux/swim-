# Swim lesson booking platform (San Diego)

Booking platform for an in-home / private-pool swim instruction business. Three roles:
**Parent** (client), **Instructor**, **Admin** (owner).

**Stack:** Next.js 16 (App Router, TypeScript) + Tailwind v4 on Vercel · Supabase (Postgres, Auth, RLS, Storage) ·
Stripe · Twilio Proxy · Resend · Google Maps Places.

> **Core principle: client insulation.** Instructors cannot take clients off-platform. This is enforced
> **in Postgres** (grants + row-level security + audited RPCs), not in the UI. See
> [docs/security-model.md](docs/security-model.md).

## Build status

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Schema, RLS, auth (magic link + Google), instructor terms gate, seed, RLS test suite | ✅ done |
| 2 | Instructor profile + availability builder, scheduling engine, booking requests with auto-offer, San Diego County-only service area | ✅ done |
| 3 | Landing page + service-area map, booking wizard, pricing engine, packages & weekly series, Stripe Checkout / Portal / webhooks, parent account (cancel, reschedule, notes, receipts, favorite) | ✅ done |
| 4 | Email + text notifications (outbox with retries and de-duplication), 24-hour reminders, instructor progress notes from the phone | ✅ done (masked numbers + chat dropped by owner decision) |
| 5 | Admin console (dashboard, bookings, refunds, manual bookings, instructors, pricing/zones/packages/policies, activity log), sub board, Partner Club Day Pass inquiries | ✅ done — see [docs/admin.md](docs/admin.md) |
| 6 | Google Calendar / iCal, outbound webhooks, CSV + import adapters | ⏳ next |

## Repository layout

```
src/
  app/                    Next.js routes
    login/, auth/*        magic link + Google OAuth, token-hash confirm, sign-out
    onboarding/           parent profile; instructor terms acceptance
    parent/ instructor/ admin/   role areas (each layout enforces its role)
    instructor/profile, /availability, /requests   profile (first name, bio, photo), hours & zones, accept/decline
    admin/scheduling      run any request through the engine; rankings explained
    book/                 6-step booking wizard (address → swimmers → instructor → plan → time → pay)
    parent/lessons/[id]   lesson detail: cancel (refund preview), reschedule, notes, favorite
    parent/progress, /receipts   progress notes; payments + Stripe Customer Portal
    api/webhooks/stripe   signed Stripe events → fulfillment / release / refund sync
    dev/checkout          simulated checkout for keyless local dev (never in production)
    instructor/lessons/[id]/note   phone-first progress note (skills checklist + comment)
    admin/notifications   every email/text sent or logged
    admin/bookings, /payments, /instructors, /sub-board, /day-pass, /settings, /activity   owner tools (docs/admin.md)
    instructor/sub-board  post a lesson for a sub / claim one
    day-pass/             Partner Club Day Pass inquiry form
    api/cron/notifications   24-hour reminders + delivery retries (every 5 min)
    api/availability      slot search for the booking calendar
    api/cron/scheduling   expire offers & holds, auto-offer onward (Vercel Cron)
  lib/
    auth.ts               data-access layer: getCurrentUser / requireRole / safeNextPath
    supabase/             server (RLS), browser, proxy (session refresh), admin (service role)
    time.ts               America/Los_Angeles helpers (wall clock ⇄ UTC, DST-safe)
    scheduling/           engine (pure), snapshot loader, offer loop — see docs/scheduling.md
    geo/                  San Diego County outline, ZIP rules, zone detection, server geocoding
    pricing/              pricing engine (pure) + catalog / promo lookup
    booking/              checkout, fulfillment, cancel/reschedule, address verification, policy
    payments/             Stripe gateway (+ dev gateway), webhook handling
    notifications/        templates (pure), outbox + Resend/Twilio delivery, business events
    skills.ts             progress-note checklist by swim level
    admin/                owner tools: bookings/refunds/manual bookings, dashboard metrics, form helpers
    sub-board.ts, day-pass.ts   sub board actions; day-pass inquiries
  content/instructor-terms.ts   versioned instructor agreement text
  proxy.ts                session refresh + optimistic auth redirect (Next 16 "proxy")
supabase/
  migrations/             schema → RLS → auth hooks & audited RPCs → storage
  seed.sql                4 instructors, 3 zones, 5 families, bookings relative to today
  templates/              auth email templates (token-hash links)
  config.toml             local Supabase CLI config
tests/rls/                DB suite (Vitest + pg) — runs as real `anon`/`authenticated`/`service_role`
tests/api/                API suite — real PostgREST + supabase-js, exercising the app's server modules
scripts/db/               test DB builder + Supabase shim for vanilla Postgres
scripts/api-test/         downloads PostgREST, mounts it at /rest/v1, runs tests/api
docs/                     security model, scheduling, payments, deployment
```

## Local setup

Prerequisites: Node 20.9+ (22 recommended), Docker, [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started).

```bash
npm install
cp .env.example .env.local

supabase start            # Postgres, Auth, Storage, Studio, Mailpit
supabase db reset         # applies supabase/migrations + supabase/seed.sql
```

Copy the `API URL`, `anon key` and `service_role key` printed by `supabase start` into `.env.local`
(`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`). To try booking
without Stripe, also set `PAYMENTS_DEV_MODE=true` (checkout becomes a simulated page). Without Google Maps keys
the address step falls back to manual entry and ZIP-based zone checks. Then:

```bash
npm run dev               # http://localhost:3000
```

Sign in with any seeded email — the magic link lands in Mailpit at <http://127.0.0.1:54324>:

| Email | Role | Notes |
| --- | --- | --- |
| `owner@example.com` | admin | |
| `maya@example.com` | instructor | 2 lessons **today** (each address shows until 2 h after it ends); favorite of the Carter family |
| `jordan@example.com` | instructor | lessons tomorrow and in 3 days → addresses hidden; **Families** shows Daniel Kim (8-pack) with phone/email |
| `tyler@example.com` | instructor | a pending booking request under **Requests**; posted a lesson to the **Sub board** (sign in as Maya or Jordan to claim it, then approve as the owner); certs expiring soon |
| `sofia@example.com` | instructor | zone A only; blackout date in 10 days |
| `emily@example.com` | parent | 2 kids, weekly recurring series, completed lesson with progress note |
| `priya@example.com` | parent | 3 kids (group pricing), day-pass inquiry |
| `daniel@example.com` / `marcus@example.com` / `hannah@example.com` | parent | Daniel has an 8-pack with Jordan → sees Jordan's contact; Marcus zone B; Hannah zone C |
| `new.instructor@example.com` | (invite) | sign in → becomes an inactive instructor → must accept terms |

**Google sign-in locally:** create an OAuth client (Web) in Google Cloud, add
`http://127.0.0.1:54321/auth/v1/callback` as an authorized redirect URI, set
`SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID/SECRET`, set `enabled = true` under `[auth.external.google]` in
`supabase/config.toml`, and restart Supabase.

**Make yourself admin** (any environment): sign in once, then in the SQL editor:
`update public.users set role = 'admin' where email = 'you@yourdomain.com';`

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js |
| `npm run lint` · `npm run typecheck` | ESLint · `next typegen` + `tsc` |
| `npm test` | unit tests (`src/**/*.test.ts`) |
| `npm run test:rls` | **builds a fresh DB** from `TEST_DATABASE_URL` (shim → migrations → seed) and runs the RLS suite |
| `npm run test:rls:supabase` | runs the RLS suite against an existing DB (e.g. local Supabase after `db reset`) |
| `npm run test:api` | fresh DB + real PostgREST (downloaded once, cached) + supabase-js: availability, the auto-offer loop, cron, page queries |
| `npm run db:reset` | `supabase db reset` |
| `npm run db:types` | generate `src/lib/database.types.ts` from the local schema |

## Testing

The RLS suite (`tests/rls/`) connects with `pg`, then for each test opens a transaction, runs
`SET LOCAL ROLE authenticated` (or `anon`) and sets `request.jwt.claims` — exactly what PostgREST
does for a real API request — so policies, grants and SECURITY DEFINER functions are exercised for real.
Each test is rolled back, and fixtures use random ids, so the suite is safe to run against a dev database.

**Against vanilla Postgres 15+** (what CI does; no Docker needed). Use a superuser connection; the script
drops and recreates the database named in the URL (it refuses to touch `postgres`):

```bash
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/swim_test npm run test:rls
```

`scripts/db/supabase-shim.sql` recreates the bits of Supabase the migrations rely on (`auth.users`,
`auth.uid()`, `anon`/`authenticated`/`service_role`, `storage.objects`); it is skipped automatically on a
real Supabase database.

**Against local Supabase:**

```bash
supabase db reset
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm run test:rls:supabase
```

What the database suite proves (102 tests), among others:

- an instructor cannot read **any** parent row in `users` (email/phone/last name), `parents`, `children`,
  `booking_locations`, `booking_pricing`, `payments`, `packages`, day-pass inquiries, flagged messages or webhooks;
- an instructor cannot see **another instructor's** bookings, lessons, messages, notes, earnings, pay rate or availability,
  and loses access the moment a lesson is reassigned;
- the street address is returned only on the lesson day and hidden again 2 h after it ends (including across DST);
- every instructor view is written to `audit_log`, which instructors can't read or forge and which is append-only;
- instructors who haven't accepted the **current** terms version see nothing;
- role escalation via user metadata or `UPDATE users SET role` is impossible; message senders can't be spoofed;
- the exclusion constraint blocks double-booking an instructor;
- every table in `public` has RLS enabled;
- zones, home addresses and lesson addresses can only be in San Diego County (ZIP + county outline);
- an instructor can't be active (visible to families) without a first name, bio and photo, and the first name
  can't carry a phone number, email or handle;
- the travel-buffer trigger and the engine agree: every slot the engine offers on the seed data is accepted
  by the database;
- accept/decline/expiry of booking requests, and the service-role-only automation RPCs;
- contact sharing: only after a paid package lesson is accepted, only between that family and that
  instructor; it can be switched off, and every view is audited;
- progress notes: only the assigned instructor, only after the lesson starts; submitting completes the
  lesson and records pay once; families see only their own message history;
- sub board: only the assigned instructor can post; the board carries ages/levels only; claims require an
  active, qualified, free instructor in the zone (travel buffer enforced); only an admin approves; filling
  moves the booking (old instructor loses access); cancelling/moving the lesson pulls it; covering a
  package lesson never shares the family's contact details.

Unit tests (111) cover the scheduling engine (windows, overrides, DST, buffers, qualification, neighborhood
slots, ranking, weekly series), the pricing engine (every spec price, group, zone, package, series,
neighborhood and promo rule), the cancellation policy, Stripe webhook signatures, San Diego County geometry,
notification templates (including that instructor messages never carry an address or contact details), dashboard metrics (utilization, heatmap, net revenue), certification expiry, and time/phone helpers. The API suite (46) runs the real server modules through PostgREST:
- availability search and the auto-offer loop (offered down the ranked list until nobody is left), plus
  acceptance and the maintenance cron;
- checkout holds at server-computed prices, and a held slot can't be double-booked;
- fulfillment is idempotent, and a failed payment update is raised, never treated as already done;
- 6/14-pack credits and pricing, weekly series, and promo codes;
- package purchase → accept → both sides see contact details;
- on-time and late cancellations and their refunds, and rescheduling with the same instructor;
- Stripe event de-duplication and expiry release;
- notifications for every event (received, request, confirmed, new instructor, reminder, cancelled,
  progress note, no-match), sent once, respecting opt-outs;
- the exact queries the pages run under RLS;
- owner tools: manual bookings (comp / payment link / paid offline; no double-booking; county-only
  addresses), partial and capped refunds, owner cancellations, reassignment, the sub board end to end
  with every notification, and day-pass inquiries (honeypot, rate limit, payment-link email).

## Service area: San Diego County only

Zone ZIPs, home addresses and lesson addresses must be San Diego County ZIPs (919xx, 920xx or 921xx). Zone
boundaries and stored coordinates must sit inside the county outline. These are Postgres CHECK constraints, so
neither the admin UI nor the API can create an out-of-county zone or booking. `detectZone()` rejects
out-of-county addresses before looking at zones.

## Deploying

See [docs/deploy.md](docs/deploy.md) (Supabase project → migrations → auth settings → Vercel).
