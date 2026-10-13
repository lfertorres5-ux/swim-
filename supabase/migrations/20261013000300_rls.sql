-- =============================================================================
-- Phase 1 · Row-Level Security
--
-- Two layers, both enforced by Postgres:
--   1. GRANTS decide which tables/columns the `anon` and `authenticated` API
--      roles can touch at all. We revoke Supabase's permissive defaults and
--      grant explicitly, so a new table is invisible until someone grants it.
--   2. RLS POLICIES decide which rows each user sees.
--
-- Privileged writes (pricing, role changes, refunds, booking creation) are done
-- server-side with the service role after an explicit admin/ownership check,
-- and are written to audit_log. The API roles cannot perform them directly.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Lock down defaults
-- -----------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema private revoke execute on functions from public, anon, authenticated;

grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;

-- -----------------------------------------------------------------------------
-- 1. Helper functions (SECURITY DEFINER: they read tables the caller may not
--    see; they bypass RLS as the table owner, so there is no policy recursion)
-- -----------------------------------------------------------------------------
create or replace function private.caller_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select u.role from public.users u where u.id = (select auth.uid())
$$;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.caller_role() = 'admin', false)
$$;

create or replace function private.has_accepted_current_terms(p_instructor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.instructor_terms_acceptances a
    join public.platform_settings s on s.instructor_terms_version = a.terms_version
    where a.instructor_id = p_instructor_id
  )
$$;

-- An instructor may see client-related rows only while: their role is
-- instructor, admin has activated them, and they accepted the CURRENT terms.
-- Bumping platform_settings.instructor_terms_version cuts off access until
-- each instructor re-accepts.
create or replace function private.is_active_instructor()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.users u
    join public.instructors i on i.id = u.id
    where u.id = (select auth.uid())
      and u.role = 'instructor'
      and i.is_active
  ) and private.has_accepted_current_terms((select auth.uid()))
$$;

create or replace function private.is_booking_parent(p_booking_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.bookings b
    where b.id = p_booking_id and b.parent_id = (select auth.uid())
  )
$$;

