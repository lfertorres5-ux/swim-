-- Starting service zones for a new site (San Diego County). Run ONCE in Supabase → SQL Editor
-- after setup-all.sql. Safe to re-run: existing zones are left alone. Edit later in Admin → Settings → Zones.

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

