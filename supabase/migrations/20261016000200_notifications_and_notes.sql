-- =============================================================================
-- Phase 4 · Notifications outbox + instructor progress notes
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Notification outbox. Every email/SMS is rendered and stored here first, then
-- delivered (immediately, and retried by the cron). dedupe_key makes each
-- notification idempotent: the same event can fire twice and send once.
-- -----------------------------------------------------------------------------
create type public.notification_channel as enum ('email', 'sms');
create type public.notification_status as enum ('pending', 'sent', 'failed', 'skipped');

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users (id) on delete cascade,   -- null for admin alerts
  to_address text not null,                                      -- email or E.164 phone
  channel public.notification_channel not null,
  template text not null,
  booking_id uuid references public.bookings (id) on delete set null,
  subject text,
  body_text text not null,
  body_html text,
  dedupe_key text not null unique,
  status public.notification_status not null default 'pending',
  attempts integer not null default 0,
  last_error text,
  provider text,                                                 -- resend | twilio | log
  provider_message_id text,
  next_attempt_at timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_due_idx on public.notifications (next_attempt_at) where status in ('pending', 'failed');
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_booking_idx on public.notifications (booking_id);

alter table public.notifications enable row level security;
grant select on public.notifications to authenticated;
create policy notifications_select_own on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy notifications_select_admin on public.notifications for select to authenticated
  using ((select private.is_admin()));

alter table public.platform_settings
  add column reminder_hours_before integer not null default 24 check (reminder_hours_before between 1 and 168);

-- -----------------------------------------------------------------------------
-- Instructor submits (or edits) the progress note after a lesson.
-- One call: saves the note, marks the lesson completed, and records the
-- instructor's pay for it (rate × minutes, once). Returns true the first time,
-- so the app knows to notify the parent.
-- -----------------------------------------------------------------------------
create or replace function public.submit_lesson_note(
  p_booking_id uuid,
  p_skills jsonb,
  p_summary text,
  p_next_focus text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_booking public.bookings;
  v_first boolean;
  v_rate integer;
begin
  if not private.is_booking_instructor(p_booking_id) then
    raise exception 'not your lesson' using errcode = '42501';
  end if;

  select * into v_booking from public.bookings where id = p_booking_id for update;
  if v_booking.status not in ('confirmed', 'completed') then
    raise exception 'this lesson is %', v_booking.status using errcode = 'SB002';
  end if;
  if now() < v_booking.starts_at then
    raise exception 'You can write the note once the lesson has started' using errcode = 'SB005';
  end if;
  if p_skills is null or jsonb_typeof(p_skills) <> 'object' then
    raise exception 'skills must be an object' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_summary, ''))) = 0 then
    raise exception 'Add a short comment for the family' using errcode = '22023';
  end if;
  if length(p_summary) > 2000 or length(coalesce(p_next_focus, '')) > 500 then
    raise exception 'note is too long' using errcode = '22023';
  end if;

  insert into public.lesson_notes (booking_id, instructor_id, skills, summary, next_focus)
  values (p_booking_id, v_uid, p_skills, trim(p_summary), nullif(trim(coalesce(p_next_focus, '')), ''))
  on conflict (booking_id) do update
    set skills = excluded.skills, summary = excluded.summary, next_focus = excluded.next_focus, updated_at = now()
  returning (xmax = 0) into v_first;

  update public.bookings
    set status = 'completed', completed_at = coalesce(completed_at, now())
    where id = p_booking_id;

  select pay_rate_cents_per_hour into v_rate from public.instructor_private where instructor_id = v_uid;
  insert into public.instructor_earnings (instructor_id, booking_id, minutes, rate_cents_per_hour, amount_cents, earned_on)
  values (v_uid, p_booking_id, v_booking.duration_minutes, coalesce(v_rate, 0),
          round(v_booking.duration_minutes * coalesce(v_rate, 0) / 60.0)::integer, private.la_date(v_booking.starts_at))
  on conflict (instructor_id, booking_id) do nothing;

  perform private.write_audit('instructor.submit_note', 'booking', p_booking_id, p_booking_id,
    jsonb_build_object('first_submission', v_first));
  return v_first;
end;
$$;

revoke all on function public.submit_lesson_note(uuid, jsonb, text, text) from public, anon;
grant execute on function public.submit_lesson_note(uuid, jsonb, text, text) to authenticated;
