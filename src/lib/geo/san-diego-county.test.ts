import { describe, expect, it } from "vitest";
import {
  boundaryVerticesOutsideCounty,
  detectZone,
  isSanDiegoCountyZip,
  withinSanDiegoCounty,
  type LngLat,
  type ZoneForDetection,
} from "./san-diego-county";

const places: Record<string, LngLat> = {
  encinitas: [-117.2919, 33.0369],
  delMar: [-117.2653, 32.9595],
  carmelValley: [-117.2310, 32.948],
  laJolla: [-117.2713, 32.8328],
  oceanside: [-117.3795, 33.1959],
  fallbrook: [-117.2511, 33.3764],
  chulaVista: [-117.0842, 32.6401],
  borregoSprings: [-116.3747, 33.2559],
  // Outside the county
  sanClemente: [-117.612, 33.4269], //   Orange County
  temecula: [-117.1484, 33.4936], //     Riverside County
  elCentro: [-115.5631, 32.792], //      Imperial County
  tijuana: [-117.0382, 32.5149], //      Mexico
  pacificOffshore: [-117.6, 32.9], //    ocean
};

describe("San Diego County", () => {
  it.each(["92024", "92130", "92101", "91910", "92004", "92028"])("accepts SD County ZIP %s", (zip) => {
    expect(isSanDiegoCountyZip(zip)).toBe(true);
  });

  it.each(["92672", "92592", "92243", "90210", "99999", "9202", ""])("rejects non-county ZIP %s", (zip) => {
    expect(isSanDiegoCountyZip(zip)).toBe(false);
  });

  it.each(["encinitas", "delMar", "carmelValley", "laJolla", "oceanside", "fallbrook", "chulaVista", "borregoSprings"])(
    "%s is inside the county outline",
    (name) => expect(withinSanDiegoCounty(places[name])).toBe(true),
  );

  it.each(["sanClemente", "temecula", "elCentro", "tijuana", "pacificOffshore"])("%s is outside the county outline", (name) => {
    expect(withinSanDiegoCounty(places[name])).toBe(false);
  });

  it("flags zone boundaries that leave the county", () => {
    const ok = { type: "Polygon" as const, coordinates: [[[-117.3, 33.0], [-117.2, 33.0], [-117.2, 33.1], [-117.3, 33.0]] as LngLat[]] };
    const bad = { type: "Polygon" as const, coordinates: [[[-117.3, 33.0], [-117.15, 33.55], [-117.2, 33.1], [-117.3, 33.0]] as LngLat[]] };
    expect(boundaryVerticesOutsideCounty(ok)).toEqual([]);
    expect(boundaryVerticesOutsideCounty(bad)).toEqual([[-117.15, 33.55]]);
  });
});

describe("detectZone", () => {
  const zones: ZoneForDetection[] = [
    { id: "a", code: "A", isBookable: true, sortOrder: 1, postalCodes: ["92024"], boundary: { type: "Polygon", coordinates: [[[-117.32, 33.1], [-117.2, 33.1], [-117.2, 32.9], [-117.32, 32.9], [-117.32, 33.1]]] } },
    { id: "c", code: "C", isBookable: true, sortOrder: 3, postalCodes: ["92057"], boundary: null },
    { id: "x", code: "X", isBookable: false, sortOrder: 4, postalCodes: ["91910"], boundary: null },
  ];

  it("matches by ZIP first", () => {
    expect(detectZone({ postalCode: "92057" }, zones)).toMatchObject({ ok: true, zone: { code: "C" }, matchedBy: "postal_code" });
  });

  it("falls back to the polygon", () => {
    expect(detectZone({ postalCode: "92014", lng: places.delMar[0], lat: places.delMar[1] }, zones)).toMatchObject({
      ok: true,
      zone: { code: "A" },
      matchedBy: "boundary",
    });
  });

  it("rejects anything outside San Diego County before checking zones", () => {
    expect(detectZone({ postalCode: "92672", lng: places.sanClemente[0], lat: places.sanClemente[1] }, zones)).toEqual({ ok: false, reason: "outside_county" });
    // In-county ZIP but coordinates in Riverside County (bad geocode) → still rejected.
    expect(detectZone({ postalCode: "92024", lng: places.temecula[0], lat: places.temecula[1] }, zones)).toEqual({ ok: false, reason: "outside_county" });
  });

  it("distinguishes 'in county but not served' and non-bookable zones", () => {
    expect(detectZone({ postalCode: "92004" }, zones)).toEqual({ ok: false, reason: "outside_service_area" });
    expect(detectZone({ postalCode: "91910" }, zones)).toEqual({ ok: false, reason: "zone_not_bookable" });
  });
});
