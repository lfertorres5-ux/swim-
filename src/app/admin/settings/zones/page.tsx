import { ActionForm, Field } from "@/components/action-form";
import { ServiceAreaMap } from "@/components/landing/service-area-map";
import type { GeoJsonPolygon } from "@/lib/geo/san-diego-county";
import { createClient } from "@/lib/supabase/server";
import { saveTravelBuffers, saveZone } from "../actions";

type Zone = { id: string; code: string; name: string; description: string | null; travel_fee_cents: number; min_booking_minutes: number; is_bookable: boolean; postal_codes: string[]; neighborhoods: string[]; boundary: GeoJsonPolygon | null; map_color: string | null; sort_order: number };

function ZoneForm({ z }: { z?: Zone }) {
  return (
    <ActionForm action={saveZone} submitLabel={z ? "Save zone" : "Create zone"} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {z && <input type="hidden" name="id" value={z.id} />}
      <input type="hidden" name="sort_order" value={z?.sort_order ?? 0} />
      <Field label="Code">
        <input name="code" className="input" defaultValue={z?.code} maxLength={4} required />
      </Field>
      <Field label="Name">
        <input name="name" className="input" defaultValue={z?.name} required />
      </Field>
      <Field label="Travel fee ($)">
        <input name="travel_fee" className="input" inputMode="decimal" defaultValue={z ? z.travel_fee_cents / 100 : 0} />
      </Field>
      <Field label="Shortest lesson (min)" hint="0 = any length">
        <input name="min_booking_minutes" className="input" inputMode="numeric" defaultValue={z?.min_booking_minutes ?? 0} />
      </Field>
      <Field label="ZIP codes" hint="San Diego County only (919xx–921xx), comma-separated" className="sm:col-span-2">
        <textarea name="postal_codes" rows={2} className="input font-mono" defaultValue={z?.postal_codes.join(", ")} />
      </Field>
      <Field label="Neighborhoods" hint="Comma-separated" className="sm:col-span-2">
        <textarea name="neighborhoods" rows={2} className="input" defaultValue={z?.neighborhoods.join(", ")} />
      </Field>
      <Field label="Description" className="sm:col-span-2">
        <input name="description" className="input" defaultValue={z?.description ?? ""} />
      </Field>
      <Field label="Map color">
        <input name="map_color" type="color" className="input h-11 p-1" defaultValue={z?.map_color ?? "#2b8a8f"} />
      </Field>
      <label className="flex items-center gap-2 pt-6 text-sm">
        <input type="checkbox" name="is_bookable" defaultChecked={z?.is_bookable ?? true} /> Taking bookings
      </label>
      <details className="sm:col-span-2 lg:col-span-4">
        <summary className="cursor-pointer text-sm font-medium text-brand-700">Map boundary (advanced)</summary>
        <Field label="GeoJSON Polygon / MultiPolygon" hint="Paste from geojson.io. Every point must be inside San Diego County. Leave as-is to keep the current boundary." className="mt-2">
          <textarea name="boundary" rows={5} className="input font-mono text-xs" defaultValue={z?.boundary ? JSON.stringify(z.boundary) : ""} />
        </Field>
      </details>
    </ActionForm>
  );
}

export default async function Zones() {
  const supabase = await createClient();
  const [{ data: zones }, { data: buffers }, { data: settings }] = await Promise.all([
    supabase.from("zones").select("*").order("sort_order").order("code"),
    supabase.from("zone_travel_buffers").select("*"),
    supabase.from("platform_settings").select("default_travel_buffer_minutes").single(),
  ]);
  const list = (zones ?? []) as Zone[];
  const buffer = (a: string, b: string) => buffers?.find((x) => x.from_zone_id === a && x.to_zone_id === b)?.buffer_minutes;

  return (
    <div className="space-y-6">
      <section className="card">
        <ServiceAreaMap zones={list.map((z) => ({ code: z.code, name: z.name, color: z.map_color, boundary: z.boundary, travelFeeCents: z.travel_fee_cents }))} />
      </section>
      {list.map((z) => (
        <section key={z.id} className="card">
          <h2 className="mb-3 font-semibold">
            Zone {z.code} · {z.name}
          </h2>
          <ZoneForm z={z} />
        </section>
      ))}
      <section className="card">
        <h2 className="font-semibold">Travel time between zones</h2>
        <p className="mt-1 text-sm text-stone-500">Minutes an instructor needs between back-to-back lessons. Blank uses the default ({settings?.default_travel_buffer_minutes ?? 30} min).</p>
        <ActionForm action={saveTravelBuffers} className="mt-4 space-y-3">
          <div className="overflow-x-auto">
            <table className="text-sm">
              <thead>
                <tr>
                  <th className="p-2 text-left font-medium text-stone-500">From ↓ To →</th>
                  {list.map((z) => (
                    <th key={z.id} className="p-2 font-medium">
                      {z.code}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.map((from) => (
                  <tr key={from.id}>
                    <th className="p-2 text-left font-medium">{from.code}</th>
                    {list.map((to) => (
                      <td key={to.id} className="p-1">
                        <input name={`buffer:${from.id}:${to.id}`} className="input w-20 text-center" inputMode="numeric" defaultValue={buffer(from.id, to.id) ?? ""} placeholder={String(settings?.default_travel_buffer_minutes ?? 30)} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ActionForm>
      </section>
      <section className="card">
        <h2 className="mb-3 font-semibold">Add a zone</h2>
        <ZoneForm />
      </section>
    </div>
  );
}
