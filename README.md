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
| 2 | Instructor availability builder + scheduling engine | ⏳ next |
| 3 | Parent booking flow, pricing engine, Stripe Checkout / Portal, landing page | — |
| 4 | Masked comms (Twilio Proxy), chat filter, lesson notes, notifications | — |
| 5 | Admin console, sub board, day-pass inquiries | — |
| 6 | Google Calendar / iCal, outbound webhooks, CSV + import adapters | — |

## Repository layout

```
src/
  app/                    Next.js routes
    login/, auth/*        magic link + Google OAuth, token-hash confirm, sign-out
    onboarding/           parent profile; instructor terms acceptance
    parent/ instructor/ admin/   role areas (each layout enforces its role)
  lib/
    auth.ts               data-access layer: getCurrentUser / requireRole / safeNextPath
    supabase/             server (RLS), browser, proxy (session refresh), admin (service role)
    time.ts               America/Los_Angeles helpers
  content/instructor-terms.ts   versioned instructor agreement text
  proxy.ts                session refresh + optimistic auth redirect (Next 16 "proxy")
supabase/
  migrations/             schema → RLS → auth hooks & audited RPCs → storage
  seed.sql                4 instructors, 3 zones, 5 families, bookings relative to today
  templates/              auth email templates (token-hash links)
  config.toml             local Supabase CLI config
tests/rls/                RLS suite (Vitest + pg) — runs as real `anon`/`authenticated` roles
scripts/db/               test DB builder + Supabase shim for vanilla Postgres
docs/                     security model, deployment
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
(`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`), then:

```bash
npm run dev               # http://localhost:3000
```

Sign in with any seeded email — the magic link lands in Mailpit at <http://127.0.0.1:54324>:

| Email | Role | Notes |
| --- | --- | --- |
| `owner@example.com` | admin | |
| `maya@example.com` | instructor | 2 lessons **today** → addresses visible; favorite of the Carter family |
| `jordan@example.com` | instructor | lessons tomorrow and in 3 days → addresses hidden |
| `tyler@example.com` | instructor | released a lesson to the sub board; has a pending booking request; certs expiring soon |
| `sofia@example.com` | instructor | blackout date in 10 days |
| `emily@example.com` | parent | 2 kids, weekly recurring series, completed lesson with progress note |
| `priya@example.com` | parent | 3 kids (group pricing), day-pass inquiry |
| `daniel@example.com` / `marcus@example.com` / `hannah@example.com` | parent | package, zone B, zone C |
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

What the suite proves (52 tests), among others:

- an instructor cannot read **any** parent row in `users` (email/phone/last name), `parents`, `children`,
  `booking_locations`, `booking_pricing`, `payments`, `packages`, day-pass inquiries, flagged messages or webhooks;
- an instructor cannot see **another instructor's** bookings, lessons, messages, notes, earnings, pay rate or availability,
  and loses access the moment a lesson is reassigned;
- the street address is returned only on the lesson day and hidden again 2 h after it ends (including across DST);
- every instructor view is written to `audit_log`, which instructors can't read or forge and which is append-only;
- instructors who haven't accepted the **current** terms version see nothing;
- role escalation via user metadata or `UPDATE users SET role` is impossible; message senders can't be spoofed;
- the exclusion constraint blocks double-booking an instructor;
- every table in `public` has RLS enabled.

## Deploying

See [docs/deploy.md](docs/deploy.md) (Supabase project → migrations → auth settings → Vercel).
