-- =============================================================================
-- Phase 3 · Booking + payments
--
-- Payment flow: the server creates bookings in `pending_payment` (instructor
-- assigned, slot held until hold_expires_at) plus a pending `payments` row,
-- then sends the parent to Stripe Checkout. The Stripe webhook calls
-- fulfillment, which flips bookings to `pending_instructor` and opens the
-- instructor's accept/decline request via start_booking_request().
-- =============================================================================

-- Stripe Checkout sessions last at least 30 minutes; the hold must outlive them.
alter table public.platform_settings alter column payment_hold_minutes set default 35;
update public.platform_settings set payment_hold_minutes = 35 where payment_hold_minutes < 35;
alter table public.platform_settings
  add constraint platform_settings_hold_covers_checkout check (payment_hold_minutes >= 31),
  add column recurring_term_weeks integer[] not null default '{4,8}'
    check (array_length(recurring_term_weeks, 1) >= 1 and 1 < all (recurring_term_weeks) and 27 > all (recurring_term_weeks));

alter table public.payments
  add column kind text not null default 'booking' check (kind in ('booking', 'package', 'series', 'day_pass')),
  add column stripe_refund_ids text[] not null default '{}';

alter table public.bookings
  -- The payment that paid for this lesson (single or series). Package lessons
  -- have package_id instead.
  add column payment_id uuid references public.payments (id) on delete set null;

create index bookings_payment_idx on public.bookings (payment_id);

-- Idempotency for Stripe webhooks (Stripe retries and may deliver twice).
create table public.stripe_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
alter table public.stripe_events enable row level security;
grant select on public.stripe_events to authenticated;
create policy stripe_events_admin_select on public.stripe_events for select to authenticated
  using ((select private.is_admin()));

-- Parents read their packages/series to show credits and terms (policies exist).
-- Parents may read receipts for their own payments (policy exists).

