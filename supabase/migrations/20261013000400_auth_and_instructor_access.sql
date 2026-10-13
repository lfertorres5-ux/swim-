-- =============================================================================
-- Phase 1 · Auth hooks, terms acceptance, and the audited instructor read path
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Request context helpers (PostgREST exposes request headers as a GUC)
-- -----------------------------------------------------------------------------
create or replace function private.request_header(p_name text)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_raw text := current_setting('request.headers', true);
begin
  if v_raw is null or v_raw = '' then
    return null;
  end if;
  return (v_raw::json ->> lower(p_name));
exception when others then
  return null;
end;
$$;

create or replace function private.write_audit(
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_booking_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_log (actor_id, actor_role, action, entity_type, entity_id, booking_id, metadata, ip_address, user_agent)
  values (
    (select auth.uid()),
    private.caller_role(),
    p_action,
    p_entity_type,
    p_entity_id,
    p_booking_id,
    coalesce(p_metadata, '{}'::jsonb),
    split_part(coalesce(private.request_header('x-forwarded-for'), ''), ',', 1),
    left(private.request_header('user-agent'), 400)
  )
$$;

-- -----------------------------------------------------------------------------
-- New auth user → public.users (+ parents | instructors)
--
-- Role resolution (raw_user_meta_data is user-controlled and is NEVER trusted
-- for roles):
--   1. a pending, unexpired instructor_invites row for the email → instructor
--   2. raw_app_meta_data.role (only settable with the service role) → as given
--   3. otherwise → parent
-- -----------------------------------------------------------------------------
create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.user_role := 'parent';
  v_invite public.instructor_invites;
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_full_name text := nullif(trim(coalesce(v_meta ->> 'full_name', v_meta ->> 'name', '')), '');
  v_first text := nullif(trim(coalesce(v_meta ->> 'first_name', v_meta ->> 'given_name', '')), '');
  v_last text := nullif(trim(coalesce(v_meta ->> 'last_name', v_meta ->> 'family_name', '')), '');
  v_default_rate integer;
begin
  select * into v_invite
  from public.instructor_invites i
  where lower(i.email) = lower(new.email)
    and i.accepted_at is null
    and i.expires_at > now()
  order by i.created_at desc
  limit 1;

  if found then
    v_role := 'instructor';
  elsif (new.raw_app_meta_data ->> 'role') in ('instructor', 'admin') then
    v_role := (new.raw_app_meta_data ->> 'role')::public.user_role;
  end if;

  if v_first is null and v_full_name is not null then
    v_first := split_part(v_full_name, ' ', 1);
    v_last := coalesce(v_last, nullif(trim(substr(v_full_name, length(v_first) + 1)), ''));
  end if;

  insert into public.users (id, role, email, first_name, last_name)
  values (new.id, v_role, coalesce(new.email, ''), v_first, v_last)
  on conflict (id) do nothing;

  if v_role = 'parent' then
    insert into public.parents (id) values (new.id) on conflict (id) do nothing;
  elsif v_role = 'instructor' then
    select default_instructor_pay_cents_per_hour into v_default_rate from public.platform_settings;

    insert into public.instructors (id, display_name, is_active)
    values (
      new.id,
      coalesce(v_first, 'Instructor') || coalesce(' ' || left(v_last, 1) || '.', ''),
      false
    )
    on conflict (id) do nothing;

    insert into public.instructor_private (instructor_id, pay_rate_cents_per_hour)
    values (new.id, coalesce(v_invite.pay_rate_cents_per_hour, v_default_rate, 4000))
    on conflict (instructor_id) do nothing;

    if v_invite.id is not null then
      update public.instructor_invites
      set accepted_at = now(), accepted_user_id = new.id
      where id = v_invite.id;
    end if;
  end if;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_auth_user();

create or replace function private.handle_auth_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email then
    update public.users set email = coalesce(new.email, '') where id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function private.handle_auth_user_email_change();

-- -----------------------------------------------------------------------------
-- messages.sender_role is derived, never client-supplied
-- -----------------------------------------------------------------------------
create or replace function private.messages_set_sender_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select u.role into new.sender_role from public.users u where u.id = new.sender_id;
  if new.sender_role is null then
    raise exception 'unknown sender' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger messages_set_sender_role
  before insert on public.messages
  for each row execute function private.messages_set_sender_role();

-- -----------------------------------------------------------------------------
-- RPC: instructor accepts the current platform terms
-- (confidentiality of client info; all payments on-platform; no solicitation)
-- -----------------------------------------------------------------------------
create or replace function public.accept_instructor_terms(p_terms_version text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current text;
  v_uid uuid := (select auth.uid());
  v_at timestamptz;
begin
  if v_uid is null or private.caller_role() <> 'instructor' then
    raise exception 'only instructors can accept instructor terms' using errcode = '42501';
  end if;

  select instructor_terms_version into v_current from public.platform_settings;
  if p_terms_version is distinct from v_current then
    raise exception 'terms version % is not current (current: %)', p_terms_version, v_current
      using errcode = '22023';
  end if;

  insert into public.instructor_terms_acceptances (instructor_id, terms_version, ip_address, user_agent)
  values (
    v_uid,
    v_current,
    split_part(coalesce(private.request_header('x-forwarded-for'), ''), ',', 1),
    left(private.request_header('user-agent'), 400)
  )
  on conflict (instructor_id, terms_version) do update set accepted_at = public.instructor_terms_acceptances.accepted_at
  returning accepted_at into v_at;

  perform private.write_audit('instructor.accept_terms', 'instructor', v_uid, null,
    jsonb_build_object('terms_version', v_current));

  return v_at;
end;
$$;

-- -----------------------------------------------------------------------------
-- The ONLY way an instructor can read client-related data.
--
-- * Caller must be an active instructor who accepted the current terms.
-- * Returns only lessons assigned to the caller.
-- * Children: first name, age on the lesson date, swim level, notes.
--   Never: last name, email, phone, birth date, parent id.
-- * Address: only during the reveal window (local midnight of the lesson day
--   → lesson end + platform_settings.address_hide_after_minutes) and only for
--   live lessons. Outside the window `address` is NULL.
-- * Every row returned is written to audit_log.
-- * Range-limited (platform_settings.max_lesson_view_range_days) so the API
--   cannot be used for bulk export.
-- -----------------------------------------------------------------------------
create or replace function private.lesson_children_json(p_booking_id uuid, p_on date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'first_name', c.first_name,
        'age', case when c.birth_date is null then null
                    else extract(year from age(p_on, c.birth_date))::int end,
        'swim_level', c.swim_level,
        'notes', c.notes
      )
      order by c.first_name
    ),
    '[]'::jsonb
  )
  from public.booking_children bc
  join public.children c on c.id = bc.child_id
  where bc.booking_id = p_booking_id
