"use client";

import { useState } from "react";

type Zone = { code: string; name: string; travelFeeCents: number; minBookingMinutes: number; postalCodes: string[] };

/** Instant ZIP lookup against the public zone list (the booking flow re-verifies the full address). */
export function ZipChecker({ zones }: { zones: Zone[] }) {
  const [zip, setZip] = useState("");
  const z = zip.length === 5 ? zones.find((x) => x.postalCodes.includes(zip)) : undefined;
  const inCounty = /^9(19|20|21)\d{2}$/.test(zip);

  return (
    <div className="rounded-2xl bg-white/80 p-4 shadow-sm ring-1 ring-sky-100 backdrop-blur">
      <label className="text-sm font-medium text-slate-700" htmlFor="zip">
        Do we come to you?
      </label>
      <div className="mt-2 flex gap-2">
        <input id="zip" inputMode="numeric" maxLength={5} placeholder="Your ZIP code" value={zip} onChange={(e) => setZip(e.target.value.replace(/\D/g, ""))} className="input max-w-[10rem]" />
      </div>
      <p className="mt-2 min-h-5 text-sm" aria-live="polite">
        {zip.length === 5 &&
          (z ? (
            <span className="text-emerald-700">
              ✓ Yes — Zone {z.code} ({z.name}). {z.travelFeeCents ? `$${z.travelFeeCents / 100} travel fee.` : "No travel fee."}
              {z.minBookingMinutes ? ` ${z.minBookingMinutes}-minute minimum.` : ""}
            </span>
          ) : inCounty ? (
            <span className="text-slate-600">We may still reach you — enter your full address when booking and we&apos;ll check.</span>
          ) : (
            <span className="text-slate-600">Sorry — we only teach in San Diego County.</span>
          ))}
      </p>
    </div>
  );
}
