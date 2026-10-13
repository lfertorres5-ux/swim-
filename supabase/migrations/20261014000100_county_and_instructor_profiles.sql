-- =============================================================================
-- Phase 2a · San Diego County only + required instructor profiles
--
-- 1. Service area is restricted to San Diego County at the database level:
--    * every ZIP on a zone, a parent's address, and a lesson address must be a
--      San Diego County ZIP (USPS prefixes 919xx, 920xx, 921xx — the whole
--      county and nothing outside it);
--    * every zone boundary vertex, and every stored home/lesson coordinate,
--      must fall inside a simplified county outline (same polygon as
--      src/lib/geo/san-diego-county.ts).
-- 2. Instructors are shown to parents by FIRST NAME only, and can't be active
--    (= visible / bookable) without a first name, a bio and a photo.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- San Diego County validation helpers
-- -----------------------------------------------------------------------------
create or replace function private.is_sd_county_zip(p_zip text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_zip ~ '^9(19|20|21)[0-9]{2}$', false)
$$;

create or replace function private.all_sd_county_zips(p_zips text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(bool_and(private.is_sd_county_zip(z)), true) from unnest(p_zips) as z
$$;

-- Bounding box of San Diego County (generous by ~1 km on land borders).
create or replace function private.within_sd_county_bbox(p_lng double precision, p_lat double precision)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_lng between -117.62 and -116.08 and p_lat between 32.53 and 33.51
$$;

-- Simplified county outline ([lng, lat] ring). MUST match SD_COUNTY_OUTLINE in
-- src/lib/geo/san-diego-county.ts (a test asserts they are identical).
create or replace function private.sd_county_outline()
returns double precision[]
language sql
immutable
set search_path = ''
as $$
  select array[
    [-117.6, 33.386],
    [-117.51, 33.48],
    [-117.37, 33.505],
    [-117.24, 33.452],
    [-117.1, 33.432],
    [-116.95, 33.43],
    [-116.081, 33.427],
    [-116.105, 32.618],
    [-117.124, 32.534],
    [-117.15, 32.58],
    [-117.21, 32.67],
    [-117.265, 32.66],
    [-117.31, 32.78],
    [-117.33, 32.85],
    [-117.32, 32.96],
    [-117.345, 33.05],
    [-117.39, 33.15],
    [-117.46, 33.21],
    [-117.55, 33.3],
    [-117.6, 33.386]
  ]::double precision[]
$$;

-- Ray-casting point-in-polygon against the county outline.
create or replace function private.within_sd_county(p_lng double precision, p_lat double precision)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_ring double precision[] := private.sd_county_outline();
  v_n integer := array_length(v_ring, 1);
  v_inside boolean := false;
  v_j integer;
  xi double precision; yi double precision; xj double precision; yj double precision;
begin
  if p_lng is null or p_lat is null or not private.within_sd_county_bbox(p_lng, p_lat) then
    return false;
  end if;
  v_j := v_n;
  for i in 1..v_n loop
    xi := v_ring[i][1]; yi := v_ring[i][2];
    xj := v_ring[v_j][1]; yj := v_ring[v_j][2];
    if ((yi > p_lat) <> (yj > p_lat)) and (p_lng < (xj - xi) * (p_lat - yi) / (yj - yi) + xi) then
      v_inside := not v_inside;
    end if;
    v_j := i;
  end loop;
  return v_inside;
end;
$$;

create or replace function private.geojson_within_sd_county(p_geojson jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_path jsonpath;
  v_pos jsonb;
  v_count integer := 0;
begin
  if p_geojson is null then
    return true;
  end if;
  if p_geojson ->> 'type' = 'Polygon' then
    v_path := '$.coordinates[*][*]';
  elsif p_geojson ->> 'type' = 'MultiPolygon' then
    v_path := '$.coordinates[*][*][*]';
  else
    return false;
  end if;

  for v_pos in select jsonb_path_query(p_geojson, v_path) loop
    if jsonb_typeof(v_pos) <> 'array' or jsonb_array_length(v_pos) < 2
       or jsonb_typeof(v_pos -> 0) <> 'number' or jsonb_typeof(v_pos -> 1) <> 'number' then
      return false;
    end if;
    if not private.within_sd_county((v_pos ->> 0)::double precision, (v_pos ->> 1)::double precision) then
      return false;
    end if;
    v_count := v_count + 1;
  end loop;

  return v_count >= 4;  -- a closed ring needs at least 4 positions
end;
$$;

-- CHECK constraints execute these as the writing role.
grant execute on function private.is_sd_county_zip(text), private.all_sd_county_zips(text[]),
  private.within_sd_county_bbox(double precision, double precision), private.sd_county_outline(),
  private.within_sd_county(double precision, double precision), private.geojson_within_sd_county(jsonb)
  to anon, authenticated, service_role;

alter table public.zones
  add constraint zones_postal_codes_in_sd_county check (private.all_sd_county_zips(postal_codes)),
  add constraint zones_boundary_in_sd_county check (private.geojson_within_sd_county(boundary));

alter table public.parents
  add constraint parents_postal_code_in_sd_county check (postal_code is null or private.is_sd_county_zip(postal_code)),
  add constraint parents_state_ca check (state is null or state = 'CA'),
  add constraint parents_coords_in_sd_county check (lat is null or lng is null or private.within_sd_county(lng, lat));

alter table public.booking_locations
  add constraint booking_locations_postal_code_in_sd_county check (private.is_sd_county_zip(postal_code)),
  add constraint booking_locations_state_ca check (state = 'CA'),
  add constraint booking_locations_coords_in_sd_county check (lat is null or lng is null or private.within_sd_county(lng, lat));

-- -----------------------------------------------------------------------------
-- Instructor public profile: first name + bio + photo
-- -----------------------------------------------------------------------------
alter table public.instructors rename column display_name to first_name;

update public.instructors set first_name = split_part(first_name, ' ', 1);

alter table public.instructors
  -- Letters, spaces, apostrophes and hyphens only, so the one free-text field
  -- shown next to a photo can't carry a phone number, handle or email.
  add constraint instructors_first_name_format
    check (first_name ~ '^[[:alpha:]][[:alpha:] ''’-]{0,29}$'),
  add constraint instructors_bio_length
    check (bio is null or length(trim(bio)) <= 1200),
  -- Photo must be the instructor's own upload (instructor-photos/<id>/...) or a
  -- bundled image shipped with the app (/seed/...).
  add constraint instructors_photo_path_owned
    check (photo_path is null or photo_path like id::text || '/%' or photo_path like '/seed/instructors/%'),
  -- Parents only ever see active instructors, so every visible card is complete.
  add constraint instructors_profile_complete_when_active
    check (not is_active or (photo_path is not null and length(trim(coalesce(bio, ''))) >= 40));

-- Instructors may edit their own first name now that its format is constrained.
grant update (first_name) on public.instructors to authenticated;

-- Profile completeness, for onboarding checklists.
create or replace function public.instructor_profile_missing(p_instructor_id uuid default null)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select array_remove(array[
    case when i.photo_path is null then 'photo' end,
    case when length(trim(coalesce(i.bio, ''))) < 40 then 'bio' end,
    case when not exists (select 1 from public.instructor_zones z where z.instructor_id = i.id) then 'zones' end,
    case when not exists (select 1 from public.availability_rules r where r.instructor_id = i.id) then 'availability' end
  ], null)
  from public.instructors i
  where i.id = coalesce(p_instructor_id, (select auth.uid()))
    and (i.id = (select auth.uid()) or private.is_admin())
$$;

revoke all on function public.instructor_profile_missing(uuid) from public, anon;
grant execute on function public.instructor_profile_missing(uuid) to authenticated;

-- New-user trigger: write first_name (sanitized — user metadata is untrusted
-- and must never make signup fail on the format constraint).
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
  v_public_first text;
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

    v_public_first := left(trim(regexp_replace(coalesce(v_first, ''), '[^[:alpha:] ''’-]', '', 'g')), 30);
    if v_public_first !~ '^[[:alpha:]]' then
      v_public_first := 'Instructor';
    end if;

    insert into public.instructors (id, first_name, is_active)
    values (new.id, v_public_first, false)
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

revoke all on function private.handle_new_auth_user() from public, anon, authenticated;