$$;

create or replace function private.lesson_address_json(p_booking_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'line1', l.address_line1,
    'line2', l.address_line2,
    'city', l.city,
    'state', l.state,
    'postal_code', l.postal_code,
    'lat', l.lat,
    'lng', l.lng,
    'access_notes', l.access_notes
  )
  from public.booking_locations l
  where l.booking_id = p_booking_id
$$;

create type public.instructor_lesson_row as (
  booking_id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  duration_minutes integer,
  status public.booking_status,
  zone_code text,
  zone_name text,
  neighborhood text,
  children jsonb,
  address jsonb,
  address_visible boolean,
  address_visible_from timestamptz,
  address_visible_until timestamptz,
  has_note boolean
);

create or replace function private.instructor_lesson_rows(p_from timestamptz, p_to timestamptz, p_booking_id uuid)
returns setof public.instructor_lesson_row
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_hide integer;
  r record;
  v_visible boolean;
  v_out public.instructor_lesson_row;
begin
  if not private.is_active_instructor() then
    raise exception 'not an active instructor (activation and current terms acceptance required)'
      using errcode = '42501';
  end if;

  select address_hide_after_minutes into v_hide from public.platform_settings;

  for r in
    select b.*, z.code as zone_code, z.name as zone_name
    from public.bookings b
    join public.zones z on z.id = b.zone_id
    where b.instructor_id = v_uid
      and (p_booking_id is null or b.id = p_booking_id)
      and (p_from is null or b.starts_at >= p_from)
      and (p_to is null or b.starts_at < p_to)
      and b.status in ('pending_instructor', 'confirmed', 'completed', 'no_show')
    order by b.starts_at
  loop
    v_visible := r.status = 'confirmed'
      and private.address_window_open(r.starts_at, r.ends_at, now(), v_hide);

    v_out.booking_id := r.id;
    v_out.starts_at := r.starts_at;
    v_out.ends_at := r.ends_at;
    v_out.duration_minutes := r.duration_minutes;
    v_out.status := r.status;
    v_out.zone_code := r.zone_code;
    v_out.zone_name := r.zone_name;
    v_out.neighborhood := r.neighborhood;
    v_out.children := private.lesson_children_json(r.id, private.la_date(r.starts_at));
    v_out.address := case when v_visible then private.lesson_address_json(r.id) end;
    v_out.address_visible := v_visible;
    v_out.address_visible_from := private.la_day_start(r.starts_at);
    v_out.address_visible_until := r.ends_at + make_interval(mins => v_hide);
    v_out.has_note := exists (select 1 from public.lesson_notes n where n.booking_id = r.id);

    perform private.write_audit(
      'instructor.view_lesson', 'booking', r.id, r.id,
      jsonb_build_object(
        'address_revealed', v_visible,
        'children_count', jsonb_array_length(v_out.children),
        'via', case when p_booking_id is null then 'instructor_lessons' else 'instructor_lesson' end
      )
    );

    return next v_out;
  end loop;
