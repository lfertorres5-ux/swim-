import { SD_COUNTY_OUTLINE, type GeoJsonPolygon, type LngLat } from "@/lib/geo/san-diego-county";

type MapZone = { code: string; name: string; color: string | null; boundary: GeoJsonPolygon | null; travelFeeCents: number };

const W = 520;
const PAD = 12;

/** Static SVG map of the county outline and service zones (no map API needed). */
export function ServiceAreaMap({ zones }: { zones: MapZone[] }) {
  const lngs = SD_COUNTY_OUTLINE.map((p) => p[0]);
  const lats = SD_COUNTY_OUTLINE.map((p) => p[1]);
  const [minLng, maxLng, minLat, maxLat] = [Math.min(...lngs), Math.max(...lngs), Math.min(...lats), Math.max(...lats)];
  const kx = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const scale = (W - 2 * PAD) / ((maxLng - minLng) * kx);
  const H = Math.round((maxLat - minLat) * scale + 2 * PAD);
  const pt = ([lng, lat]: LngLat) => `${(PAD + (lng - minLng) * kx * scale).toFixed(1)},${(PAD + (maxLat - lat) * scale).toFixed(1)}`;
  const ring = (r: LngLat[]) => `M${r.map(pt).join("L")}Z`;
  const rings = (g: GeoJsonPolygon) => (g.type === "Polygon" ? g.coordinates : g.coordinates.flat(1));
  // Label just inside each zone's northernmost point so nested zones stack instead of overlapping.
  const labelAt = (g: GeoJsonPolygon): LngLat => {
    const outer = rings(g)[0];
    const top = outer.reduce((a, b) => (b[1] > a[1] ? b : a));
    return [top[0], top[1] - 14 / scale];
  };
  // Draw outer zones first so the core zone sits on top.
  const drawn = [...zones].filter((z) => z.boundary).sort((a, b) => b.code.localeCompare(a.code));

  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Map of our San Diego County service zones">
        <path d={ring(SD_COUNTY_OUTLINE)} fill="#f1f5f9" stroke="#94a3b8" strokeWidth={1.2} />
        {drawn.map((z) => (
          <path key={z.code} d={rings(z.boundary!).map(ring).join(" ")} fill={z.color ?? "#0ea5e9"} fillOpacity={0.35} stroke={z.color ?? "#0ea5e9"} strokeWidth={1.5} />
        ))}
        {drawn.map((z) => {
          const [x, y] = pt(labelAt(z.boundary!)).split(",").map(Number);
          return (
            <text key={z.code} x={x} y={y} textAnchor="middle" className="fill-slate-800 text-[12px] font-semibold">
              Zone {z.code}
            </text>
          );
        })}
        <text x={PAD + 4} y={H - PAD} className="fill-slate-400 text-[11px]">
          San Diego County · Pacific Ocean ←
        </text>
      </svg>
      <figcaption className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
        {zones.map((z) => (
          <span key={z.code} className="flex items-start gap-2">
            <span className="mt-1 h-3 w-3 shrink-0 rounded-sm" style={{ background: z.color ?? "#0ea5e9" }} />
            <span>
              <strong>Zone {z.code}</strong> · {z.travelFeeCents ? `+$${z.travelFeeCents / 100} travel` : "no travel fee"}
              <span className="block text-slate-500">{z.name}</span>
            </span>
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
