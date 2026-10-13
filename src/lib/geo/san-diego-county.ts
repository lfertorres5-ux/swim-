/**
 * San Diego County service-area rules.
 *
 * Authoritative checks, in order of strength:
 *   1. ZIP prefix 919xx / 920xx / 921xx (USPS SCFs covering exactly San Diego
 *      County). Enforced by Postgres CHECK constraints too.
 *   2. Google geocoder `administrative_area_level_2 === "San Diego County"`
 *      when an address is verified server-side (Phase 3).
 *   3. Simplified county outline below, for zone polygons drawn in admin.
 *      Accurate to roughly ±2 km on the Orange/Riverside/Imperial lines and
 *      deliberately a little generous offshore so coastal homes are never cut.
 */

export type LngLat = [lng: number, lat: number];

export const SD_COUNTY_BBOX = { minLng: -117.62, maxLng: -116.08, minLat: 32.53, maxLat: 33.51 } as const;

/** Simplified San Diego County outline (closed ring, [lng, lat]). */
export const SD_COUNTY_OUTLINE: LngLat[] = [
  [-117.6, 33.386], //  coast at the Orange County line (San Onofre)
  [-117.51, 33.48], //  Orange / Riverside / San Diego corner
  [-117.37, 33.505], // north of De Luz
  [-117.24, 33.452], // south of Temecula
  [-117.1, 33.432],
  [-116.95, 33.43],
  [-116.081, 33.427], // Riverside / Imperial / San Diego corner
  [-116.105, 32.618], // Imperial County line at the border
  [-117.124, 32.534], // Border Field (Pacific at the border)
  [-117.15, 32.58], //  offshore Imperial Beach
  [-117.21, 32.67], //  offshore Coronado
  [-117.265, 32.66], // offshore Point Loma
  [-117.31, 32.78], //  offshore Ocean Beach / Mission Beach
  [-117.33, 32.85], // offshore La Jolla
  [-117.32, 32.96], // offshore Del Mar
  [-117.345, 33.05], // offshore Encinitas
  [-117.39, 33.15], //  offshore Carlsbad
  [-117.46, 33.21], //  offshore Oceanside
  [-117.55, 33.3], //   offshore Camp Pendleton
  [-117.6, 33.386],
];

export function isSanDiegoCountyZip(zip: string | null | undefined): boolean {
  return typeof zip === "string" && /^9(19|20|21)\d{2}$/.test(zip.trim().slice(0, 5));
}

export function withinBbox([lng, lat]: LngLat): boolean {
  const b = SD_COUNTY_BBOX;
  return lng >= b.minLng && lng <= b.maxLng && lat >= b.minLat && lat <= b.maxLat;
}

/** Ray-casting point-in-polygon for a single ring. */
export function pointInRing([x, y]: LngLat, ring: LngLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function withinSanDiegoCounty(point: LngLat): boolean {
  return withinBbox(point) && pointInRing(point, SD_COUNTY_OUTLINE);
}

export type GeoJsonPolygon = { type: "Polygon"; coordinates: LngLat[][] } | { type: "MultiPolygon"; coordinates: LngLat[][][] };

function polygons(g: GeoJsonPolygon): LngLat[][][] {
  return g.type === "Polygon" ? [g.coordinates] : g.coordinates;
}

/** Point inside a (Multi)Polygon, honoring holes. */
export function pointInGeoJson(point: LngLat, g: GeoJsonPolygon): boolean {
  return polygons(g).some(([outer, ...holes]) => pointInRing(point, outer) && !holes.some((h) => pointInRing(point, h)));
}

/** Every vertex of a zone boundary must lie inside the county. Returns offending vertices. */
export function boundaryVerticesOutsideCounty(g: GeoJsonPolygon): LngLat[] {
  return polygons(g)
    .flat(1)
    .flat(0)
    .flatMap((ring) => ring)
    .filter((pt) => !withinSanDiegoCounty(pt));
}

export type ZoneForDetection = {
  id: string;
  code: string;
  isBookable: boolean;
  postalCodes: string[];
  boundary: GeoJsonPolygon | null;
  sortOrder: number;
};

export type ZoneDetection =
  | { ok: true; zone: ZoneForDetection; matchedBy: "postal_code" | "boundary" }
  | { ok: false; reason: "outside_county" | "outside_service_area" | "zone_not_bookable" };

/**
 * Resolve an address to a service zone. Out-of-county addresses are rejected
 * before any zone is considered. Exact ZIP match wins; otherwise the first
 * zone (by sort order) whose polygon contains the point.
 */
export function detectZone(
  address: { postalCode: string; lng?: number | null; lat?: number | null },
  zones: ZoneForDetection[],
): ZoneDetection {
  const zip = address.postalCode.trim().slice(0, 5);
  const point: LngLat | null = address.lng != null && address.lat != null ? [address.lng, address.lat] : null;

  if (!isSanDiegoCountyZip(zip)) return { ok: false, reason: "outside_county" };
  if (point && !withinSanDiegoCounty(point)) return { ok: false, reason: "outside_county" };

  const ordered = [...zones].sort((a, b) => a.sortOrder - b.sortOrder);
  const byZip = ordered.find((z) => z.postalCodes.includes(zip));
  const byShape = point ? ordered.find((z) => z.boundary && pointInGeoJson(point, z.boundary)) : undefined;
  const match = byZip ? { zone: byZip, matchedBy: "postal_code" as const } : byShape ? { zone: byShape, matchedBy: "boundary" as const } : null;

  if (!match) return { ok: false, reason: "outside_service_area" };
  if (!match.zone.isBookable) return { ok: false, reason: "zone_not_bookable" };
  return { ok: true, ...match };
}
