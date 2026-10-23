"use client";

import Link from "next/link";
import { useState } from "react";

type Zone = { code: string; name: string; travelFeeCents: number; minBookingMinutes: number; postalCodes: string[] };

/** Instant ZIP lookup against the public zone list (booking re-verifies the full address). */
export function ZipChecker({ zones }: { zones: Zone[] }) {
  const [zip, setZip] = useState("");
  const z = zip.length === 5 ? zones.find((x) => x.postalCodes.includes(zip)) : undefined;
  const inCounty = /^9(19|20|21)\d{2}$/.test(zip);

  return (
    <div>
      <div className="flex gap-2 rounded-full bg-white p-1.5 shadow-sm ring-1 ring-stone-200">
        <input
          inputMode="numeric"
          maxLength={5}
          placeholder="Your ZIP code"
          aria-label="Your ZIP code"
          value={zip}
          onChange={(e) => setZip(e.target.value.replace(/\D/g, ""))}
          className="min-w-0 flex-1 rounded-full bg-transparent px-4 text-base outline-none"
        />
        <Link href="/book" className="btn-primary">
          Book a lesson
        </Link>
      </div>
      <p className="mt-3 min-h-6 px-2 text-sm" aria-live="polite">
        {zip.length === 5 &&
          (z ? (
            <span className="text-brand-800">
              Yes, we come to you. {z.travelFeeCents ? `$${z.travelFeeCents / 100} travel fee per lesson.` : "No travel fee."}
            </span>
          ) : inCounty ? (
            <span className="text-stone-600">We might. Enter your address when you book and we&apos;ll check.</span>
          ) : (
            <span className="text-stone-600">Sorry, we only teach in San Diego County.</span>
          ))}
      </p>
    </div>
  );
}
