-- =============================================================================
-- No-shows: the instructor marks "Family didn't show" once the lesson has been
-- underway for 10 minutes. The lesson becomes 'no_show' (no refund, package
-- credit stays used) and the instructor is paid no_show_pay_pct of the lesson.
-- =============================================================================

alter table public.platform_settings
  add column no_show_pay_pct integer not null default 100 check (no_show_pay_pct between 0 and 100);

create or replace function public.mark_no_show(p_booking_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_booking public.bookings;
  v_rate integer;
  v_pct integer;
  v_amount integer;
begin
  if not private.is_booking_instructor(p_booking_id) or not private.is_active_instructor() then
    raise exception 'not your lesson' using errcode = '42501';
  end if;

  select * into v_booking from public.bookings where id = p_booking_id for update;
  if v_booking.status <> 'confirmed' then
    raise exception 'this lesson is %', v_booking.status using errcode = 'SB002';
  end if;
  if now() < v_booking.starts_at + interval '10 minutes' then
    raise exception 'You can mark a no-show 10 minutes after the lesson starts' using errcode = 'SB005';
  end if;

  update public.bookings set status = 'no_show', completed_at = now() where id = p_booking_id;

  select pay_rate_cents_per_hour into v_rate from public.instructor_private where instructor_id = v_uid;
  select no_show_pay_pct into v_pct from public.platform_settings;
  v_amount := round(v_booking.duration_minutes * coalesce(v_rate, 0) / 60.0 * coalesce(v_pct, 100) / 100.0)::integer;
  insert into public.instructor_earnings (instructor_id, booking_id, minutes, rate_cents_per_hour, amount_cents, earned_on)
  values (v_uid, p_booking_id, v_booking.duration_minutes, coalesce(v_rate, 0), v_amount, private.la_date(v_booking.starts_at))
  on conflict (instructor_id, booking_id) do nothing;

  perform private.write_audit('instructor.mark_no_show', 'booking', p_booking_id, p_booking_id,
    jsonb_build_object('pay_pct', coalesce(v_pct, 100), 'amount_cents', v_amount));
  return v_amount;
end;
$$;

revoke all on function public.mark_no_show(uuid) from public, anon;
grant execute on function public.mark_no_show(uuid) to authenticated;
