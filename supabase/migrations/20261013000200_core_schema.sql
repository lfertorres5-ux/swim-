-- =============================================================================
-- Phase 1 · Core schema
--
-- Design rule for client insulation: data an instructor must never see lives in
-- tables they have NO row access to. Columns are never "hidden" in a table an
-- instructor can read. Concretely:
--   users              email / phone / last name           → self + admin only
--   parents            home address, Stripe ids            → self + admin only
--   booking_locations  lesson street address               → parent + admin; instructor
--                                                             only via audited RPC, day-of
--   booking_pricing    what the parent paid                → parent + admin only
--   instructor_private pay rate, iCal token                → self + admin only
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Platform configuration (singletons — every price/policy is editable in admin)
-- -----------------------------------------------------------------------------
create table public.platform_settings (
  id boolean primary key default true check (id),
  timezone text not null default 'America/Los_Angeles',
  cancellation_window_hours integer not null default 24 check (cancellation_window_hours >= 0),
  late_cancel_refund_pct numeric(5,2) not null default 0 check (late_cancel_refund_pct between 0 and 100),
  booking_request_window_hours integer not null default 12 check (booking_request_window_hours > 0),
  payment_hold_minutes integer not null default 20 check (payment_hold_minutes > 0),
  default_travel_buffer_minutes integer not null default 30 check (default_travel_buffer_minutes >= 0),
  default_instructor_pay_cents_per_hour integer not null default 4000 check (default_instructor_pay_cents_per_hour >= 0),
  sub_board_requires_approval boolean not null default true,
  address_hide_after_minutes integer not null default 120 check (address_hide_after_minutes >= 0),
  masked_number_ttl_minutes integer not null default 120 check (masked_number_ttl_minutes >= 0),
  instructor_terms_version text not null default '2026-10-01',
  max_children_per_lesson integer not null default 6 check (max_children_per_lesson > 0),
  max_lesson_view_range_days integer not null default 31 check (max_lesson_view_range_days between 1 and 92),
  support_email text,
  support_phone text,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table public.pricing_config (
  id boolean primary key default true check (id),
  currency text not null default 'usd',
  included_children integer not null default 2 check (included_children >= 1),
  extra_child_cents integer not null default 2500 check (extra_child_cents >= 0),
  recurring_discount_pct numeric(5,2) not null default 10 check (recurring_discount_pct between 0 and 100),
  neighborhood_discount_cents integer not null default 500 check (neighborhood_discount_cents >= 0),
  neighborhood_window_minutes integer not null default 60 check (neighborhood_window_minutes >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table public.lesson_prices (
  duration_minutes integer primary key check (duration_minutes > 0 and duration_minutes % 15 = 0),
  price_cents integer not null check (price_cents >= 0),
  label text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);

create table public.package_offerings (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  lesson_count integer not null check (lesson_count > 1),
  discount_pct numeric(5,2) not null check (discount_pct between 0 and 100),
  validity_days integer not null default 180 check (validity_days > 0),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lesson_count)
);

-- -----------------------------------------------------------------------------
-- Zones
-- -----------------------------------------------------------------------------
create table public.zones (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,                       -- 'A', 'B', 'C'
  name text not null,
  description text,
  travel_fee_cents integer not null default 0 check (travel_fee_cents >= 0),
  min_booking_minutes integer not null default 0 check (min_booking_minutes >= 0),
  is_bookable boolean not null default true,
  postal_codes text[] not null default '{}',
  neighborhoods text[] not null default '{}',
  boundary jsonb,                                  -- GeoJSON Polygon | MultiPolygon
  map_color text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index zones_postal_codes_gin on public.zones using gin (postal_codes);

create table public.zone_travel_buffers (
  from_zone_id uuid not null references public.zones (id) on delete cascade,
  to_zone_id uuid not null references public.zones (id) on delete cascade,
  buffer_minutes integer not null check (buffer_minutes >= 0),
  primary key (from_zone_id, to_zone_id)
);

-- -----------------------------------------------------------------------------
-- Users & roles
-- -----------------------------------------------------------------------------
create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.user_role not null default 'parent',
  email text not null,
  first_name text,
  last_name text,
  phone text check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),  -- E.164
  sms_opt_in boolean not null default false,
  email_opt_in boolean not null default true,
  onboarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index users_role_idx on public.users (role);
create index users_email_lower_idx on public.users (lower(email));

create table public.instructors (
  id uuid primary key references public.users (id) on delete cascade,
  display_name text not null,                      -- e.g. "Maya R." — never a full name
  bio text,
  photo_path text,                                 -- storage: instructor-photos/<id>/...
  specialties text[] not null default '{}',        -- toddlers, fearful_swimmers, stroke_technique, ...
  levels_taught public.swim_level[] not null default enum_range(null::public.swim_level),
  min_child_age_months integer not null default 6 check (min_child_age_months >= 0),
  max_children_per_lesson integer not null default 4 check (max_children_per_lesson > 0),
  years_experience integer check (years_experience >= 0),
  languages text[] not null default '{English}',
  is_active boolean not null default false,        -- admin activates after onboarding
  is_accepting_new_clients boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.instructor_private (
  instructor_id uuid primary key references public.instructors (id) on delete cascade,
  pay_rate_cents_per_hour integer not null default 4000 check (pay_rate_cents_per_hour >= 0),
  ical_feed_token text not null unique default private.random_token(),
  deactivated_at timestamptz,
  deactivation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.instructor_terms_acceptances (
  id uuid primary key default gen_random_uuid(),
  instructor_id uuid not null references public.instructors (id) on delete cascade,
  terms_version text not null,
  accepted_at timestamptz not null default now(),
  ip_address text,
  user_agent text,
  unique (instructor_id, terms_version)
);

create table public.instructor_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  invited_by uuid references public.users (id) on delete set null,
  pay_rate_cents_per_hour integer check (pay_rate_cents_per_hour >= 0),
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_user_id uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index instructor_invites_email_idx on public.instructor_invites (lower(email)) where accepted_at is null;

create table public.instructor_certifications (
  id uuid primary key default gen_random_uuid(),
  instructor_id uuid not null references public.instructors (id) on delete cascade,
  kind public.certification_kind not null,
  issuer text,                                     -- e.g. "American Red Cross"
  issued_on date,
  expires_on date,
  document_path text,                              -- storage: certifications/<instructor_id>/...
  verified_at timestamptz,
  verified_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_on is null or issued_on is null or expires_on >= issued_on)
);

create index instructor_certifications_instructor_idx on public.instructor_certifications (instructor_id);
create index instructor_certifications_expiry_idx on public.instructor_certifications (expires_on);

create table public.instructor_zones (
  instructor_id uuid not null references public.instructors (id) on delete cascade,
  zone_id uuid not null references public.zones (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (instructor_id, zone_id)
);

create index instructor_zones_zone_idx on public.instructor_zones (zone_id);

-- -----------------------------------------------------------------------------
-- Parents & children
-- -----------------------------------------------------------------------------
create table public.parents (
  id uuid primary key references public.users (id) on delete cascade,
  stripe_customer_id text unique,
  favorite_instructor_id uuid references public.instructors (id) on delete set null,
  -- Default lesson address. Copied into booking_locations per booking.
  address_line1 text,
  address_line2 text,
  city text,
  state text default 'CA',
  postal_code text,
  lat double precision,
  lng double precision,
  google_place_id text,
  zone_id uuid references public.zones (id) on delete set null,
  neighborhood text,
  access_notes text,                               -- gate code, pool location, parking
  preferred_days smallint[] not null default '{}', -- 0 = Sunday … 6 = Saturday
  preferred_time_windows jsonb not null default '[]'::jsonb, -- [{"start":"15:00","end":"18:00"}]
  source text not null default 'web',              -- web | import:csv | import:acuity …
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index parents_zone_idx on public.parents (zone_id);

create table public.children (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references public.parents (id) on delete cascade,
  first_name text not null check (length(trim(first_name)) between 1 and 60),
  birth_date date check (birth_date > date '1900-01-01'),
  swim_level public.swim_level not null default 'beginner',
  notes text,                                      -- shared with the assigned instructor
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index children_parent_idx on public.children (parent_id);

-- -----------------------------------------------------------------------------
-- Availability
-- -----------------------------------------------------------------------------
create table public.availability_rules (
  id uuid primary key default gen_random_uuid(),
  instructor_id uuid not null references public.instructors (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),   -- 0 = Sunday (local)
  start_time time not null,                                     -- America/Los_Angeles wall clock
  end_time time not null,
  effective_from date not null default current_date,
  effective_until date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_time > start_time),
  check (effective_until is null or effective_until >= effective_from)
);

create index availability_rules_instructor_idx on public.availability_rules (instructor_id, weekday);

create table public.availability_overrides (
  id uuid primary key default gen_random_uuid(),
  instructor_id uuid not null references public.instructors (id) on delete cascade,
  date date not null,                                           -- local date
  kind public.availability_override_kind not null,
  start_time time,                                              -- null + blackout = whole day
  end_time time,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((start_time is null) = (end_time is null)),
  check (start_time is null or end_time > start_time),
  check (kind = 'blackout' or start_time is not null)
);

create index availability_overrides_instructor_date_idx on public.availability_overrides (instructor_id, date);

-- -----------------------------------------------------------------------------
-- Packages & recurring series (purchases)
-- -----------------------------------------------------------------------------
create table public.packages (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references public.parents (id) on delete cascade,
  offering_id uuid references public.package_offerings (id) on delete set null,
  lesson_count integer not null check (lesson_count > 0),
  lessons_remaining integer not null check (lessons_remaining >= 0),
  duration_minutes integer not null check (duration_minutes > 0),
  children_count integer not null check (children_count > 0),
  zone_id uuid references public.zones (id) on delete set null,
  unit_price_cents integer not null check (unit_price_cents >= 0),
  discount_pct numeric(5,2) not null default 0,
  total_cents integer not null check (total_cents >= 0),
  status public.package_status not null default 'pending_payment',
  purchased_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (lessons_remaining <= lesson_count)
);

create index packages_parent_idx on public.packages (parent_id);

create table public.booking_series (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references public.parents (id) on delete cascade,
  instructor_id uuid references public.instructors (id) on delete set null,
  zone_id uuid not null references public.zones (id),
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,                                     -- local wall clock
  duration_minutes integer not null check (duration_minutes > 0),
  children_count integer not null check (children_count > 0),
  starts_on date not null,
  ends_on date,
  discount_pct numeric(5,2) not null default 0,
  status public.series_status not null default 'pending_payment',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on)
);

create index booking_series_parent_idx on public.booking_series (parent_id);
create index booking_series_instructor_idx on public.booking_series (instructor_id);

-- -----------------------------------------------------------------------------
-- Bookings
-- -----------------------------------------------------------------------------
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references public.parents (id) on delete restrict,
  instructor_id uuid references public.instructors (id) on delete restrict,
  requested_instructor_id uuid references public.instructors (id) on delete set null, -- null = first available
  zone_id uuid not null references public.zones (id),
  neighborhood text,                                            -- coarse; safe for instructors
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  duration_minutes integer generated always as ((extract(epoch from (ends_at - starts_at)) / 60)::integer) stored,
  status public.booking_status not null default 'pending_payment',
  kind public.booking_kind not null default 'single',
  series_id uuid references public.booking_series (id) on delete set null,
  package_id uuid references public.packages (id) on delete set null,
  children_count integer not null default 1 check (children_count > 0),
  is_neighborhood_slot boolean not null default false,
  hold_expires_at timestamptz,                                  -- for pending_payment
  source text not null default 'web',                           -- web | admin | import:<adapter>
  external_ref text,
  created_by uuid references public.users (id) on delete set null,
  confirmed_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid references public.users (id) on delete set null,
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (ends_at - starts_at <= interval '4 hours'),
  -- Hard guarantee against double booking: no two live bookings for the same
  -- instructor may overlap in time. Travel buffers are enforced by the
  -- scheduling engine inside the booking transaction (Phase 2).
  constraint bookings_no_instructor_overlap exclude using gist (
    instructor_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (
    instructor_id is not null
    and status in ('pending_payment', 'pending_instructor', 'confirmed', 'completed')
  )
);

create index bookings_parent_idx on public.bookings (parent_id, starts_at desc);
create index bookings_instructor_idx on public.bookings (instructor_id, starts_at);
create index bookings_zone_time_idx on public.bookings (zone_id, starts_at);
create index bookings_status_idx on public.bookings (status);
create index bookings_series_idx on public.bookings (series_id);

create table public.booking_children (
  booking_id uuid not null references public.bookings (id) on delete cascade,
  child_id uuid not null references public.children (id) on delete restrict,
  primary key (booking_id, child_id)
);

create index booking_children_child_idx on public.booking_children (child_id);

-- The street address for a specific lesson. Instructors have NO direct access.
create table public.booking_locations (
  booking_id uuid primary key references public.bookings (id) on delete cascade,
  address_line1 text not null,
  address_line2 text,
  city text not null,
  state text not null default 'CA',
  postal_code text not null,
  lat double precision,
  lng double precision,
  google_place_id text,
  access_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- What the parent paid. Instructors have NO access.
create table public.booking_pricing (
  booking_id uuid primary key references public.bookings (id) on delete cascade,
  currency text not null default 'usd',
  base_cents integer not null default 0,
  extra_children_cents integer not null default 0,
  travel_fee_cents integer not null default 0,
  neighborhood_discount_cents integer not null default 0,
  package_discount_cents integer not null default 0,
  series_discount_cents integer not null default 0,
  promo_discount_cents integer not null default 0,
  discount_code_id uuid,
  total_cents integer not null check (total_cents >= 0),
  snapshot jsonb not null default '{}'::jsonb,                  -- pricing_config at time of booking
  created_at timestamptz not null default now()
);

-- Booking request → instructor accept/decline, with auto-offer to next match.
create table public.booking_offers (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  instructor_id uuid not null references public.instructors (id) on delete cascade,
  rank integer not null default 1,
  status public.offer_status not null default 'pending',
  -- Non-identifying summary shown before acceptance: ages, levels, zone, time.
  lesson_summary jsonb not null default '{}'::jsonb,
  offered_at timestamptz not null default now(),
  expires_at timestamptz not null,
  responded_at timestamptz,
  decline_reason text,
  unique (booking_id, instructor_id)
);

create index booking_offers_instructor_idx on public.booking_offers (instructor_id, status);
create unique index booking_offers_one_pending on public.booking_offers (booking_id) where status = 'pending';

create table public.lesson_notes (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings (id) on delete cascade,
  instructor_id uuid not null references public.instructors (id) on delete restrict,
  skills jsonb not null default '{}'::jsonb,                    -- {"floating": "mastered", ...}
  summary text,
  next_focus text,
  is_flagged boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.open_shifts (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  released_by uuid not null references public.instructors (id) on delete cascade,
  reason text,
  status public.open_shift_status not null default 'open',
  -- Denormalized, non-identifying details so claimers never need booking access.
  zone_id uuid not null references public.zones (id),
  neighborhood text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  lesson_summary jsonb not null default '{}'::jsonb,            -- ages + levels only
  claimed_by uuid references public.instructors (id) on delete set null,
  claimed_at timestamptz,
  decided_by uuid references public.users (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index open_shifts_one_active_per_booking
  on public.open_shifts (booking_id) where status in ('open', 'pending_approval');
create index open_shifts_status_zone_idx on public.open_shifts (status, zone_id, starts_at);

-- -----------------------------------------------------------------------------
-- Money
-- -----------------------------------------------------------------------------
create table public.discount_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  description text,
  percent_off numeric(5,2) check (percent_off > 0 and percent_off <= 100),
  amount_off_cents integer check (amount_off_cents > 0),
  applies_to public.booking_kind[] not null default '{single,package,recurring}',
  max_redemptions integer check (max_redemptions > 0),
  redemptions integer not null default 0,
  valid_from timestamptz,
  valid_until timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((percent_off is null) <> (amount_off_cents is null))
);

create unique index discount_codes_code_idx on public.discount_codes (upper(code));

alter table public.booking_pricing
  add constraint booking_pricing_discount_code_fk
  foreign key (discount_code_id) references public.discount_codes (id) on delete set null;

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.parents (id) on delete set null,
  booking_id uuid references public.bookings (id) on delete set null,
  package_id uuid references public.packages (id) on delete set null,
  series_id uuid references public.booking_series (id) on delete set null,
  day_pass_inquiry_id uuid,
  amount_cents integer not null check (amount_cents >= 0),
  refunded_cents integer not null default 0 check (refunded_cents >= 0),
  currency text not null default 'usd',
  status public.payment_status not null default 'pending',
  description text,
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text unique,
  stripe_charge_id text,
  receipt_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (refunded_cents <= amount_cents)
);

create index payments_parent_idx on public.payments (parent_id, created_at desc);
create index payments_booking_idx on public.payments (booking_id);

create table public.instructor_payouts (
  id uuid primary key default gen_random_uuid(),
  instructor_id uuid not null references public.instructors (id) on delete restrict,
  amount_cents integer not null check (amount_cents >= 0),
  period_start date not null,
  period_end date not null,
  paid_at timestamptz,
  method text,                                     -- direct_deposit | check | stripe_connect
  reference text,
  created_at timestamptz not null default now(),
  check (period_end >= period_start)
);

create index instructor_payouts_instructor_idx on public.instructor_payouts (instructor_id, period_end desc);

create table public.instructor_earnings (
  id uuid primary key default gen_random_uuid(),
  instructor_id uuid not null references public.instructors (id) on delete restrict,
  booking_id uuid not null references public.bookings (id) on delete restrict,
  minutes integer not null check (minutes > 0),
  rate_cents_per_hour integer not null check (rate_cents_per_hour >= 0),
  amount_cents integer not null check (amount_cents >= 0),
  status public.earning_status not null default 'pending',
  earned_on date not null,                          -- local lesson date
  payout_id uuid references public.instructor_payouts (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (instructor_id, booking_id)
);

create index instructor_earnings_instructor_idx on public.instructor_earnings (instructor_id, earned_on desc);

-- -----------------------------------------------------------------------------
-- Messaging & moderation
-- -----------------------------------------------------------------------------
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  sender_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  sender_role public.user_role not null default 'parent',   -- overwritten by trigger
  body text not null check (length(body) between 1 and 2000), -- post-filter (redacted) text
  is_flagged boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index messages_booking_idx on public.messages (booking_id, created_at);

create table public.flagged_messages (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('message', 'lesson_note', 'profile', 'sms')),
  message_id uuid references public.messages (id) on delete set null,
  lesson_note_id uuid references public.lesson_notes (id) on delete set null,
  booking_id uuid references public.bookings (id) on delete set null,
  sender_id uuid references public.users (id) on delete set null,
  sender_role public.user_role,
  original_body text not null,                     -- admin-only; never shown to the recipient
  redacted_body text,
  reasons public.flag_reason[] not null,
  matches text[] not null default '{}',
  status public.flag_status not null default 'open',
  reviewed_by uuid references public.users (id) on delete set null,
  reviewed_at timestamptz,
  admin_notes text,
  created_at timestamptz not null default now()
);

create index flagged_messages_status_idx on public.flagged_messages (status, created_at desc);
create index flagged_messages_sender_idx on public.flagged_messages (sender_id);

-- -----------------------------------------------------------------------------
-- Audit log (append-only)
-- -----------------------------------------------------------------------------
create table public.audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  actor_role public.user_role,
  action text not null,                            -- e.g. instructor.view_lesson
  entity_type text,
  entity_id uuid,
  booking_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  ip_address text,
  user_agent text
);

create index audit_log_actor_idx on public.audit_log (actor_id, occurred_at desc);
create index audit_log_action_idx on public.audit_log (action, occurred_at desc);
create index audit_log_booking_idx on public.audit_log (booking_id);

create or replace function private.audit_log_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_log is append-only' using errcode = '42501';
end;
$$;

create trigger audit_log_no_update
  before update or delete on public.audit_log
  for each row execute function private.audit_log_immutable();

-- -----------------------------------------------------------------------------
-- Partner Club Day Pass inquiries (inquiry only — never instant-booked)
-- -----------------------------------------------------------------------------
create table public.day_pass_inquiries (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.parents (id) on delete set null,
  contact_name text not null,
  contact_email text not null,
  contact_phone text,
  adults_count integer not null default 2 check (adults_count between 0 and 20),
  children_count integer not null default 0 check (children_count between 0 and 20),
  preferred_dates date[] not null default '{}',
  interest_level public.interest_level not null default 'interested',
  message text,
  status public.inquiry_status not null default 'new',
  quoted_amount_cents integer check (quoted_amount_cents >= 0),
  stripe_payment_link_url text,
  admin_notes text,
  handled_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index day_pass_inquiries_status_idx on public.day_pass_inquiries (status, created_at desc);

alter table public.payments
  add constraint payments_day_pass_fk
  foreign key (day_pass_inquiry_id) references public.day_pass_inquiries (id) on delete set null;

-- -----------------------------------------------------------------------------
-- Outbound webhooks
-- -----------------------------------------------------------------------------
create table public.webhooks (
  id uuid primary key default gen_random_uuid(),
  url text not null check (url ~ '^https://'),
  description text,
  signing_secret text not null default private.random_token(),
  events text[] not null check (events <@ array['booking.created', 'booking.cancelled', 'lesson.completed']::text[]),
  is_active boolean not null default true,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  webhook_id uuid not null references public.webhooks (id) on delete cascade,
  event text not null,
  event_id uuid not null default gen_random_uuid(),
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed', 'dead')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  response_status integer,
  response_body text,
  created_at timestamptz not null default now()
);

create index webhook_deliveries_pending_idx on public.webhook_deliveries (next_attempt_at) where status = 'pending';

-- -----------------------------------------------------------------------------
-- updated_at triggers
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'platform_settings', 'pricing_config', 'lesson_prices', 'package_offerings', 'zones',
    'users', 'instructors', 'instructor_private', 'instructor_certifications', 'parents',
    'children', 'availability_rules', 'availability_overrides', 'packages', 'booking_series',
    'bookings', 'booking_locations', 'lesson_notes', 'open_shifts', 'discount_codes',
    'payments', 'instructor_earnings', 'day_pass_inquiries', 'webhooks'
  ]
  loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function private.set_updated_at()',
      t || '_set_updated_at', t
    );
  end loop;
end $$;

-- Singletons
insert into public.platform_settings default values on conflict do nothing;
insert into public.pricing_config default values on conflict do nothing;
