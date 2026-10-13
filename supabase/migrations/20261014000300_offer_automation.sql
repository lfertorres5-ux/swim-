-- =============================================================================
-- Phase 2c · Booking request automation (service role only)
--
-- The app's offer loop (src/lib/scheduling/offers.ts) ranks instructors with
-- the scheduling engine, then calls assign_booking_offer() for the best one.
-- Assignment + offer creation is atomic, and the travel-buffer trigger and
-- exclusion constraint still guard the assignment, so a race simply raises
-- and the loop moves on to the next candidate.
-- =============================================================================

create or replace function public.assign_booking_offer(
  p_booking_id uuid,
  p_instructor_id uuid,
  p_expires_at timestamptz,
  p_lesson_summary jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rank integer;
  v_offer_id uuid;
begin
  update public.bookings
    set instructor_id = p_instructor_id
    where id = p_booking_id and status = 'pending_instructor' and instructor_id is null;
  if not found then
    raise exception 'booking % is not awaiting an instructor', p_booking_id using errcode = 'SB002';
  end if;

  if exists (select 1 from public.booking_offers o where o.booking_id = p_booking_id and o.instructor_id = p_instructor_id) then
    raise exception 'instructor was already offered this booking' using errcode = 'SB003';
  end if;

  select coalesce(max(o.rank), 0) + 1 into v_rank from public.booking_offers o where o.booking_id = p_booking_id;

  insert into public.booking_offers (booking_id, instructor_id, rank, status, lesson_summary, expires_at)
  values (p_booking_id, p_instructor_id, v_rank, 'pending', coalesce(p_lesson_summary, '{}'::jsonb), p_expires_at)
  returning id into v_offer_id;

  return v_offer_id;
end;
$$;

-- Pending offers past their deadline → expired; their bookings are released.
-- Returns the released booking ids so the app can offer them onward.
create or replace function public.expire_stale_offers()
returns setof uuid
language sql
security definer
set search_path = ''
as $$
  with expired as (
    update public.booking_offers
      set status = 'expired', responded_at = now()
      where status = 'pending' and expires_at <= now()
      returning booking_id, instructor_id
  ), released as (
    update public.bookings b
      set instructor_id = null
      from expired e
      where b.id = e.booking_id and b.instructor_id = e.instructor_id and b.status = 'pending_instructor'
      returning b.id
  )
  select id from released
$$;

-- Bookings whose Stripe Checkout hold lapsed free their slot.
create or replace function public.expire_payment_holds()
returns setof uuid
language sql
security definer
set search_path = ''
as $$
  update public.bookings
    set status = 'expired'
    where status = 'pending_payment' and hold_expires_at is not null and hold_expires_at <= now()
    returning id
$$;

-- Bookings stuck awaiting an instructor with nobody currently offered
-- (e.g. a crash between decline and re-offer). The cron re-runs these.
create or replace function public.bookings_awaiting_offer()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select b.id from public.bookings b
  where b.status = 'pending_instructor' and b.instructor_id is null and not b.needs_attention
$$;

revoke all on function public.assign_booking_offer(uuid, uuid, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function public.expire_stale_offers() from public, anon, authenticated;
revoke all on function public.expire_payment_holds() from public, anon, authenticated;
revoke all on function public.bookings_awaiting_offer() from public, anon, authenticated;
grant execute on function public.assign_booking_offer(uuid, uuid, timestamptz, jsonb) to service_role;
grant execute on function public.expire_stale_offers() to service_role;
grant execute on function public.expire_payment_holds() to service_role;
grant execute on function public.bookings_awaiting_offer() to service_role;
