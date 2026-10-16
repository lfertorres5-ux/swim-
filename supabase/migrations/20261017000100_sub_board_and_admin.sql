-- =============================================================================
-- Phase 5 · Sub board (instructor hand-offs) + admin settings
--
-- The sub board is enforced here, not in the app:
--   * only the assigned instructor can post their own upcoming, confirmed lesson;
--   * the board row carries zone / neighborhood / time / ages / levels only;
--   * a claimer must be an active instructor who covers the zone, teaches every
--     swimmer's level and age, and is free (travel buffer + no overlap);
--   * when sub_board_requires_approval is on, the claim waits for an admin;
--   * filling the shift moves the booking to the new instructor in the same
--     transaction, so the old instructor loses access at once;
--   * a sub never unlocks family contact details (contact_shared ignores
--     lessons covered from the board).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Settings
-- -----------------------------------------------------------------------------
alter table public.platform_settings
  add column sub_board_min_notice_hours integer not null default 2 check (sub_board_min_notice_hours between 0 and 168),
  add column day_pass_enabled boolean not null default true,
  add column partner_club_name text check (partner_club_name is null or length(partner_club_name) <= 80);

-- One pending invite per email.
drop index if exists public.instructor_invites_email_idx;
create unique index instructor_invites_email_pending_idx on public.instructor_invites (lower(email)) where accepted_at is null;

alter table public.open_shifts
  add column decision_note text check (decision_note is null or length(decision_note) <= 500);

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

-- Can this instructor teach these swimmers in this zone? Mirrors qualifies() in
-- src/lib/scheduling/engine.ts.
create or replace function private.instructor_qualified_for_booking(p_instructor_id uuid, p_booking_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.instructors i
    join public.bookings b on b.id = p_booking_id
    where i.id = p_instructor_id
      and i.is_active
      and exists (select 1 from public.instructor_zones z where z.instructor_id = i.id and z.zone_id = b.zone_id)
      and b.children_count <= i.max_children_per_lesson
      and not exists (
        select 1
        from public.booking_children bc
        join public.children c on c.id = bc.child_id
        where bc.booking_id = b.id
          and (
            not (c.swim_level = any (i.levels_taught))
            or (c.birth_date is not null
                and (extract(year from age(private.la_date(b.starts_at), c.birth_date)) * 12
                     + extract(month from age(private.la_date(b.starts_at), c.birth_date))) < i.min_child_age_months)
          )
      )
  )
$$;

