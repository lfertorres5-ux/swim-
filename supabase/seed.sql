-- =============================================================================
-- Seed data (local development / preview environments only — never production)
--
-- Logins (magic link; local Supabase captures mail in Mailpit at :54324):
--   owner@example.com                    admin
--   maya@example.com, jordan@example.com, sofia@example.com, tyler@example.com
--                                        instructors
--   emily@example.com, daniel@example.com, priya@example.com,
--   marcus@example.com, hannah@example.com
--                                        parents
--
-- Bookings are placed relative to TODAY in America/Los_Angeles so the
-- day-of address reveal, sub board, and reminders can be exercised at any time.
-- Addresses and phone numbers are fictional (555 numbers).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Configuration
-- -----------------------------------------------------------------------------
insert into public.lesson_prices (duration_minutes, price_cents, label, sort_order) values
  (30, 6500, '30 minutes', 1),
  (60, 9000, '60 minutes', 2),
  (90, 13000, '90 minutes', 3)
on conflict (duration_minutes) do update set price_cents = excluded.price_cents, label = excluded.label;

-- Packages: 6 / 8 / 14 lessons (installed by migration; repeated here so a
-- re-seed resets any local edits).
insert into public.package_offerings (name, lesson_count, discount_pct, validity_days, sort_order) values
  ('6-Lesson Package', 6, 5, 150, 1),
  ('8-Lesson Package', 8, 10, 180, 2),
  ('14-Lesson Package', 14, 15, 270, 3)
on conflict (lesson_count) do update set discount_pct = excluded.discount_pct, name = excluded.name, is_active = true;
update public.package_offerings set is_active = false where lesson_count not in (6, 8, 14);

update public.pricing_config set
  included_children = 2,
  extra_child_cents = 2500,
  recurring_discount_pct = 10,
  neighborhood_discount_cents = 500,
  neighborhood_window_minutes = 60;

update public.platform_settings set
  cancellation_window_hours = 24,
  booking_request_window_hours = 12,
  default_travel_buffer_minutes = 30,
  default_instructor_pay_cents_per_hour = 4000,
  sub_board_requires_approval = true,
  address_hide_after_minutes = 120,
  instructor_terms_version = '2026-10-16',
  support_email = 'hello@example.com';

-- -----------------------------------------------------------------------------
-- Zones — San Diego County only (ZIPs 919xx–921xx; polygons inside the county).
-- Boundaries are approximate; refine in Admin → Zones.
-- Detection order: exact postal code match first, then polygon by sort_order.
-- -----------------------------------------------------------------------------
insert into public.zones (id, code, name, description, travel_fee_cents, min_booking_minutes, postal_codes, neighborhoods, boundary, map_color, sort_order) values
  ('00000000-0000-4000-b000-00000000000a', 'A', 'Coastal North County (Core)',
   'Encinitas, Cardiff, Solana Beach, Del Mar, Carmel Valley, Rancho Santa Fe', 0, 0,
   array['92024','92007','92075','92014','92130','92067','92091'],
   array['Encinitas','Leucadia','Olivenhain','Cardiff-by-the-Sea','Solana Beach','Del Mar','Carmel Valley','Rancho Santa Fe'],
   '{"type":"Polygon","coordinates":[[[-117.315,33.095],[-117.200,33.095],[-117.165,32.980],[-117.190,32.915],[-117.270,32.915],[-117.315,33.095]]]}',
   '#0ea5e9', 1),
  ('00000000-0000-4000-b000-00000000000b', 'B', 'Greater North County',
   'Carlsbad, La Jolla, UTC, Sorrento Valley, Rancho Peñasquitos, 4S Ranch', 1000, 0,
   array['92008','92009','92010','92011','92037','92122','92121','92129','92127'],
   array['Carlsbad','La Costa','La Jolla','University City','Sorrento Valley','Rancho Peñasquitos','4S Ranch'],
   '{"type":"Polygon","coordinates":[[[-117.360,33.180],[-117.100,33.180],[-117.050,32.950],[-117.150,32.820],[-117.290,32.820],[-117.360,33.180]]]}',
   '#22c55e', 2),
  ('00000000-0000-4000-b000-00000000000c', 'C', 'Extended Service Area',
   'Oceanside, Vista, San Marcos, Escondido, Poway, Scripps Ranch, Pacific Beach, Point Loma, Clairemont', 2000, 60,
   array['92054','92056','92057','92058','92081','92083','92084','92069','92078','92025','92026','92027','92029','92064','92131','92109','92106','92107','92117'],
   array['Oceanside','Vista','San Marcos','Escondido','Poway','Scripps Ranch','Pacific Beach','Point Loma','Clairemont'],
   '{"type":"Polygon","coordinates":[[[-117.420,33.280],[-116.980,33.280],[-116.950,32.850],[-117.100,32.700],[-117.250,32.700],[-117.420,33.280]]]}',
   '#f59e0b', 3)
