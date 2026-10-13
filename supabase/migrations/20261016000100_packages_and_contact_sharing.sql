-- =============================================================================
-- Packages (6 / 8 / 14 lessons) + contact sharing for package families
--
-- Contact rule (owner decision): once a family has PAID for a package and an
-- instructor has ACCEPTED a lesson from it, that family and that instructor
-- may see each other's name, phone and email. Single lessons and weekly
-- series stay masked. Other instructors never see anything. Every contact
-- view is audited. platform_settings.contact_sharing = 'never' turns it off.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Default catalog (also needed in production, where seed.sql never runs).
-- Never overwrites values an admin has changed.
-- -----------------------------------------------------------------------------
insert into public.lesson_prices (duration_minutes, price_cents, label, sort_order) values
  (30, 6500, '30 minutes', 1),
  (60, 9000, '60 minutes', 2),
  (90, 13000, '90 minutes', 3)
on conflict (duration_minutes) do nothing;

update public.package_offerings set is_active = false where lesson_count = 4;

insert into public.package_offerings (name, lesson_count, discount_pct, validity_days, sort_order) values
  ('6-Lesson Package', 6, 5, 150, 1),
  ('8-Lesson Package', 8, 10, 180, 2),
  ('14-Lesson Package', 14, 15, 270, 3)
on conflict (lesson_count) do nothing;

-- -----------------------------------------------------------------------------
-- Contact sharing
-- -----------------------------------------------------------------------------
alter table public.platform_settings
  add column contact_sharing text not null default 'package_instructor'
    check (contact_sharing in ('never', 'package_instructor'));

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
        and p.status in ('active', 'exhausted')   -- paid; not refunded/expired-unpaid
    )
$$;

-- Parent → contact details of their package instructors.
create or replace function public.my_instructor_contacts()
returns table (instructor_id uuid, first_name text, last_name text, email text, phone text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  r record;
begin
  if private.caller_role() is distinct from 'parent' then
    raise exception 'parents only' using errcode = '42501';
  end if;

  for r in
    select i.id, i.first_name, u.last_name, u.email, u.phone
    from public.instructors i
    join public.users u on u.id = i.id
    where private.contact_shared(v_uid, i.id)
    order by i.first_name
  loop
    perform private.write_audit('parent.view_instructor_contact', 'instructor', r.id, null, '{}'::jsonb);
    instructor_id := r.id; first_name := r.first_name; last_name := r.last_name; email := r.email; phone := r.phone;
    return next;
  end loop;
end;
$$;

-- Instructor → contact details of their package families.
create or replace function public.my_family_contacts()
returns table (parent_id uuid, first_name text, last_name text, email text, phone text, children text[])
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  r record;
begin
  if not private.is_active_instructor() then
    raise exception 'not an active instructor' using errcode = '42501';
  end if;

  for r in
    select p.id, u.first_name, u.last_name, u.email, u.phone,
           coalesce((select array_agg(c.first_name order by c.first_name) from public.children c where c.parent_id = p.id and c.is_active), '{}') as kids
    from public.parents p
    join public.users u on u.id = p.id
    where private.contact_shared(p.id, v_uid)
    order by u.last_name, u.first_name
  loop
    perform private.write_audit('instructor.view_family_contact', 'parent', r.id, null, '{}'::jsonb);
    parent_id := r.id; first_name := r.first_name; last_name := r.last_name; email := r.email; phone := r.phone; children := r.kids;
    return next;
  end loop;
end;
$$;

revoke all on function private.contact_shared(uuid, uuid) from public, anon, authenticated;
revoke all on function public.my_instructor_contacts() from public, anon;
revoke all on function public.my_family_contacts() from public, anon;
grant execute on function public.my_instructor_contacts() to authenticated;
grant execute on function public.my_family_contacts() to authenticated;

-- -----------------------------------------------------------------------------
-- Instructor terms: new version reflecting the contact policy. Instructors
-- re-accept on next sign-in (RLS cuts off client data until they do).
-- -----------------------------------------------------------------------------
alter table public.platform_settings alter column instructor_terms_version set default '2026-10-16';
update public.platform_settings set instructor_terms_version = '2026-10-16' where instructor_terms_version = '2026-10-01';
