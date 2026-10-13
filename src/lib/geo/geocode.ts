import "server-only";

export type GeocodedAddress = {
  line1: string;
  city: string;
  state: string;
  postalCode: string;
  county: string | null;
  neighborhood: string | null;
  lat: number;
  lng: number;
  placeId: string;
  formatted: string;
};

type Component = { long_name: string; short_name: string; types: string[] };

/**
 * Server-side geocoding (Google Geocoding API, GOOGLE_MAPS_SERVER_API_KEY).
 * Returns null when no key is configured (local dev falls back to ZIP checks).
 */
export async function geocode(query: { placeId: string } | { address: string }): Promise<GeocodedAddress | null | "not_found"> {
  const key = process.env.GOOGLE_MAPS_SERVER_API_KEY;
  if (!key) return null;
  const params = new URLSearchParams({ key });
  if ("placeId" in query) params.set("place_id", query.placeId);
  else {
    params.set("address", query.address);
    params.set("components", "country:US|administrative_area:CA");
  }
  const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`geocoding failed: HTTP ${res.status}`);
  const body = (await res.json()) as {
    status: string;
    results: { place_id: string; formatted_address: string; address_components: Component[]; geometry: { location: { lat: number; lng: number } }; types: string[] }[];
  };
  if (body.status === "ZERO_RESULTS" || !body.results.length) return "not_found";
  if (body.status !== "OK") throw new Error(`geocoding failed: ${body.status}`);

  const r = body.results[0];
  const get = (type: string, short = false) => {
    const c = r.address_components.find((x) => x.types.includes(type));
    return c ? (short ? c.short_name : c.long_name) : null;
  };
  const number = get("street_number");
  const route = get("route");
  if (!number || !route) return "not_found"; // need a deliverable street address, not a city or ZIP centroid

  return {
    line1: `${number} ${route}`,
    city: get("locality") ?? get("sublocality") ?? get("postal_town") ?? "",
    state: get("administrative_area_level_1", true) ?? "",
    postalCode: get("postal_code") ?? "",
    county: get("administrative_area_level_2"),
    neighborhood: get("neighborhood") ?? get("sublocality_level_1") ?? get("locality"),
    lat: r.geometry.location.lat,
    lng: r.geometry.location.lng,
    placeId: r.place_id,
    formatted: r.formatted_address,
  };
}
