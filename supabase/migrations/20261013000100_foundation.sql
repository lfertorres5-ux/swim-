-- =============================================================================
-- Phase 1 · Foundation: extensions, schemas, enums, shared trigger functions.
--
-- Timezone: every timestamp is stored as timestamptz (UTC on disk). Anything
-- that needs a *local* notion of "day" or "time of day" converts explicitly
-- with AT TIME ZONE 'America/Los_Angeles' — never rely on the session TZ.
-- =============================================================================

create extension if not exists btree_gist with schema extensions;

-- Helper functions used by RLS policies live in `private`, which is NOT exposed
-- through the PostgREST API (only `public` is). Clients cannot call them as RPCs.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
create type public.user_role as enum ('parent', 'instructor', 'admin');

create type public.swim_level as enum (
  'water_acclimation',   -- new to water / fearful
  'beginner',
  'advanced_beginner',
  'intermediate',
  'advanced',
  'stroke_technique'
);

create type public.booking_status as enum (
  'pending_payment',     -- slot held while Stripe Checkout is open
  'pending_instructor',  -- paid, waiting for instructor to accept the request
  'confirmed',
  'completed',
  'cancelled',
  'no_show',
  'expired'              -- payment hold or instructor offer chain ran out
);

create type public.booking_kind as enum ('single', 'package', 'recurring', 'manual');

create type public.availability_override_kind as enum ('available', 'blackout');

create type public.offer_status as enum ('pending', 'accepted', 'declined', 'expired', 'superseded');

create type public.open_shift_status as enum (
  'open',
  'pending_approval',    -- claimed; waiting on admin (when approval is required)
  'filled',
  'cancelled',
  'expired'
);

create type public.payment_status as enum (
  'pending', 'succeeded', 'failed', 'refunded', 'partially_refunded', 'cancelled'
);

create type public.package_status as enum ('pending_payment', 'active', 'exhausted', 'expired', 'refunded');

create type public.series_status as enum ('pending_payment', 'active', 'paused', 'cancelled', 'ended');

create type public.certification_kind as enum (
  'cpr', 'first_aid', 'lifeguard', 'water_safety_instructor', 'swim_instructor', 'background_check', 'other'
);

create type public.earning_status as enum ('pending', 'approved', 'paid', 'void');

create type public.flag_reason as enum ('phone', 'email', 'social_handle', 'payment_app', 'url', 'off_platform_language');

create type public.flag_status as enum ('open', 'reviewed', 'actioned', 'dismissed');

create type public.inquiry_status as enum (
  'new', 'contacted', 'approved', 'payment_link_sent', 'paid', 'declined', 'closed'
);

create type public.interest_level as enum ('just_curious', 'interested', 'ready_to_book');

-- -----------------------------------------------------------------------------
-- Shared trigger functions
-- -----------------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Local (America/Los_Angeles) calendar date of a timestamptz.
create or replace function private.la_date(ts timestamptz)
returns date
language sql
immutable
set search_path = ''
as $$
  select (ts at time zone 'America/Los_Angeles')::date
$$;

-- Midnight America/Los_Angeles at the start of the local day containing `ts`.
create or replace function private.la_day_start(ts timestamptz)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select (date_trunc('day', ts at time zone 'America/Los_Angeles')) at time zone 'America/Los_Angeles'
$$;

-- Address reveal window (pure function so it can be unit-tested with fixed
-- clocks): visible from local midnight of the lesson day until
-- `hide_after_minutes` after the lesson ends.
create or replace function private.address_window_open(
  starts_at timestamptz,
  ends_at timestamptz,
  at_time timestamptz,
  hide_after_minutes integer
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select at_time >= private.la_day_start(starts_at)
     and at_time <= ends_at + make_interval(mins => hide_after_minutes)
$$;

-- Random URL-safe token without requiring pgcrypto (2 × UUIDv4 ≈ 244 random bits).
create or replace function private.random_token()
returns text
language sql
volatile
set search_path = ''
as $$
  select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
$$;