on conflict (id) do nothing;

insert into public.zone_travel_buffers (from_zone_id, to_zone_id, buffer_minutes)
select f.id, t.id,
  case
    when f.code = t.code then 30
    when f.code || t.code in ('AB','BA') then 30
    when f.code || t.code in ('BC','CB') then 40
    else 45
  end
from public.zones f cross join public.zones t
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- People, bookings, money, messages
-- -----------------------------------------------------------------------------
create or replace function pg_temp.seed_user(p_id uuid, p_email text, p_first text, p_last text, p_role text, p_phone text)
returns void language plpgsql as $$
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated', p_email, '', now(),
    jsonb_build_object('provider', 'email', 'providers', array['email'], 'role', p_role),
    jsonb_build_object('first_name', p_first, 'last_name', p_last),
    now(), now(), '', '', '', ''
  ) on conflict (id) do nothing;

  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (p_id::text, p_id, jsonb_build_object('sub', p_id::text, 'email', p_email, 'email_verified', true), 'email', now(), now(), now())
  on conflict (provider_id, provider) do nothing;

  update public.users set phone = p_phone, sms_opt_in = p_phone is not null, onboarded_at = now() where id = p_id;
end $$;

-- Local wall-clock → timestamptz, relative to today in San Diego.
create or replace function pg_temp.la(p_day_offset int, p_time time)
returns timestamptz language sql as $$
  select ((((now() at time zone 'America/Los_Angeles')::date + p_day_offset)::timestamp + p_time) at time zone 'America/Los_Angeles')
$$;

create or replace function pg_temp.years_ago(p_years int, p_extra_days int default 0)
returns date language sql as $$
  select ((now() at time zone 'America/Los_Angeles')::date - make_interval(years => p_years) - make_interval(days => p_extra_days))::date
$$;

do $$
declare
  zone_a constant uuid := '00000000-0000-4000-b000-00000000000a';
  zone_b constant uuid := '00000000-0000-4000-b000-00000000000b';
  zone_c constant uuid := '00000000-0000-4000-b000-00000000000c';

  admin_id constant uuid := '00000000-0000-4000-a000-000000000001';
  maya    constant uuid := '00000000-0000-4000-a000-000000000101';
  jordan  constant uuid := '00000000-0000-4000-a000-000000000102';
  sofia   constant uuid := '00000000-0000-4000-a000-000000000103';
  tyler   constant uuid := '00000000-0000-4000-a000-000000000104';

  emily   constant uuid := '00000000-0000-4000-a000-000000000201';
  daniel  constant uuid := '00000000-0000-4000-a000-000000000202';
  priya   constant uuid := '00000000-0000-4000-a000-000000000203';
  marcus  constant uuid := '00000000-0000-4000-a000-000000000204';
  hannah  constant uuid := '00000000-0000-4000-a000-000000000205';

  c_lucas uuid := '00000000-0000-4000-c000-000000000001';
  c_ava   uuid := '00000000-0000-4000-c000-000000000002';
  c_noah  uuid := '00000000-0000-4000-c000-000000000003';
  c_mia   uuid := '00000000-0000-4000-c000-000000000004';
  c_leo   uuid := '00000000-0000-4000-c000-000000000005';
  c_zoe   uuid := '00000000-0000-4000-c000-000000000006';
  c_eli   uuid := '00000000-0000-4000-c000-000000000007';
  c_sam   uuid := '00000000-0000-4000-c000-000000000008';

  b1 uuid := '00000000-0000-4000-d000-000000000001';
  b2 uuid := '00000000-0000-4000-d000-000000000002';
  b3 uuid := '00000000-0000-4000-d000-000000000003';
  b4 uuid := '00000000-0000-4000-d000-000000000004';
  b5 uuid := '00000000-0000-4000-d000-000000000005';
  b6 uuid := '00000000-0000-4000-d000-000000000006';
  b7 uuid := '00000000-0000-4000-d000-000000000007';
  b8 uuid := '00000000-0000-4000-d000-000000000008';
  b9 uuid := '00000000-0000-4000-d000-000000000009';

  series_emily uuid := '00000000-0000-4000-e000-000000000001';
  pkg_daniel   uuid := '00000000-0000-4000-e000-000000000101';
  payout_maya  uuid := '00000000-0000-4000-e000-000000000201';
  msg_flagged  uuid := '00000000-0000-4000-f000-000000000003';

  today date := (now() at time zone 'America/Los_Angeles')::date;
  v_version text;