end;
$$;

create or replace function public.instructor_lessons(p_from date, p_to date)
returns setof public.instructor_lesson_row
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max integer;
begin
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'invalid date range' using errcode = '22023';
  end if;
  select max_lesson_view_range_days into v_max from public.platform_settings;
  if p_to - p_from > v_max then
    raise exception 'date range too large (max % days)', v_max using errcode = '22023';
  end if;

  -- p_from / p_to are LOCAL dates; p_to is inclusive.
  return query
    select * from private.instructor_lesson_rows(
      p_from::timestamp at time zone 'America/Los_Angeles',
      (p_to + 1)::timestamp at time zone 'America/Los_Angeles',
      null
    );
end;
$$;

create or replace function public.instructor_lesson(p_booking_id uuid)
returns public.instructor_lesson_row
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.instructor_lesson_row;
begin
  select * into v_row from private.instructor_lesson_rows(null, null, p_booking_id);
  if v_row.booking_id is null then
    raise exception 'lesson not found' using errcode = 'P0002';
  end if;
  return v_row;
end;
$$;

-- -----------------------------------------------------------------------------
-- Function privileges: API roles may call only these RPCs.
-- -----------------------------------------------------------------------------
revoke all on function public.accept_instructor_terms(text) from public, anon;
revoke all on function public.instructor_lessons(date, date) from public, anon;
revoke all on function public.instructor_lesson(uuid) from public, anon;
grant execute on function public.accept_instructor_terms(text) to authenticated;
grant execute on function public.instructor_lessons(date, date) to authenticated;
grant execute on function public.instructor_lesson(uuid) to authenticated;

-- private.* helpers that read sensitive tables must not be callable by API
-- roles at all (they're SECURITY DEFINER). The RLS helpers in the previous
-- migration stay executable because policies call them as the invoking role.
revoke all on function private.lesson_children_json(uuid, date) from public, anon, authenticated;
revoke all on function private.lesson_address_json(uuid) from public, anon, authenticated;
revoke all on function private.instructor_lesson_rows(timestamptz, timestamptz, uuid) from public, anon, authenticated;
revoke all on function private.write_audit(text, text, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function private.handle_new_auth_user() from public, anon, authenticated;
revoke all on function private.handle_auth_user_email_change() from public, anon, authenticated;
revoke all on function private.messages_set_sender_role() from public, anon, authenticated;
