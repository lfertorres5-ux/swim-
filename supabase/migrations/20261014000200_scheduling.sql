-- =============================================================================
-- Phase 2b · Scheduling: settings, travel-buffer enforcement, booking offers
-- =============================================================================

alter table public.platform_settings
  add column slot_step_minutes integer not null default 30 check (slot_step_minutes in (15, 30, 60)),
  add column min_booking_notice_hours integer not null default 24 check (min_booking_notice_hours >= 0),
  add column max_booking_horizon_days integer not null default 60 check (max_booking_horizon_days between 1 and 365),
  add column offer_min_lead_minutes integer not null default 120 check (offer_min_lead_minutes >= 0);

alter table public.bookings
  -- Admin-only escape hatch for manual bookings that knowingly skip the buffer.
  add column buffer_override boolean not null default false,
  -- Set when no instructor accepted / no match left; surfaced on the admin dashboard.
  add column needs_attention boolean not null default false,
  add column attention_reason text;

create index bookings_needs_attention_idx on public.bookings (needs_attention) where needs_attention;

-- -----------------------------------------------------------------------------
-- Travel buffer between two zones (minutes), falling back to the default.
-- -----------------------------------------------------------------------------
create or replace function private.travel_buffer_minutes(p_from_zone uuid, p_to_zone uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select b.buffer_minutes from public.zone_travel_buffers b
      where b.from_zone_id = p_from_zone and b.to_zone_id = p_to_zone),
    (select s.default_travel_buffer_minutes from public.platform_settings s),
    30
  )
$$;

-- -----------------------------------------------------------------------------
-- DB-level guarantee: an instructor always has the travel buffer between two
-- live lessons. The exclusion constraint already blocks overlaps; this trigger
-- extends it with the zone-pair buffer. A per-instructor advisory lock
-- serializes concurrent bookings so two checkouts can't both squeeze in.
-- -----------------------------------------------------------------------------
create or replace function private.bookings_enforce_travel_buffer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conflict uuid;
  v_live public.booking_status[] := array['pending_payment', 'pending_instructor', 'confirmed', 'completed']::public.booking_status[];
begin
  if new.instructor_id is null or not (new.status = any (v_live)) or new.buffer_override then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.instructor_id is not distinct from old.instructor_id
     and new.starts_at = old.starts_at and new.ends_at = old.ends_at
     and new.zone_id = old.zone_id
     and old.status = any (v_live) then
    return new;  -- nothing schedule-relevant changed
  end if;

  perform pg_advisory_xact_lock(hashtextextended('instructor-schedule:' || new.instructor_id::text, 0));

  select b.id into v_conflict
  from public.bookings b
  where b.instructor_id = new.instructor_id
    and b.id <> new.id
    and b.status = any (v_live)
    and b.starts_at < new.ends_at + make_interval(mins => private.travel_buffer_minutes(new.zone_id, b.zone_id))
    and new.starts_at < b.ends_at + make_interval(mins => private.travel_buffer_minutes(b.zone_id, new.zone_id))
  limit 1;

  if v_conflict is not null then
    raise exception 'travel buffer conflict with booking %', v_conflict
      using errcode = 'SB001', hint = 'Choose another time or instructor.';
  end if;

  return new;
end;
$$;

create trigger bookings_enforce_travel_buffer
  before insert or update of instructor_id, starts_at, ends_at, zone_id, status, buffer_override on public.bookings
  for each row execute function private.bookings_enforce_travel_buffer();

-- -----------------------------------------------------------------------------
-- RPC: instructor accepts or declines a booking request.
-- Accept → booking confirmed. Decline / expired → booking released
-- (instructor_id = null); the app then auto-offers the next ranked match
-- (src/lib/scheduling/offers.ts).
-- -----------------------------------------------------------------------------
create or replace function public.respond_to_booking_offer(p_offer_id uuid, p_accept boolean, p_reason text default null)
returns public.offer_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_offer public.booking_offers;
begin
  if not private.is_active_instructor() then
    raise exception 'not an active instructor' using errcode = '42501';
  end if;

  select * into v_offer from public.booking_offers o
  where o.id = p_offer_id and o.instructor_id = v_uid
  for update;
  if not found then
    raise exception 'offer not found' using errcode = 'P0002';
  end if;
  if v_offer.status <> 'pending' then
    raise exception 'offer is no longer pending (%)', v_offer.status using errcode = 'SB002';
  end if;

  if v_offer.expires_at <= now() then
    update public.booking_offers set status = 'expired', responded_at = now() where id = v_offer.id;
    update public.bookings set instructor_id = null
      where id = v_offer.booking_id and instructor_id = v_uid and status = 'pending_instructor';
    return 'expired';
  end if;

  if p_accept then
    update public.bookings
      set status = 'confirmed', confirmed_at = now(), needs_attention = false, attention_reason = null
      where id = v_offer.booking_id and instructor_id = v_uid and status = 'pending_instructor';
    if not found then
      raise exception 'booking is no longer awaiting this instructor' using errcode = 'SB002';
    end if;
    update public.booking_offers set status = 'accepted', responded_at = now() where id = v_offer.id;
    perform private.write_audit('instructor.accept_offer', 'booking', v_offer.booking_id, v_offer.booking_id, '{}'::jsonb);
    return 'accepted';
  end if;

  update public.booking_offers
    set status = 'declined', responded_at = now(), decline_reason = left(p_reason, 500)
    where id = v_offer.id;
  update public.bookings set instructor_id = null
    where id = v_offer.booking_id and instructor_id = v_uid and status = 'pending_instructor';
  perform private.write_audit('instructor.decline_offer', 'booking', v_offer.booking_id, v_offer.booking_id,
    jsonb_build_object('reason', left(p_reason, 500)));
  return 'declined';