begin
  if exists (select 1 from public.users where id = admin_id) then
    raise notice 'seed already applied — skipping people/bookings';
    return;
  end if;

  select instructor_terms_version into v_version from public.platform_settings;

  -- Admin / owner
  perform pg_temp.seed_user(admin_id, 'owner@example.com', 'Alex', 'Morgan', 'admin', '+16195550100');

  -- Instructors (role via app_metadata → trigger creates instructors + instructor_private)
  perform pg_temp.seed_user(maya,   'maya@example.com',   'Maya',   'Reyes',   'instructor', '+16195550111');
  perform pg_temp.seed_user(jordan, 'jordan@example.com', 'Jordan', 'Lee',     'instructor', '+16195550112');
  perform pg_temp.seed_user(sofia,  'sofia@example.com',  'Sofia',  'Alvarez', 'instructor', '+16195550113');
  perform pg_temp.seed_user(tyler,  'tyler@example.com',  'Tyler',  'Brooks',  'instructor', '+16195550114');

  update public.instructors set
    first_name = 'Maya', photo_path = '/seed/instructors/maya.svg',
    bio = 'Former Encinitas YMCA swim lead. I specialize in first-time swimmers and kids who are nervous around water — lots of games, zero pressure.',
    specialties = array['toddlers', 'fearful_swimmers', 'water_safety'],
    min_child_age_months = 6, years_experience = 9, languages = array['English', 'Spanish'],
    is_active = true, sort_order = 1
  where id = maya;
  update public.instructors set
    first_name = 'Jordan', photo_path = '/seed/instructors/jordan.svg',
    bio = 'USA Swimming certified coach and former D1 swimmer. Stroke refinement, flip turns, and getting kids ready for swim team tryouts.',
    specialties = array['stroke_technique', 'swim_team_prep'],
    levels_taught = array['beginner', 'advanced_beginner', 'intermediate', 'advanced', 'stroke_technique']::public.swim_level[],
    min_child_age_months = 48, years_experience = 12, is_active = true, sort_order = 2
  where id = jordan;
  update public.instructors set
    first_name = 'Sofia', photo_path = '/seed/instructors/sofia.svg',
    bio = 'Infant & toddler aquatics specialist with experience teaching children with sensory and developmental differences. Bilingual lessons available.',
    specialties = array['toddlers', 'infant_survival', 'special_needs'],
    min_child_age_months = 6, years_experience = 7, languages = array['English', 'Spanish'],
    is_active = true, sort_order = 3
  where id = sofia;
  update public.instructors set
    first_name = 'Tyler', photo_path = '/seed/instructors/tyler.svg',
    bio = 'Ocean lifeguard turned swim instructor. Patient with fearful swimmers of every age, including tweens who want to catch up with friends.',
    specialties = array['fearful_swimmers', 'water_safety', 'older_beginners'],
    min_child_age_months = 36, years_experience = 6, is_active = true, sort_order = 4
  where id = tyler;

  update public.instructor_private set pay_rate_cents_per_hour = 4500 where instructor_id = jordan;

  insert into public.instructor_terms_acceptances (instructor_id, terms_version, accepted_at)
  select i, v_version, now() - interval '30 days' from unnest(array[maya, jordan, sofia, tyler]) as i;

  insert into public.instructor_zones (instructor_id, zone_id) values
    (maya, zone_a), (maya, zone_b),
    (jordan, zone_a), (jordan, zone_b), (jordan, zone_c),
    (sofia, zone_a),
    (tyler, zone_b), (tyler, zone_c);

  insert into public.instructor_certifications (instructor_id, kind, issuer, issued_on, expires_on, verified_at, verified_by) values
    (maya,   'cpr',                     'American Red Cross', today - 300, today + 430, now(), admin_id),
    (maya,   'water_safety_instructor', 'American Red Cross', today - 500, today + 230, now(), admin_id),
    (jordan, 'cpr',                     'American Red Cross', today - 100, today + 630, now(), admin_id),
    (jordan, 'lifeguard',               'American Red Cross', today - 100, today + 630, now(), admin_id),
    (jordan, 'swim_instructor',         'USA Swimming',       today - 200, today + 165, now(), admin_id),
    (sofia,  'cpr',                     'American Heart Association', today - 50, today + 680, now(), admin_id),
    (sofia,  'swim_instructor',         'Infant Swimming Resource', today - 400, today + 330, now(), admin_id),
    (tyler,  'lifeguard',               'California State Parks', today - 340, today + 25, now(), admin_id),  -- expiring soon
    (tyler,  'cpr',                     'American Red Cross', today - 700, today + 20,  now(), admin_id);    -- expiring soon

  -- Weekly availability (0 = Sunday)
  insert into public.availability_rules (instructor_id, weekday, start_time, end_time, effective_from)
  select maya, d, time '09:00', time '13:00', today - 60 from unnest(array[1,2,3,4,5]) d
  union all select maya, 6, '08:00', '12:00', today - 60
  union all select jordan, d, '15:00', '19:00', today - 60 from unnest(array[2,4]) d
  union all select jordan, d, '09:00', '14:00', today - 60 from unnest(array[0,6]) d
  union all select sofia, d, '14:00', '19:00', today - 60 from unnest(array[1,3,5]) d
  union all select tyler, d, '10:00', '18:00', today - 60 from unnest(array[1,2,3,4,5,6]) d;

  insert into public.availability_overrides (instructor_id, date, kind, note) values
    (sofia, today + 10, 'blackout', 'Family wedding');
  insert into public.availability_overrides (instructor_id, date, kind, start_time, end_time, note) values
    (jordan, today + 5, 'available', '07:00', '09:00', 'Extra early slots');

  -- Parents
  perform pg_temp.seed_user(emily,  'emily@example.com',  'Emily',  'Carter',  'parent', '+17605550121');
  perform pg_temp.seed_user(daniel, 'daniel@example.com', 'Daniel', 'Kim',     'parent', '+18585550122');
  perform pg_temp.seed_user(priya,  'priya@example.com',  'Priya',  'Shah',    'parent', '+18585550123');
  perform pg_temp.seed_user(marcus, 'marcus@example.com', 'Marcus', 'Johnson', 'parent', '+17605550124');
  perform pg_temp.seed_user(hannah, 'hannah@example.com', 'Hannah', 'Lopez',   'parent', null);

  update public.parents set address_line1 = '742 Neptune Ave', city = 'Encinitas', postal_code = '92024',
    lat = 33.0606, lng = -117.3007, zone_id = zone_a, neighborhood = 'Leucadia',
    access_notes = 'Side gate code 4821. Pool is behind the garage.',
    favorite_instructor_id = maya, preferred_days = array[1,3], preferred_time_windows = '[{"start":"09:00","end":"12:00"}]'
  where id = emily;
  update public.parents set address_line1 = '5510 Seagrove Ct', city = 'San Diego', postal_code = '92130',
    lat = 32.9480, lng = -117.2310, zone_id = zone_a, neighborhood = 'Carmel Valley',
    preferred_days = array[2,4], preferred_time_windows = '[{"start":"15:00","end":"18:00"}]'
  where id = daniel;
  update public.parents set address_line1 = '1820 Ocean Bluff Way', city = 'Del Mar', postal_code = '92014',
    lat = 32.9595, lng = -117.2650, zone_id = zone_a, neighborhood = 'Del Mar',
    access_notes = 'Community pool — meet at clubhouse entrance.'
  where id = priya;
  update public.parents set address_line1 = '3305 Avenida Del Sol', city = 'Carlsbad', postal_code = '92009',
    lat = 33.0910, lng = -117.2660, zone_id = zone_b, neighborhood = 'La Costa'
  where id = marcus;
  update public.parents set address_line1 = '901 Harbor View Ln', city = 'Oceanside', postal_code = '92057',
    lat = 33.2350, lng = -117.3200, zone_id = zone_c, neighborhood = 'Oceanside'
  where id = hannah;

  insert into public.children (id, parent_id, first_name, birth_date, swim_level, notes) values
    (c_lucas, emily,  'Lucas', pg_temp.years_ago(5, 40),  'beginner',          'Loves diving for rings. Needs reminders to keep chin down.'),
    (c_ava,   emily,  'Ava',   pg_temp.years_ago(3, 100), 'water_acclimation', 'A little nervous getting her face wet.'),
    (c_noah,  daniel, 'Noah',  pg_temp.years_ago(8, 10),  'intermediate',      'Working toward swim team tryouts.'),
    (c_mia,   priya,  'Mia',   pg_temp.years_ago(6, 200), 'advanced_beginner', null),
    (c_leo,   priya,  'Leo',   pg_temp.years_ago(4, 60),  'beginner',          'Mild peanut allergy (no snacks needed).'),
    (c_zoe,   priya,  'Zoe',   pg_temp.years_ago(9, 5),   'intermediate',      null),
    (c_eli,   marcus, 'Eli',   pg_temp.years_ago(7, 30),  'beginner',          'Fearful after a scare at the beach last summer — go slow.'),
    (c_sam,   hannah, 'Sam',   pg_temp.years_ago(10, 90), 'stroke_technique',  'Wants to improve breaststroke kick.');

  -- Recurring series & package
  insert into public.booking_series (id, parent_id, instructor_id, zone_id, weekday, start_time, duration_minutes, children_count, starts_on, discount_pct, status)
  values (series_emily, emily, maya, zone_a, extract(dow from today)::smallint, '09:00', 30, 2, today - 7, 10, 'active');

  insert into public.packages (id, parent_id, offering_id, lesson_count, lessons_remaining, duration_minutes, children_count, zone_id, unit_price_cents, discount_pct, total_cents, status, purchased_at, expires_at)
  select pkg_daniel, daniel, o.id, 8, 7, 60, 1, zone_a, 9000, 10, 64800, 'active', now() - interval '10 days', now() + interval '170 days'
  from public.package_offerings o where o.lesson_count = 8;

  -- Bookings
  insert into public.bookings (id, parent_id, instructor_id, requested_instructor_id, zone_id, neighborhood, starts_at, ends_at, status, kind, series_id, package_id, children_count, is_neighborhood_slot, confirmed_at, completed_at, cancelled_at, cancelled_by, cancellation_reason, created_by) values
    (b1, emily,  maya,   maya,   zone_a, 'Leucadia',      pg_temp.la(0, '09:00'),  pg_temp.la(0, '09:30'),  'confirmed', 'recurring', series_emily, null, 2, false, now() - interval '7 days', null, null, null, null, emily),
    (b2, priya,  maya,   null,   zone_a, 'Del Mar',       pg_temp.la(0, '10:30'),  pg_temp.la(0, '11:30'),  'confirmed', 'single',    null, null, 3, true,  now() - interval '3 days', null, null, null, null, priya),
    (b3, daniel, jordan, jordan, zone_a, 'Carmel Valley', pg_temp.la(1, '16:00'),  pg_temp.la(1, '17:00'),  'confirmed', 'package',   null, pkg_daniel, 1, false, now() - interval '9 days', null, null, null, null, daniel),
    (b4, marcus, tyler,  null,   zone_b, 'La Costa',      pg_temp.la(2, '11:00'),  pg_temp.la(2, '12:00'),  'confirmed', 'single',    null, null, 1, false, now() - interval '2 days', null, null, null, null, marcus),
    (b5, hannah, jordan, jordan, zone_c, 'Oceanside',     pg_temp.la(3, '10:00'),  pg_temp.la(3, '11:00'),  'confirmed', 'single',    null, null, 1, false, now() - interval '1 day',  null, null, null, null, hannah),
    (b6, emily,  maya,   maya,   zone_a, 'Leucadia',      pg_temp.la(-7, '09:00'), pg_temp.la(-7, '09:30'), 'completed', 'recurring', series_emily, null, 2, false, now() - interval '14 days', pg_temp.la(-7, '09:35'), null, null, null, emily),
    (b7, daniel, jordan, jordan, zone_a, 'Carmel Valley', pg_temp.la(-5, '16:00'), pg_temp.la(-5, '17:00'), 'cancelled', 'single',    null, null, 1, false, now() - interval '12 days', null, now() - interval '6 days', daniel, 'Sick kid', daniel),
    (b8, emily,  maya,   maya,   zone_a, 'Leucadia',      pg_temp.la(7, '09:00'),  pg_temp.la(7, '09:30'),  'confirmed', 'recurring', series_emily, null, 2, false, now() - interval '7 days', null, null, null, null, emily),
    (b9, marcus, tyler,  null,   zone_b, 'La Costa',      pg_temp.la(4, '14:00'),  pg_temp.la(4, '14:30'),  'pending_instructor', 'single', null, null, 1, false, null, null, null, null, null, marcus);

  insert into public.booking_children (booking_id, child_id) values
    (b1, c_lucas), (b1, c_ava),
    (b2, c_mia), (b2, c_leo), (b2, c_zoe),
    (b3, c_noah),
    (b4, c_eli),
    (b5, c_sam),
    (b6, c_lucas), (b6, c_ava),
    (b7, c_noah),
    (b8, c_lucas), (b8, c_ava),
    (b9, c_eli);

  insert into public.booking_locations (booking_id, address_line1, city, postal_code, lat, lng, access_notes)
  select b.id, p.address_line1, p.city, p.postal_code, p.lat, p.lng, p.access_notes
  from public.bookings b join public.parents p on p.id = b.parent_id;

  insert into public.booking_pricing (booking_id, base_cents, extra_children_cents, travel_fee_cents, neighborhood_discount_cents, package_discount_cents, series_discount_cents, total_cents) values
    (b1, 6500, 0,    0,    0,   0,   650, 5850),
    (b2, 9000, 2500, 0,    500, 0,   0,   11000),
    (b3, 9000, 0,    0,    0,   900, 0,   8100),
    (b4, 9000, 0,    1000, 0,   0,   0,   10000),
    (b5, 9000, 0,    2000, 0,   0,   0,   11000),
    (b6, 6500, 0,    0,    0,   0,   650, 5850),
    (b7, 9000, 0,    0,    0,   0,   0,   9000),
    (b8, 6500, 0,    0,    0,   0,   650, 5850),
    (b9, 6500, 0,    1000, 0,   0,   0,   7500);

  -- Payments (package bookings are covered by the package payment)
  insert into public.payments (parent_id, booking_id, package_id, series_id, amount_cents, refunded_cents, status, description, stripe_payment_intent_id) values
    (emily,  b1,   null,       series_emily, 5850,  0,    'succeeded', 'Weekly lesson (recurring)', 'pi_seed_b1'),
    (priya,  b2,   null,       null,         11000, 0,    'succeeded', '60-min lesson, 3 swimmers', 'pi_seed_b2'),
    (daniel, null, pkg_daniel, null,         64800, 0,    'succeeded', '8-Lesson Package (60 min)', 'pi_seed_pkg'),
    (marcus, b4,   null,       null,         10000, 0,    'succeeded', '60-min lesson', 'pi_seed_b4'),
    (hannah, b5,   null,       null,         11000, 0,    'succeeded', '60-min lesson', 'pi_seed_b5'),
    (emily,  b6,   null,       series_emily, 5850,  0,    'succeeded', 'Weekly lesson (recurring)', 'pi_seed_b6'),
    (daniel, b7,   null,       null,         9000,  9000, 'refunded',  '60-min lesson (cancelled)', 'pi_seed_b7'),
    (emily,  b8,   null,       series_emily, 5850,  0,    'succeeded', 'Weekly lesson (recurring)', 'pi_seed_b8'),
    (marcus, b9,   null,       null,         7500,  0,    'succeeded', '30-min lesson', 'pi_seed_b9');

  -- Link each lesson to the payment that paid for it (refunds look this up).
  update public.bookings b set payment_id = p.id
  from public.payments p where p.booking_id = b.id;

  -- Instructor pay
  insert into public.instructor_payouts (id, instructor_id, amount_cents, period_start, period_end, paid_at, method, reference)
  values (payout_maya, maya, 2000, today - 14, today - 1, now() - interval '1 day', 'direct_deposit', 'ACH-SEED-0001');

  insert into public.instructor_earnings (instructor_id, booking_id, minutes, rate_cents_per_hour, amount_cents, status, earned_on, payout_id)
  values (maya, b6, 30, 4000, 2000, 'paid', today - 7, payout_maya);

  -- Progress note on the completed lesson
  insert into public.lesson_notes (booking_id, instructor_id, skills, summary, next_focus) values
    (b6, maya,
     '{"Lucas": {"front_float": "mastered", "kicking_on_board": "progressing", "submerge_face": "mastered"}, "Ava": {"blowing_bubbles": "progressing", "back_float_assisted": "introduced"}}',
     'Great energy today! Lucas floated on his own for 5 seconds. Ava blew bubbles with her face in the water twice.',
     'Lucas: flutter kick with board across the pool. Ava: comfortable back float with support.');

  -- Booking request awaiting Tyler (non-identifying summary only)
  insert into public.booking_offers (booking_id, instructor_id, rank, status, lesson_summary, offered_at, expires_at)
  values (b9, tyler, 1, 'pending',
          jsonb_build_object('zone', 'B', 'neighborhood', 'La Costa', 'duration_minutes', 30,
                             'swimmers', jsonb_build_array(jsonb_build_object('age', 7, 'swim_level', 'beginner'))),
          now() - interval '1 hour', now() + interval '11 hours');

  -- Sub board: Tyler released b4
  insert into public.open_shifts (booking_id, released_by, reason, status, zone_id, neighborhood, starts_at, ends_at, lesson_summary)
  select b.id, tyler, 'Dentist appointment', 'open', b.zone_id, b.neighborhood, b.starts_at, b.ends_at,
         jsonb_build_object('duration_minutes', 60, 'swimmers', jsonb_build_array(jsonb_build_object('age', 7, 'swim_level', 'beginner')))
  from public.bookings b where b.id = b4;

  -- Chat (sender_role filled by trigger). Seeds bypass the Phase 4 filter, so
  -- the flagged example is written already redacted, with its moderation row.
  insert into public.messages (booking_id, sender_id, body, created_at) values
    (b1, emily, 'Hi Maya! Lucas is so excited for today. Gate code is in the booking notes.', now() - interval '20 hours'),
    (b1, maya,  'Can''t wait! I''ll bring the dive rings.', now() - interval '19 hours');
  insert into public.messages (id, booking_id, sender_id, body, is_flagged, created_at) values
    (msg_flagged, b2, maya, 'If it''s easier you can text me at [contact info removed] and pay me on [payment app removed] next time', true, now() - interval '2 hours');
  insert into public.flagged_messages (source, message_id, booking_id, sender_id, sender_role, original_body, redacted_body, reasons, matches)
  values ('message', msg_flagged, b2, maya, 'instructor',
          'If it''s easier you can text me at 619-555-0111 and pay me on venmo next time',
          'If it''s easier you can text me at [contact info removed] and pay me on [payment app removed] next time',
          array['phone', 'payment_app']::public.flag_reason[], array['619-555-0111', 'venmo']);

  -- Partner Club Day Pass inquiries
  insert into public.day_pass_inquiries (parent_id, contact_name, contact_email, contact_phone, adults_count, children_count, preferred_dates, interest_level, message, status) values
    (priya, 'Priya Shah', 'priya@example.com', '+18585550123', 2, 3, array[today + 12, today + 13], 'ready_to_book', 'Would love a pool day for the kids'' end-of-session celebration.', 'new'),
    (null, 'Chris Patel', 'chris.patel@example.com', null, 2, 1, array[today + 20], 'just_curious', 'Is lunch included?', 'contacted');

  -- Admin extras
  insert into public.discount_codes (code, description, percent_off, applies_to, max_redemptions, valid_until)
  values ('WELCOME10', '10% off your first lesson', 10, array['single']::public.booking_kind[], 500, now() + interval '90 days');

  insert into public.webhooks (url, description, events, is_active, created_by)
  values ('https://hooks.zapier.com/hooks/catch/000000/example/', 'Example Zapier hook (disabled)', array['booking.created', 'booking.cancelled'], false, admin_id);

  insert into public.instructor_invites (email, invited_by, pay_rate_cents_per_hour)
  values ('new.instructor@example.com', admin_id, 4000);
end $$;