create or replace function private.is_booking_instructor(p_booking_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_instructor() and exists (
    select 1 from public.bookings b
    where b.id = p_booking_id and b.instructor_id = (select auth.uid())
  )
$$;

create or replace function private.parent_has_booked_instructor(p_instructor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.bookings b
    where b.instructor_id = p_instructor_id and b.parent_id = (select auth.uid())
  )
$$;

create or replace function private.instructor_covers_zone(p_zone_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.instructor_zones z
    where z.zone_id = p_zone_id and z.instructor_id = (select auth.uid())
  )
$$;

grant execute on all functions in schema private to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. Enable RLS on every table in public
-- -----------------------------------------------------------------------------
do $$
declare
  t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 3. Public configuration (readable by everyone, incl. logged-out visitors)
-- -----------------------------------------------------------------------------
grant select on public.platform_settings, public.pricing_config, public.lesson_prices,
  public.package_offerings, public.zones to anon, authenticated;

create policy platform_settings_read on public.platform_settings for select to anon, authenticated using (true);
create policy pricing_config_read on public.pricing_config for select to anon, authenticated using (true);
create policy lesson_prices_read on public.lesson_prices for select to anon, authenticated using (is_active or (select private.is_admin()));
create policy package_offerings_read on public.package_offerings for select to anon, authenticated using (is_active or (select private.is_admin()));
create policy zones_read on public.zones for select to anon, authenticated using (true);

grant select on public.zone_travel_buffers to authenticated;
create policy zone_travel_buffers_read on public.zone_travel_buffers for select to authenticated
  using ((select private.is_admin()) or (select private.is_active_instructor()));

-- -----------------------------------------------------------------------------
-- 4. users — contact details. Self + admin ONLY. Never instructors.
-- -----------------------------------------------------------------------------
grant select on public.users to authenticated;
-- role / email are NOT updatable through the API (role changes are admin
-- server actions; email follows auth.users).
grant update (first_name, last_name, phone, sms_opt_in, email_opt_in, onboarded_at) on public.users to authenticated;

create policy users_select_self on public.users for select to authenticated
  using (id = (select auth.uid()));
create policy users_select_admin on public.users for select to authenticated
  using ((select private.is_admin()));
create policy users_update_self on public.users for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- 5. parents — home address, Stripe id. Self + admin ONLY.
-- -----------------------------------------------------------------------------
grant select on public.parents to authenticated;
-- Address/zone are set by a server action that validates the zone; parents
-- may only change preferences directly.
grant update (favorite_instructor_id, preferred_days, preferred_time_windows) on public.parents to authenticated;

create policy parents_select_self on public.parents for select to authenticated
  using (id = (select auth.uid()));
create policy parents_select_admin on public.parents for select to authenticated
  using ((select private.is_admin()));
create policy parents_update_self on public.parents for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- 6. children — parent + admin. Instructors read ONLY via the audited RPCs in
--    the next migration (instructor_lessons / instructor_lesson).
-- -----------------------------------------------------------------------------
grant select, delete on public.children to authenticated;
grant insert (parent_id, first_name, birth_date, swim_level, notes) on public.children to authenticated;
grant update (first_name, birth_date, swim_level, notes, is_active) on public.children to authenticated;

create policy children_select_parent on public.children for select to authenticated
  using (parent_id = (select auth.uid()));
create policy children_select_admin on public.children for select to authenticated
  using ((select private.is_admin()));
create policy children_insert_parent on public.children for insert to authenticated
  with check (parent_id = (select auth.uid()));
create policy children_update_parent on public.children for update to authenticated
  using (parent_id = (select auth.uid())) with check (parent_id = (select auth.uid()));
create policy children_delete_parent on public.children for delete to authenticated
  using (parent_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- 7. Instructors (public profile), private profile, certifications, zones
-- -----------------------------------------------------------------------------
grant select on public.instructors to anon, authenticated;
-- display_name is admin-controlled (first name + last initial) so it can't be
-- used to smuggle contact details to parents. Free-text bio is screened by the
-- Phase 4 contact filter.
grant update (bio, photo_path, specialties, levels_taught, min_child_age_months,
  max_children_per_lesson, years_experience, languages, is_accepting_new_clients)
  on public.instructors to authenticated;

create policy instructors_select_public on public.instructors for select to anon, authenticated
  using (is_active);
create policy instructors_select_self on public.instructors for select to authenticated
  using (id = (select auth.uid()));
create policy instructors_select_booked on public.instructors for select to authenticated
  using ((select private.parent_has_booked_instructor(id)));
create policy instructors_select_admin on public.instructors for select to authenticated
  using ((select private.is_admin()));
create policy instructors_update_self on public.instructors for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Pay rate + iCal token: self + admin. Nobody can change their own pay rate.
grant select on public.instructor_private to authenticated;
create policy instructor_private_select_self on public.instructor_private for select to authenticated
  using (instructor_id = (select auth.uid()));
create policy instructor_private_select_admin on public.instructor_private for select to authenticated
  using ((select private.is_admin()));

grant select on public.instructor_terms_acceptances to authenticated;
create policy terms_select_self on public.instructor_terms_acceptances for select to authenticated
  using (instructor_id = (select auth.uid()));
create policy terms_select_admin on public.instructor_terms_acceptances for select to authenticated
  using ((select private.is_admin()));

grant select on public.instructor_invites to authenticated;
create policy invites_select_admin on public.instructor_invites for select to authenticated
  using ((select private.is_admin()));

-- Certifications: the public sees verified, unexpired certs (trust badges).
grant select on public.instructor_certifications to anon, authenticated;
grant insert (instructor_id, kind, issuer, issued_on, expires_on, document_path) on public.instructor_certifications to authenticated;
grant delete on public.instructor_certifications to authenticated;

create policy certs_select_public on public.instructor_certifications for select to anon, authenticated
  using (verified_at is not null and (expires_on is null or expires_on >= private.la_date(now())));
create policy certs_select_self on public.instructor_certifications for select to authenticated
  using (instructor_id = (select auth.uid()));
create policy certs_select_admin on public.instructor_certifications for select to authenticated
  using ((select private.is_admin()));
create policy certs_insert_self on public.instructor_certifications for insert to authenticated
  with check (instructor_id = (select auth.uid()) and (select private.caller_role()) = 'instructor');
-- Instructors may remove only their own *unverified* uploads.
create policy certs_delete_self on public.instructor_certifications for delete to authenticated
  using (instructor_id = (select auth.uid()) and verified_at is null);

grant select, insert, delete on public.instructor_zones to authenticated;
create policy instructor_zones_select_self on public.instructor_zones for select to authenticated
  using (instructor_id = (select auth.uid()));
create policy instructor_zones_select_admin on public.instructor_zones for select to authenticated
  using ((select private.is_admin()));
create policy instructor_zones_insert_self on public.instructor_zones for insert to authenticated
  with check (instructor_id = (select auth.uid()) and (select private.caller_role()) = 'instructor');
create policy instructor_zones_delete_self on public.instructor_zones for delete to authenticated
  using (instructor_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- 8. Availability — instructor owns their own; admin reads all.
-- -----------------------------------------------------------------------------
grant select, delete on public.availability_rules, public.availability_overrides to authenticated;
grant insert (instructor_id, weekday, start_time, end_time, effective_from, effective_until),
  update (weekday, start_time, end_time, effective_from, effective_until)
  on public.availability_rules to authenticated;
grant insert (instructor_id, date, kind, start_time, end_time, note),
  update (date, kind, start_time, end_time, note)
  on public.availability_overrides to authenticated;

create policy availability_rules_select on public.availability_rules for select to authenticated
  using (instructor_id = (select auth.uid()) or (select private.is_admin()));
create policy availability_rules_insert on public.availability_rules for insert to authenticated
  with check (instructor_id = (select auth.uid()) and (select private.caller_role()) = 'instructor');
create policy availability_rules_update on public.availability_rules for update to authenticated
  using (instructor_id = (select auth.uid())) with check (instructor_id = (select auth.uid()));
create policy availability_rules_delete on public.availability_rules for delete to authenticated
  using (instructor_id = (select auth.uid()));

create policy availability_overrides_select on public.availability_overrides for select to authenticated
  using (instructor_id = (select auth.uid()) or (select private.is_admin()));
create policy availability_overrides_insert on public.availability_overrides for insert to authenticated
  with check (instructor_id = (select auth.uid()) and (select private.caller_role()) = 'instructor');
create policy availability_overrides_update on public.availability_overrides for update to authenticated
  using (instructor_id = (select auth.uid())) with check (instructor_id = (select auth.uid()));
create policy availability_overrides_delete on public.availability_overrides for delete to authenticated
  using (instructor_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- 9. Bookings. The bookings row itself carries no PII and no prices, so the
--    assigned (active, terms-accepted) instructor may read it directly.
--    All writes go through server actions (pricing + Stripe must be enforced).
-- -----------------------------------------------------------------------------
grant select on public.bookings to authenticated;

create policy bookings_select_parent on public.bookings for select to authenticated
  using (parent_id = (select auth.uid()));
create policy bookings_select_instructor on public.bookings for select to authenticated
  using (instructor_id = (select auth.uid()) and (select private.is_active_instructor()));
create policy bookings_select_admin on public.bookings for select to authenticated
  using ((select private.is_admin()));

grant select on public.booking_children, public.booking_locations, public.booking_pricing to authenticated;

create policy booking_children_select_parent on public.booking_children for select to authenticated
  using ((select private.is_booking_parent(booking_id)));
create policy booking_children_select_admin on public.booking_children for select to authenticated
  using ((select private.is_admin()));

-- NOTE: deliberately no instructor policy. See instructor_lesson(s) RPCs.
create policy booking_locations_select_parent on public.booking_locations for select to authenticated
  using ((select private.is_booking_parent(booking_id)));
create policy booking_locations_select_admin on public.booking_locations for select to authenticated
  using ((select private.is_admin()));

create policy booking_pricing_select_parent on public.booking_pricing for select to authenticated
  using ((select private.is_booking_parent(booking_id)));
create policy booking_pricing_select_admin on public.booking_pricing for select to authenticated
  using ((select private.is_admin()));

grant select on public.booking_offers to authenticated;
create policy booking_offers_select_self on public.booking_offers for select to authenticated
  using (instructor_id = (select auth.uid()) and (select private.is_active_instructor()));
create policy booking_offers_select_admin on public.booking_offers for select to authenticated
  using ((select private.is_admin()));

grant select on public.booking_series to authenticated;
create policy booking_series_select_parent on public.booking_series for select to authenticated
  using (parent_id = (select auth.uid()));
create policy booking_series_select_instructor on public.booking_series for select to authenticated
  using (instructor_id = (select auth.uid()) and (select private.is_active_instructor()));
create policy booking_series_select_admin on public.booking_series for select to authenticated
  using ((select private.is_admin()));

grant select on public.packages to authenticated;
create policy packages_select_parent on public.packages for select to authenticated
  using (parent_id = (select auth.uid()));
create policy packages_select_admin on public.packages for select to authenticated
  using ((select private.is_admin()));

-- -----------------------------------------------------------------------------
-- 10. Lesson notes — written by the assigned instructor, read by the parent.
-- -----------------------------------------------------------------------------
grant select on public.lesson_notes to authenticated;
grant insert (booking_id, instructor_id, skills, summary, next_focus) on public.lesson_notes to authenticated;
grant update (skills, summary, next_focus) on public.lesson_notes to authenticated;

create policy lesson_notes_select_parent on public.lesson_notes for select to authenticated
  using ((select private.is_booking_parent(booking_id)));
create policy lesson_notes_select_instructor on public.lesson_notes for select to authenticated
  using (instructor_id = (select auth.uid()) and (select private.is_booking_instructor(booking_id)));
create policy lesson_notes_select_admin on public.lesson_notes for select to authenticated
  using ((select private.is_admin()));
create policy lesson_notes_insert_instructor on public.lesson_notes for insert to authenticated
  with check (instructor_id = (select auth.uid()) and (select private.is_booking_instructor(booking_id)));
create policy lesson_notes_update_instructor on public.lesson_notes for update to authenticated
  using (instructor_id = (select auth.uid()) and (select private.is_booking_instructor(booking_id)))
  with check (instructor_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- 11. Open shifts (sub board). Carries only zone/time/ages/levels.
-- -----------------------------------------------------------------------------
grant select on public.open_shifts to authenticated;
create policy open_shifts_select_board on public.open_shifts for select to authenticated
  using (
    status = 'open'
    and released_by <> (select auth.uid())
    and (select private.is_active_instructor())
    and (select private.instructor_covers_zone(zone_id))
  );
create policy open_shifts_select_involved on public.open_shifts for select to authenticated
  using ((released_by = (select auth.uid()) or claimed_by = (select auth.uid())) and (select private.is_active_instructor()));
create policy open_shifts_select_admin on public.open_shifts for select to authenticated
  using ((select private.is_admin()));

-- -----------------------------------------------------------------------------
-- 12. Money. Parents see their own payments; instructors see only their own
--     earnings/payouts (pay rate × minutes) — never what the parent paid.
-- -----------------------------------------------------------------------------
grant select on public.payments to authenticated;
create policy payments_select_parent on public.payments for select to authenticated
  using (parent_id = (select auth.uid()));
create policy payments_select_admin on public.payments for select to authenticated
  using ((select private.is_admin()));

grant select on public.instructor_earnings, public.instructor_payouts to authenticated;
create policy earnings_select_self on public.instructor_earnings for select to authenticated
  using (instructor_id = (select auth.uid()));
create policy earnings_select_admin on public.instructor_earnings for select to authenticated
  using ((select private.is_admin()));
create policy payouts_select_self on public.instructor_payouts for select to authenticated
  using (instructor_id = (select auth.uid()));
create policy payouts_select_admin on public.instructor_payouts for select to authenticated
  using ((select private.is_admin()));

grant select on public.discount_codes to authenticated;
create policy discount_codes_select_admin on public.discount_codes for select to authenticated
  using ((select private.is_admin()));

-- -----------------------------------------------------------------------------
-- 13. Messages — the booking's parent and its assigned instructor.
--     (Phase 4 adds the BEFORE INSERT contact-info filter trigger.)
-- -----------------------------------------------------------------------------
grant select on public.messages to authenticated;
grant insert (booking_id, body) on public.messages to authenticated;
grant update (read_at) on public.messages to authenticated;

create policy messages_select_participant on public.messages for select to authenticated
  using ((select private.is_booking_parent(booking_id)) or (select private.is_booking_instructor(booking_id)));
create policy messages_select_admin on public.messages for select to authenticated
  using ((select private.is_admin()));
create policy messages_insert_participant on public.messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and ((select private.is_booking_parent(booking_id)) or (select private.is_booking_instructor(booking_id)))
  );
-- Recipients mark messages read; they cannot edit bodies (column grant).
create policy messages_update_recipient on public.messages for update to authenticated
  using (
    sender_id <> (select auth.uid())
    and ((select private.is_booking_parent(booking_id)) or (select private.is_booking_instructor(booking_id)))
  );

grant select, update (status, reviewed_by, reviewed_at, admin_notes) on public.flagged_messages to authenticated;
create policy flagged_messages_admin_select on public.flagged_messages for select to authenticated
  using ((select private.is_admin()));
create policy flagged_messages_admin_update on public.flagged_messages for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- -----------------------------------------------------------------------------
-- 14. Audit log — admin read only. Nobody inserts directly through the API;
--     rows are written by SECURITY DEFINER functions and server actions.
-- -----------------------------------------------------------------------------
grant select on public.audit_log to authenticated;
create policy audit_log_admin_select on public.audit_log for select to authenticated
  using ((select private.is_admin()));

-- -----------------------------------------------------------------------------
-- 15. Day pass inquiries — submitted through a rate-limited server action.
-- -----------------------------------------------------------------------------
grant select on public.day_pass_inquiries to authenticated;
grant update (status, quoted_amount_cents, stripe_payment_link_url, admin_notes, handled_by) on public.day_pass_inquiries to authenticated;
create policy day_pass_select_own on public.day_pass_inquiries for select to authenticated
  using (parent_id = (select auth.uid()));
create policy day_pass_select_admin on public.day_pass_inquiries for select to authenticated
  using ((select private.is_admin()));
create policy day_pass_update_admin on public.day_pass_inquiries for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- -----------------------------------------------------------------------------
-- 16. Webhooks — admin only (secrets never leave the server otherwise).
-- -----------------------------------------------------------------------------
grant select on public.webhooks, public.webhook_deliveries to authenticated;
create policy webhooks_admin_select on public.webhooks for select to authenticated
  using ((select private.is_admin()));
create policy webhook_deliveries_admin_select on public.webhook_deliveries for select to authenticated
  using ((select private.is_admin()));
