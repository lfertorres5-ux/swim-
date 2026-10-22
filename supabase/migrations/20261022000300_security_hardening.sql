-- =============================================================================
-- Security hardening (code review, 2026-10-22)
--
-- 1. Promo codes: one use is claimed atomically inside create_booking_hold
--    (previously only after payment, and never for $0 checkouts), and handed
--    back when an unpaid hold lapses. Unknown/exhausted codes fail the hold.
-- 2. Refund bookkeeping: refunded_cents is incremented in SQL, never
--    read-modify-written by the app (record_refund).
-- 3. Client insulation: direct inserts into messages are closed until the
--    contact-info filter exists (chat isn't offered), instructor bios and
--    first names can't carry phone numbers / emails / handles, and instructors
--    see only live bookings (no parent-written cancellation reasons).
-- =============================================================================

alter table public.payments add column discount_code_id uuid references public.discount_codes (id) on delete set null;

-- Codes are matched exactly (no pattern matching), stored uppercase.
update public.discount_codes set code = upper(trim(code)) where code <> upper(trim(code));
alter table public.discount_codes add constraint discount_codes_code_format check (code ~ '^[A-Z0-9_-]{3,30}$');

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

  -- Claim one use of the promo code in the same transaction as the hold, so
  -- parallel checkouts can't exceed max_redemptions and $0 checkouts count too.
  -- Released again if the checkout lapses unpaid (release_booking_hold).
  if p ->> 'discount_code_id' is not null and not public.redeem_discount_code((p ->> 'discount_code_id')::uuid) then
    raise exception 'That code is no longer available.' using errcode = 'SB007';
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
    insert into public.payments (parent_id, package_id, series_id, amount_cents, currency, kind, description, status, discount_code_id)
    values (v_parent, v_package_id, v_series_id, v_amount, coalesce(p ->> 'currency', 'usd'),
            case v_kind when 'package' then 'package' when 'recurring' then 'series' else 'booking' end,
            left(p ->> 'description', 500), 'pending', (p ->> 'discount_code_id')::uuid)
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

  -- Hand back the promo use claimed when the hold was created.
  if v_payment.discount_code_id is not null then
    update public.discount_codes set redemptions = greatest(redemptions - 1, 0) where id = v_payment.discount_code_id;
  end if;

  update public.packages set status = 'expired' where id = v_payment.package_id and status = 'pending_payment';
  update public.booking_series set status = 'cancelled' where id = v_payment.series_id and status = 'pending_payment';
  return v_count;
end;
$$;

revoke all on function public.create_booking_hold(jsonb) from public, anon, authenticated;
revoke all on function public.release_booking_hold(uuid) from public, anon, authenticated;
grant execute on function public.create_booking_hold(jsonb) to service_role;
grant execute on function public.release_booking_hold(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 2. Atomic refund bookkeeping. Returns the new refunded total; refuses to
--    exceed the payment amount.
-- -----------------------------------------------------------------------------
create or replace function public.record_refund(p_payment_id uuid, p_amount_cents integer, p_refund_id text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total integer;
begin
  if p_amount_cents <= 0 then
    raise exception 'refund must be positive' using errcode = '22023';
  end if;
  update public.payments
    set refunded_cents = refunded_cents + p_amount_cents,
        status = case when refunded_cents + p_amount_cents >= amount_cents then 'refunded'::public.payment_status else 'partially_refunded'::public.payment_status end,
        stripe_refund_ids = case when p_refund_id = any (stripe_refund_ids) then stripe_refund_ids else stripe_refund_ids || p_refund_id end
    where id = p_payment_id
      and refunded_cents + p_amount_cents <= amount_cents
      and not (p_refund_id = any (stripe_refund_ids))
    returning refunded_cents into v_total;
  if not found then
    -- Already recorded (same refund id) or would exceed the amount.
    select refunded_cents into v_total from public.payments where id = p_payment_id;
  end if;
  return v_total;
end;
$$;
revoke all on function public.record_refund(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.record_refund(uuid, integer, text) to service_role;

-- -----------------------------------------------------------------------------
-- 3a. Messages: chat isn't part of the product; close direct inserts so the
--     table can't become an unfiltered contact-exchange channel.
-- -----------------------------------------------------------------------------
revoke insert on public.messages from authenticated, anon;

-- 3b. Instructor bio / first name: no phone numbers, emails, URLs or handles.
create or replace function private.has_contact_info(p_text text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_text is not null and (
    p_text ~* '[a-z0-9._%+-]+\s*(@|\(at\)|\[at\]| at )\s*[a-z0-9-]+\s*(\.|\(dot\)| dot )\s*[a-z]{2,}'
    or p_text ~ '(\+?1[\s.-]?)?\(?[0-9]{3}\)?[\s.-]?[0-9]{3}[\s.-]?[0-9]{4}'
    or p_text ~* '(https?://|www\.|\.(com|net|org|io|me|co)\y)'
    or p_text ~* '(^|\s)@[a-z0-9_.]{2,}'
    or p_text ~* '\m(venmo|zelle|cash ?app|paypal|instagram|insta|ig|snapchat|whatsapp|telegram|tiktok)\M'
  )
$$;
revoke all on function private.has_contact_info(text) from public, anon;
-- The check constraints run as the instructor saving their profile.
grant execute on function private.has_contact_info(text) to authenticated, service_role;

alter table public.instructors
  add constraint instructors_bio_no_contact_info check (not private.has_contact_info(bio)) not valid,
  add constraint instructors_first_name_no_contact_info check (not private.has_contact_info(first_name)) not valid;

-- 3c. Instructors read only live bookings through RLS (cancelled/expired rows can
--     carry a parent-written cancellation reason).
drop policy if exists bookings_select_instructor on public.bookings;
create policy bookings_select_instructor on public.bookings for select to authenticated
  using (
    instructor_id = (select auth.uid())
    and status in ('pending_instructor', 'confirmed', 'completed', 'no_show')
    and (select private.is_active_instructor())
  );

-- 4. Day pass: rate-limit per network as well as per email. Stores a salted
--    one-way hash of the IP, never the IP itself.
alter table public.day_pass_inquiries add column if not exists client_key text;
create index if not exists day_pass_inquiries_client_key_idx on public.day_pass_inquiries (client_key, created_at) where client_key is not null;
create index if not exists day_pass_inquiries_email_idx on public.day_pass_inquiries (contact_email, created_at);