end;
$$;

revoke all on function public.respond_to_booking_offer(uuid, boolean, text) from public, anon;
grant execute on function public.respond_to_booking_offer(uuid, boolean, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Scheduling snapshot for the engine (service role only).
-- One round-trip with everything findSlots() needs for a date range. Contains
-- no parent/child PII — just instructor capabilities, availability and
-- occupied (instructor, zone, time) blocks.
-- -----------------------------------------------------------------------------
create or replace function public.scheduling_snapshot(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from_ts timestamptz;
  v_to_ts timestamptz;
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 92 then
    raise exception 'invalid range (max 92 days)' using errcode = '22023';
  end if;
  v_from_ts := (p_from - 1)::timestamp at time zone 'America/Los_Angeles';
  v_to_ts := (p_to + 2)::timestamp at time zone 'America/Los_Angeles';

  return jsonb_build_object(
    'settings', (
      select jsonb_build_object(
        'slotStepMinutes', s.slot_step_minutes,
        'minNoticeHours', s.min_booking_notice_hours,
        'maxHorizonDays', s.max_booking_horizon_days,
        'defaultBufferMinutes', s.default_travel_buffer_minutes,
        'bookingRequestWindowHours', s.booking_request_window_hours,
        'offerMinLeadMinutes', s.offer_min_lead_minutes,
        'paymentHoldMinutes', s.payment_hold_minutes,
        'maxChildrenPerLesson', s.max_children_per_lesson,
        'minLessonMinutes', coalesce((select min(lp.duration_minutes) from public.lesson_prices lp where lp.is_active), 30)
      ) from public.platform_settings s
    ),
    'pricing', (
      select jsonb_build_object('neighborhoodWindowMinutes', p.neighborhood_window_minutes)
      from public.pricing_config p
    ),
    'zones', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', z.id, 'code', z.code, 'name', z.name,
        'minBookingMinutes', z.min_booking_minutes, 'isBookable', z.is_bookable
      ) order by z.sort_order), '[]'::jsonb)
      from public.zones z
    ),
    'buffers', (
      select coalesce(jsonb_agg(jsonb_build_object('from', b.from_zone_id, 'to', b.to_zone_id, 'minutes', b.buffer_minutes)), '[]'::jsonb)
      from public.zone_travel_buffers b
    ),
    'instructors', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', i.id,
        'firstName', i.first_name,
        'photoPath', i.photo_path,
        'specialties', to_jsonb(i.specialties),
        'levelsTaught', to_jsonb(i.levels_taught),
        'minChildAgeMonths', i.min_child_age_months,
        'maxChildrenPerLesson', i.max_children_per_lesson,
        'isAcceptingNewClients', i.is_accepting_new_clients,
        'sortOrder', i.sort_order,
        'zoneIds', (select coalesce(jsonb_agg(iz.zone_id), '[]'::jsonb) from public.instructor_zones iz where iz.instructor_id = i.id)
      ) order by i.sort_order, i.id), '[]'::jsonb)
      from public.instructors i
      where i.is_active and private.has_accepted_current_terms(i.id)
    ),
    'rules', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'instructorId', r.instructor_id, 'weekday', r.weekday,
        'startTime', to_char(r.start_time, 'HH24:MI'), 'endTime', to_char(r.end_time, 'HH24:MI'),
        'effectiveFrom', r.effective_from, 'effectiveUntil', r.effective_until
      )), '[]'::jsonb)
      from public.availability_rules r
      where r.effective_from <= p_to and (r.effective_until is null or r.effective_until >= p_from)
    ),
    'overrides', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'instructorId', o.instructor_id, 'date', o.date, 'kind', o.kind,
        'startTime', to_char(o.start_time, 'HH24:MI'), 'endTime', to_char(o.end_time, 'HH24:MI')
      )), '[]'::jsonb)
      from public.availability_overrides o
      where o.date between p_from and p_to
    ),
    'bookings', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', b.id, 'instructorId', b.instructor_id, 'zoneId', b.zone_id,
        'start', b.starts_at, 'end', b.ends_at
      )), '[]'::jsonb)
      from public.bookings b
      where b.instructor_id is not null
        and b.status in ('pending_payment', 'pending_instructor', 'confirmed', 'completed')
        and b.starts_at < v_to_ts and b.ends_at > v_from_ts
    )
  );
end;
$$;

revoke all on function public.scheduling_snapshot(date, date) from public, anon, authenticated;
grant execute on function public.scheduling_snapshot(date, date) to service_role;

revoke all on function private.bookings_enforce_travel_buffer() from public, anon, authenticated;
