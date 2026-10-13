import "server-only";
import { z } from "zod";
import { detectZone, isSanDiegoCountyZip, type GeoJsonPolygon, type ZoneForDetection } from "@/lib/geo/san-diego-county";
import { geocode } from "@/lib/geo/geocode";
import { createAdminClient } from "@/lib/supabase/admin";

export const addressInputSchema = z.object({
  placeId: z.string().max(300).optional(),
  line1: z.string().trim().min(3, "Enter a street address").max(120),
  line2: z.string().trim().max(60).optional(),
  city: z.string().trim().max(60).optional(),
  postalCode: z.string().trim().max(10).optional(),
  accessNotes: z.string().trim().max(500).optional(),
});
export type AddressInput = z.infer<typeof addressInputSchema>;

export type VerifiedAddress = {
  line1: string;
  line2: string | null;
  city: string;
  postalCode: string;
  lat: number | null;
  lng: number | null;
  placeId: string | null;
  neighborhood: string | null;
  accessNotes: string | null;
  zone: { id: string; code: string; name: string; travelFeeCents: number; minBookingMinutes: number };
  /** True when Google confirmed the address; false in keyless local dev (ZIP-only). */
  geocoded: boolean;
};

export type AddressCheck =
  | { ok: true; address: VerifiedAddress }
  | { ok: false; reason: "not_found" | "outside_county" | "outside_service_area" | "zone_not_bookable"; message: string };

const MESSAGES: Record<Exclude<AddressCheck, { ok: true }>["reason"], string> = {
  not_found: "We couldn't find that street address. Please check it and try again.",
  outside_county: "We only teach in San Diego County.",
  outside_service_area: "That address is outside our current service area. Join the waitlist and we'll let you know when we expand.",
  zone_not_bookable: "We're not booking lessons in that area right now.",
};

export async function loadZonesForDetection() {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("zones")
    .select("id, code, name, is_bookable, postal_codes, boundary, sort_order, travel_fee_cents, min_booking_minutes");
  if (error) throw new Error(error.message);
  return data.map((z) => ({
    id: z.id as string,
    code: z.code as string,
    name: z.name as string,
    isBookable: z.is_bookable as boolean,
    postalCodes: z.postal_codes as string[],
    boundary: (z.boundary as GeoJsonPolygon | null) ?? null,
    sortOrder: z.sort_order as number,
    travelFeeCents: z.travel_fee_cents as number,
    minBookingMinutes: z.min_booking_minutes as number,
  }));
}

/**
 * Confirm an address is a real San Diego County street address inside a
 * bookable zone. The zone always comes from this server-side check — never
 * from the client.
 */
export async function verifyAddress(input: AddressInput): Promise<AddressCheck> {
  const zones = await loadZonesForDetection();
  const geo = await geocode(input.placeId ? { placeId: input.placeId } : { address: [input.line1, input.city, "CA", input.postalCode].filter(Boolean).join(", ") });
  if (geo === "not_found") return { ok: false, reason: "not_found", message: MESSAGES.not_found };

  let base: Omit<VerifiedAddress, "zone" | "accessNotes" | "line2">;
  if (geo) {
    if (geo.state !== "CA" || geo.county !== "San Diego County") return { ok: false, reason: "outside_county", message: MESSAGES.outside_county };
    base = { line1: geo.line1, city: geo.city, postalCode: geo.postalCode, lat: geo.lat, lng: geo.lng, placeId: geo.placeId, neighborhood: geo.neighborhood, geocoded: true };
  } else {
    const zip = (input.postalCode ?? "").slice(0, 5);
    if (!/^\d{5}$/.test(zip) || !input.city) return { ok: false, reason: "not_found", message: "Enter the city and 5-digit ZIP code." };
    if (!isSanDiegoCountyZip(zip)) return { ok: false, reason: "outside_county", message: MESSAGES.outside_county };
    base = { line1: input.line1, city: input.city, postalCode: zip, lat: null, lng: null, placeId: null, neighborhood: input.city, geocoded: false };
  }

  const detection = detectZone({ postalCode: base.postalCode, lat: base.lat, lng: base.lng }, zones as ZoneForDetection[]);
  if (!detection.ok) return { ok: false, reason: detection.reason, message: MESSAGES[detection.reason] };
  const zone = zones.find((z) => z.id === detection.zone.id)!;

  return {
    ok: true,
    address: {
      ...base,
      line2: input.line2 || null,
      accessNotes: input.accessNotes || null,
      zone: { id: zone.id, code: zone.code, name: zone.name, travelFeeCents: zone.travelFeeCents, minBookingMinutes: zone.minBookingMinutes },
    },
  };
}