-- -----------------------------------------------------------------------------
-- Paid → open the instructor request (atomic).
-- -----------------------------------------------------------------------------
create or replace function public.start_booking_request(p_booking_id uuid, p_expires_at timestamptz, p_lesson_summary jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings;
  v_offer_id uuid;
begin
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'booking not found' using errcode = 'P0002';
  end if;
  if v_booking.status <> 'pending_payment' then
    raise exception 'booking % is %, not pending_payment', p_booking_id, v_booking.status using errcode = 'SB002';
  end if;

  update public.bookings
    set status = 'pending_instructor', hold_expires_at = null
    where id = p_booking_id;

  if v_booking.instructor_id is null then
    return null;  -- the offer loop will assign someone
  end if;

  insert into public.booking_offers (booking_id, instructor_id, rank, status, lesson_summary, expires_at)
  values (p_booking_id, v_booking.instructor_id, 1, 'pending', coalesce(p_lesson_summary, '{}'::jsonb), p_expires_at)
  on conflict (booking_id, instructor_id) do nothing
  returning id into v_offer_id;
  return v_offer_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Package credits (atomic; never below zero; respects expiry).
-- -----------------------------------------------------------------------------
create or replace function public.consume_package_credit(p_package_id uuid, p_parent_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_remaining integer;
begin
  update public.packages
    set lessons_remaining = lessons_remaining - 1,
        status = case when lessons_remaining - 1 = 0 then 'exhausted'::public.package_status else status end
    where id = p_package_id and parent_id = p_parent_id and status = 'active'
      and lessons_remaining > 0 and (expires_at is null or expires_at > now())
    returning lessons_remaining into v_remaining;
  if not found then
    raise exception 'no usable credit on package %', p_package_id using errcode = 'SB004';
  end if;
  return v_remaining;
end;
$$;

create or replace function public.restore_package_credit(p_package_id uuid)
returns integer
language sql
security definer
set search_path = ''
as $$
  update public.packages
    set lessons_remaining = least(lesson_count, lessons_remaining + 1),
        status = case when status = 'exhausted' then 'active'::public.package_status else status end
    where id = p_package_id and status in ('active', 'exhausted')
    returning lessons_remaining
$$;

-- -----------------------------------------------------------------------------
-- Promo codes: atomic redemption that honors max_redemptions.
-- -----------------------------------------------------------------------------
create or replace function public.redeem_discount_code(p_code_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with r as (
    update public.discount_codes
      set redemptions = redemptions + 1
      where id = p_code_id and is_active
        and (max_redemptions is null or redemptions < max_redemptions)
      returning 1
  )
  select exists (select 1 from r)
$$;

revoke all on function public.start_booking_request(uuid, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function public.consume_package_credit(uuid, uuid) from public, anon, authenticated;
revoke all on function public.restore_package_credit(uuid) from public, anon, authenticated;
revoke all on function public.redeem_discount_code(uuid) from public, anon, authenticated;
grant execute on function public.start_booking_request(uuid, timestamptz, jsonb) to service_role;
grant execute on function public.consume_package_credit(uuid, uuid) to service_role;
grant execute on function public.restore_package_credit(uuid) to service_role;
grant execute on function public.redeem_discount_code(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- One transaction for an entire checkout: package/series row, payment row,
-- every lesson (+ swimmers, address, per-lesson pricing). The exclusion
-- constraint and travel-buffer trigger guard each lesson, so if any slot was
-- taken in the meantime nothing is written at all.
--
-- p = {
--   parent_id, kind: single|package|recurring|package_credit,
--   instructor_id, requested_instructor_id, zone_id, neighborhood,
--   child_ids: [uuid], location: {address_line1, address_line2, city, postal_code, lat, lng, google_place_id, access_notes},
--   occurrences: [{starts_at, ends_at, is_neighborhood_slot, pricing: {base_cents, ...booking_pricing columns, total_cents}}],
--   amount_cents, currency, description, discount_code_id, pricing_snapshot,
--   package: {offering_id, lesson_count, duration_minutes, unit_price_cents, discount_pct, total_cents},   (kind=package)
--   series: {weekday, start_time, duration_minutes, starts_on, ends_on, discount_pct},                    (kind=recurring)
--   package_id                                                                                             (kind=package_credit)
-- }
-- -----------------------------------------------------------------------------
create or replace function public.create_booking_hold(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent uuid := (p ->> 'parent_id')::uuid;
  v_kind text := p ->> 'kind';
  v_amount integer := coalesce((p ->> 'amount_cents')::integer, 0);
  v_children integer := jsonb_array_length(p -> 'child_ids');
  v_hold timestamptz;
  v_payment_id uuid;
  v_package_id uuid;
  v_series_id uuid;
  v_booking_id uuid;
  v_ids uuid[] := '{}';
  v_occ jsonb;
  v_loc jsonb := p -> 'location';
begin
  if v_kind not in ('single', 'package', 'recurring', 'package_credit') then
    raise exception 'invalid kind %', v_kind using errcode = '22023';
  end if;
  if v_children < 1 or exists (
    select 1 from jsonb_array_elements_text(p -> 'child_ids') c
    where not exists (select 1 from public.children ch where ch.id = c::uuid and ch.parent_id = v_parent and ch.is_active)
  ) then
    raise exception 'swimmers must belong to this family' using errcode = '22023';
  end if;

  select now() + make_interval(mins => s.payment_hold_minutes) into v_hold from public.platform_settings s;

  if v_kind = 'package' then
    insert into public.packages (parent_id, offering_id, lesson_count, lessons_remaining, duration_minutes, children_count, zone_id,
                                 unit_price_cents, discount_pct, total_cents, status)
    values (v_parent, (p #>> '{package,offering_id}')::uuid, (p #>> '{package,lesson_count}')::integer,
            (p #>> '{package,lesson_count}')::integer - 1,  -- the first lesson is booked now
            (p #>> '{package,duration_minutes}')::integer, v_children, (p ->> 'zone_id')::uuid,
            (p #>> '{package,unit_price_cents}')::integer, (p #>> '{package,discount_pct}')::numeric,
            (p #>> '{package,total_cents}')::integer, 'pending_payment')
    returning id into v_package_id;
  elsif v_kind = 'recurring' then
    insert into public.booking_series (parent_id, instructor_id, zone_id, weekday, start_time, duration_minutes, children_count,
                                       starts_on, ends_on, discount_pct, status)
    values (v_parent, (p ->> 'instructor_id')::uuid, (p ->> 'zone_id')::uuid, (p #>> '{series,weekday}')::smallint,
            (p #>> '{series,start_time}')::time, (p #>> '{series,duration_minutes}')::integer, v_children,
            (p #>> '{series,starts_on}')::date, (p #>> '{series,ends_on}')::date, (p #>> '{series,discount_pct}')::numeric,
            case when v_amount > 0 then 'pending_payment'::public.series_status else 'active'::public.series_status end)
    returning id into v_series_id;
  elsif v_kind = 'package_credit' then
    v_package_id := (p ->> 'package_id')::uuid;
    perform public.consume_package_credit(v_package_id, v_parent);
  end if;

  if v_amount > 0 then
    insert into public.payments (parent_id, package_id, series_id, amount_cents, currency, kind, description, status)
    values (v_parent, v_package_id, v_series_id, v_amount, coalesce(p ->> 'currency', 'usd'),
            case v_kind when 'package' then 'package' when 'recurring' then 'series' else 'booking' end,
            left(p ->> 'description', 500), 'pending')
    returning id into v_payment_id;
  end if;

  for v_occ in select value from jsonb_array_elements(p -> 'occurrences') loop
    insert into public.bookings (parent_id, instructor_id, requested_instructor_id, zone_id, neighborhood, starts_at, ends_at,
                                 status, kind, series_id, package_id, children_count, is_neighborhood_slot, hold_expires_at,
                                 source, created_by, payment_id)
    values (v_parent, (p ->> 'instructor_id')::uuid, (p ->> 'requested_instructor_id')::uuid, (p ->> 'zone_id')::uuid,
            p ->> 'neighborhood', (v_occ ->> 'starts_at')::timestamptz, (v_occ ->> 'ends_at')::timestamptz,
            'pending_payment',
            case v_kind when 'recurring' then 'recurring'::public.booking_kind
                        when 'single' then 'single'::public.booking_kind
                        else 'package'::public.booking_kind end,
            v_series_id, v_package_id, v_children, coalesce((v_occ ->> 'is_neighborhood_slot')::boolean, false),
            case when v_amount > 0 then v_hold end, 'web', v_parent,
            case when v_kind in ('single', 'recurring') then v_payment_id end)
    returning id into v_booking_id;

    insert into public.booking_children (booking_id, child_id)
    select v_booking_id, c::uuid from jsonb_array_elements_text(p -> 'child_ids') c;

    insert into public.booking_locations (booking_id, address_line1, address_line2, city, postal_code, lat, lng, google_place_id, access_notes)
    values (v_booking_id, v_loc ->> 'address_line1', nullif(v_loc ->> 'address_line2', ''), v_loc ->> 'city', v_loc ->> 'postal_code',
            (v_loc ->> 'lat')::double precision, (v_loc ->> 'lng')::double precision, v_loc ->> 'google_place_id',
            nullif(v_loc ->> 'access_notes', ''));

    insert into public.booking_pricing (booking_id, currency, base_cents, extra_children_cents, travel_fee_cents,
                                        neighborhood_discount_cents, package_discount_cents, series_discount_cents,
                                        promo_discount_cents, discount_code_id, total_cents, snapshot)
    values (v_booking_id, coalesce(p ->> 'currency', 'usd'),
            coalesce((v_occ #>> '{pricing,base_cents}')::integer, 0),
            coalesce((v_occ #>> '{pricing,extra_children_cents}')::integer, 0),
            coalesce((v_occ #>> '{pricing,travel_fee_cents}')::integer, 0),
            coalesce((v_occ #>> '{pricing,neighborhood_discount_cents}')::integer, 0),
            coalesce((v_occ #>> '{pricing,package_discount_cents}')::integer, 0),
            coalesce((v_occ #>> '{pricing,series_discount_cents}')::integer, 0),
            coalesce((v_occ #>> '{pricing,promo_discount_cents}')::integer, 0),
            (p ->> 'discount_code_id')::uuid,
            (v_occ #>> '{pricing,total_cents}')::integer,
            coalesce(p -> 'pricing_snapshot', '{}'::jsonb));

    v_ids := v_ids || v_booking_id;
  end loop;

  if v_payment_id is not null and v_kind = 'single' then
    update public.payments set booking_id = v_ids[1] where id = v_payment_id;
  end if;

  return jsonb_build_object('payment_id', v_payment_id, 'booking_ids', to_jsonb(v_ids), 'package_id', v_package_id, 'series_id', v_series_id);
end;
$$;

-- Abandoned / expired checkout: free the slots and void the pending rows.
create or replace function public.release_booking_hold(p_payment_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.payments;
  v_count integer;
begin
  update public.payments set status = 'cancelled'
    where id = p_payment_id and status = 'pending'
    returning * into v_payment;
  if not found then
    return 0;
  end if;

  update public.bookings set status = 'expired', hold_expires_at = null
    where status = 'pending_payment'
      and (payment_id = p_payment_id or (v_payment.package_id is not null and package_id = v_payment.package_id));
  get diagnostics v_count = row_count;

  update public.packages set status = 'expired' where id = v_payment.package_id and status = 'pending_payment';
  update public.booking_series set status = 'cancelled' where id = v_payment.series_id and status = 'pending_payment';
  return v_count;
end;
$$;

revoke all on function public.create_booking_hold(jsonb) from public, anon, authenticated;
revoke all on function public.release_booking_hold(uuid) from public, anon, authenticated;
grant execute on function public.create_booking_hold(jsonb) to service_role;
grant execute on function public.release_booking_hold(uuid) to service_role;

-- Holds whose payment lapsed (cron) — also void their payment rows.
create or replace function public.expire_payment_holds()
returns setof uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment uuid;
begin
  for v_payment in
    select distinct b.payment_id from public.bookings b
    where b.status = 'pending_payment' and b.hold_expires_at is not null and b.hold_expires_at <= now() and b.payment_id is not null
    union
    select distinct p.id from public.payments p
    join public.bookings b on b.package_id = p.package_id
    where p.status = 'pending' and b.status = 'pending_payment' and b.hold_expires_at is not null and b.hold_expires_at <= now()
  loop
    perform public.release_booking_hold(v_payment);
  end loop;

  return query
    update public.bookings set status = 'expired'
    where status = 'pending_payment' and hold_expires_at is not null and hold_expires_at <= now()
    returning id;
end;
$$;
revoke all on function public.expire_payment_holds() from public, anon, authenticated;
grant execute on function public.expire_payment_holds() to service_role;