-- First live booking that would collide with (instructor, zone, start, end),
-- honoring travel buffers. Same rule as the bookings_enforce_travel_buffer trigger.
create or replace function private.instructor_schedule_conflict(
  p_instructor_id uuid, p_zone_id uuid, p_starts_at timestamptz, p_ends_at timestamptz, p_exclude_booking uuid
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select b.id
  from public.bookings b
  where b.instructor_id = p_instructor_id
    and b.id is distinct from p_exclude_booking
    and b.status in ('pending_payment', 'pending_instructor', 'confirmed', 'completed')
    and b.starts_at < p_ends_at + make_interval(mins => private.travel_buffer_minutes(p_zone_id, b.zone_id))
    and p_starts_at < b.ends_at + make_interval(mins => private.travel_buffer_minutes(b.zone_id, p_zone_id))
  limit 1
$$;

-- Why this instructor can't take this shift (null = they can).
create or replace function private.open_shift_blocker(p_shift public.open_shifts, p_instructor_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_shift.released_by = p_instructor_id then 'This is your lesson'
    when p_shift.starts_at <= now() then 'This lesson has already started'
    when not private.instructor_qualified_for_booking(p_instructor_id, p_shift.booking_id)
      then 'Outside your zones, swimmer levels or ages'
    when private.instructor_schedule_conflict(p_instructor_id, p_shift.zone_id, p_shift.starts_at, p_shift.ends_at, p_shift.booking_id) is not null
      then 'You have a lesson too close to this one'
    else null
  end
$$;

-- Reassign the booking to the sub. The shift is marked filled first, so the
-- bookings trigger below doesn't treat the reassignment as a cancellation.
create or replace function private.fill_open_shift(p_shift_id uuid, p_instructor_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shift public.open_shifts;
begin
  update public.open_shifts
    set status = 'filled', claimed_by = p_instructor_id, claimed_at = coalesce(claimed_at, now())
    where id = p_shift_id
    returning * into v_shift;

  update public.bookings
    set instructor_id = p_instructor_id
    where id = v_shift.booking_id and status = 'confirmed' and instructor_id = v_shift.released_by;
  if not found then
    raise exception 'this lesson changed and can no longer be covered' using errcode = 'SB002';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Instructor: post my lesson to the board
-- -----------------------------------------------------------------------------
create or replace function public.release_lesson_to_board(p_booking_id uuid, p_reason text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_booking public.bookings;
  v_notice integer;
  v_summary jsonb;
  v_id uuid;
begin
  if not private.is_booking_instructor(p_booking_id) then
    raise exception 'not your lesson' using errcode = '42501';
  end if;
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if v_booking.status <> 'confirmed' then
    raise exception 'only confirmed lessons can be posted (this one is %)', v_booking.status using errcode = 'SB002';
  end if;
  select sub_board_min_notice_hours into v_notice from public.platform_settings;
  if v_booking.starts_at < now() + make_interval(hours => v_notice) then
    raise exception 'This lesson is less than % hours away — please contact the owner directly', v_notice using errcode = 'SB006';
  end if;
  if exists (select 1 from public.open_shifts s where s.booking_id = p_booking_id and s.status in ('open', 'pending_approval')) then
    raise exception 'this lesson is already on the board' using errcode = 'SB003';
  end if;

  -- Ages + levels only. No names, no address.
  select jsonb_build_object(
    'zone', (select z.code from public.zones z where z.id = v_booking.zone_id),
    'duration_minutes', v_booking.duration_minutes,
    'swimmers', coalesce(jsonb_agg(jsonb_build_object(
        'age', case when c.birth_date is null then null else extract(year from age(private.la_date(v_booking.starts_at), c.birth_date))::integer end,
        'swim_level', c.swim_level) order by c.birth_date), '[]'::jsonb))
  into v_summary
  from public.booking_children bc join public.children c on c.id = bc.child_id
  where bc.booking_id = p_booking_id;

  insert into public.open_shifts (booking_id, released_by, reason, status, zone_id, neighborhood, starts_at, ends_at, lesson_summary)
  values (p_booking_id, v_uid, nullif(left(trim(coalesce(p_reason, '')), 300), ''), 'open',
          v_booking.zone_id, v_booking.neighborhood, v_booking.starts_at, v_booking.ends_at, v_summary)
  returning id into v_id;

  perform private.write_audit('instructor.release_to_board', 'open_shift', v_id, p_booking_id, jsonb_build_object('reason', p_reason));
  return v_id;
end;
$$;

-- Instructor: take my lesson back off the board (before anyone has been approved).
create or replace function public.withdraw_open_shift(p_shift_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shift public.open_shifts;
begin
  if not private.is_active_instructor() then
    raise exception 'not an active instructor' using errcode = '42501';
  end if;
  update public.open_shifts set status = 'cancelled'
    where id = p_shift_id and released_by = (select auth.uid()) and status in ('open', 'pending_approval')
    returning * into v_shift;
  if not found then
    raise exception 'nothing to withdraw' using errcode = 'P0002';
  end if;
  perform private.write_audit('instructor.withdraw_from_board', 'open_shift', p_shift_id, v_shift.booking_id, '{}'::jsonb);
end;
$$;

-- -----------------------------------------------------------------------------
-- Instructor: what's on the board for me (with "can I take it?" per row).
-- -----------------------------------------------------------------------------
create or replace function public.sub_board_shifts()
returns table (
  id uuid, zone_code text, neighborhood text, starts_at timestamptz, ends_at timestamptz,
  lesson_summary jsonb, released_by_first_name text, can_claim boolean, blocked_reason text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if not private.is_active_instructor() then
    return;
  end if;
  return query
    select s.id, z.code, s.neighborhood, s.starts_at, s.ends_at, s.lesson_summary, i.first_name,
           private.open_shift_blocker(s, v_uid) is null, private.open_shift_blocker(s, v_uid)
    from public.open_shifts s
    join public.zones z on z.id = s.zone_id
    join public.instructors i on i.id = s.released_by
    where s.status = 'open'
      and s.released_by <> v_uid
      and s.starts_at > now()
      and exists (select 1 from public.instructor_zones iz where iz.instructor_id = v_uid and iz.zone_id = s.zone_id)
    order by s.starts_at;
end;
$$;

-- -----------------------------------------------------------------------------
-- Instructor: claim. Fills immediately, or waits for the owner's approval.
-- -----------------------------------------------------------------------------
create or replace function public.claim_open_shift(p_shift_id uuid)
returns public.open_shift_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_shift public.open_shifts;
  v_blocker text;
  v_needs_approval boolean;
begin
  if not private.is_active_instructor() then
    raise exception 'not an active instructor' using errcode = '42501';
  end if;
  select * into v_shift from public.open_shifts where id = p_shift_id for update;
  if not found or not private.instructor_covers_zone(v_shift.zone_id) then
    raise exception 'shift not found' using errcode = 'P0002';
  end if;
  if v_shift.status <> 'open' then
    raise exception 'Someone already picked this one up' using errcode = 'SB002';
  end if;

  -- Serialize against other bookings for this instructor, then check.
  perform pg_advisory_xact_lock(hashtextextended('instructor-schedule:' || v_uid::text, 0));
  v_blocker := private.open_shift_blocker(v_shift, v_uid);
  if v_blocker is not null then
    raise exception '%', v_blocker using errcode = 'SB001';
  end if;

  select sub_board_requires_approval into v_needs_approval from public.platform_settings;
  if v_needs_approval then
    update public.open_shifts set status = 'pending_approval', claimed_by = v_uid, claimed_at = now() where id = p_shift_id;
  else
    perform private.fill_open_shift(p_shift_id, v_uid);
  end if;

  perform private.write_audit('instructor.claim_shift', 'open_shift', p_shift_id, v_shift.booking_id,
    jsonb_build_object('needs_approval', v_needs_approval));
  return case when v_needs_approval then 'pending_approval'::public.open_shift_status else 'filled'::public.open_shift_status end;
end;
$$;

-- -----------------------------------------------------------------------------
-- Admin: approve or turn down a claim. Turning down puts the lesson back on
-- the board for someone else.
-- -----------------------------------------------------------------------------
create or replace function public.decide_open_shift(p_shift_id uuid, p_approve boolean, p_note text default null)
returns public.open_shift_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shift public.open_shifts;
  v_blocker text;
begin
  if not private.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  select * into v_shift from public.open_shifts where id = p_shift_id for update;
  if not found then
    raise exception 'shift not found' using errcode = 'P0002';
  end if;
  if v_shift.status <> 'pending_approval' then
    raise exception 'this shift is %', v_shift.status using errcode = 'SB002';
  end if;

  update public.open_shifts
    set decided_by = (select auth.uid()), decided_at = now(), decision_note = nullif(left(trim(coalesce(p_note, '')), 500), '')
    where id = p_shift_id;

  if p_approve then
    perform pg_advisory_xact_lock(hashtextextended('instructor-schedule:' || v_shift.claimed_by::text, 0));
    v_blocker := private.open_shift_blocker(v_shift, v_shift.claimed_by);
    if v_blocker is not null then
      raise exception 'Can''t approve: %', lower(v_blocker) using errcode = 'SB001';
    end if;
    perform private.fill_open_shift(p_shift_id, v_shift.claimed_by);
  else
    update public.open_shifts set status = 'open', claimed_by = null, claimed_at = null where id = p_shift_id;
  end if;

  perform private.write_audit(case when p_approve then 'admin.approve_shift' else 'admin.reject_shift' end,
    'open_shift', p_shift_id, v_shift.booking_id, jsonb_build_object('claimed_by', v_shift.claimed_by, 'note', p_note));
  return case when p_approve then 'filled'::public.open_shift_status else 'open'::public.open_shift_status end;
end;
$$;

-- Service: instructors who could take a newly posted shift (for the "up for
-- grabs" message).
create or replace function public.open_shift_candidates(p_shift_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select i.id
  from public.open_shifts s
  join public.instructor_zones iz on iz.zone_id = s.zone_id
  join public.instructors i on i.id = iz.instructor_id
  where s.id = p_shift_id
    and s.status = 'open'
    and i.is_active
    and private.has_accepted_current_terms(i.id)
    and private.open_shift_blocker(s, i.id) is null
$$;

-- Service: shifts whose lesson has started are no longer claimable.
create or replace function public.expire_open_shifts()
returns integer
language sql
security definer
set search_path = ''
as $$
  with expired as (
    update public.open_shifts set status = 'expired'
    where status in ('open', 'pending_approval') and starts_at <= now()
    returning 1
  )
  select count(*)::integer from expired
$$;

revoke all on function public.release_lesson_to_board(uuid, text) from public, anon;
revoke all on function public.withdraw_open_shift(uuid) from public, anon;
revoke all on function public.sub_board_shifts() from public, anon;
revoke all on function public.claim_open_shift(uuid) from public, anon;
revoke all on function public.decide_open_shift(uuid, boolean, text) from public, anon;
revoke all on function public.open_shift_candidates(uuid) from public, anon, authenticated;
revoke all on function public.expire_open_shifts() from public, anon, authenticated;
grant execute on function public.release_lesson_to_board(uuid, text) to authenticated;
grant execute on function public.withdraw_open_shift(uuid) to authenticated;
grant execute on function public.sub_board_shifts() to authenticated;
grant execute on function public.claim_open_shift(uuid) to authenticated;
grant execute on function public.decide_open_shift(uuid, boolean, text) to authenticated;
grant execute on function public.open_shift_candidates(uuid) to service_role;
grant execute on function public.expire_open_shifts() to service_role;

-- -----------------------------------------------------------------------------
-- Any other change to the lesson (cancelled, moved, reassigned by the owner)
-- takes it off the board.
-- -----------------------------------------------------------------------------
create or replace function private.bookings_close_open_shifts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status
     or new.starts_at is distinct from old.starts_at
     or new.ends_at is distinct from old.ends_at
     or new.instructor_id is distinct from old.instructor_id then
    update public.open_shifts set status = 'cancelled'
      where booking_id = new.id and status in ('open', 'pending_approval');
  end if;
  return new;
end;
$$;

create trigger bookings_close_open_shifts
  after update of status, starts_at, ends_at, instructor_id on public.bookings
  for each row execute function private.bookings_close_open_shifts();

-- -----------------------------------------------------------------------------
-- Contact sharing: covering a lesson from the sub board never unlocks the
-- family's phone/email for the sub.
-- -----------------------------------------------------------------------------
create or replace function private.contact_shared(p_parent_id uuid, p_instructor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select s.contact_sharing from public.platform_settings s) = 'package_instructor'
    and exists (
      select 1
      from public.bookings b
      join public.packages p on p.id = b.package_id
      where b.parent_id = p_parent_id
        and b.instructor_id = p_instructor_id
        and b.status in ('confirmed', 'completed')
        and p.status in ('active', 'exhausted')
        and not exists (
          select 1 from public.open_shifts s
          where s.booking_id = b.id and s.status = 'filled' and s.claimed_by = p_instructor_id
        )
    )
$$;

-- Internal helpers: callable only from the SECURITY DEFINER functions above.
revoke all on function private.instructor_qualified_for_booking(uuid, uuid) from public, anon, authenticated;
revoke all on function private.instructor_schedule_conflict(uuid, uuid, timestamptz, timestamptz, uuid) from public, anon, authenticated;
revoke all on function private.open_shift_blocker(public.open_shifts, uuid) from public, anon, authenticated;
revoke all on function private.fill_open_shift(uuid, uuid) from public, anon, authenticated;
revoke all on function private.bookings_close_open_shifts() from public, anon, authenticated;
revoke all on function private.contact_shared(uuid, uuid) from public, anon, authenticated;
