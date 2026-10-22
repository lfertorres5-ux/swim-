"use client";

import Link from "next/link";
import { useState } from "react";

type Zone = { code: string; name: string; travelFeeCents: number; minBookingMinutes: number; postalCodes: string[]; neighborhoods: string[]; color: string | null };

const money = (c: number) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;
const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");

/**
 * "Do you come to me?" — search by ZIP or neighborhood name against the
 * public zone list. Booking still verifies the exact address.
 */
export function AreaSearch({ zones }: { zones: Zone[] }) {
  const [q, setQ] = useState("");
  const query = q.trim();
  const isZip = /^\d+$/.test(query);

  const result = (() => {
    if (!query) return null;
    if (isZip) {
      if (query.length < 5) return null;
      const zone = zones.find((z) => z.postalCodes.includes(query));
      if (zone) return { kind: "yes" as const, zone, place: query };
      return { kind: /^9(19|20|21)\d{2}$/.test(query) ? ("maybe" as const) : ("no" as const) };
    }
    if (query.length < 3) return null;
    const n = norm(query);
    for (const zone of zones) {
      const place = zone.neighborhoods.find((h) => norm(h).includes(n) || n.includes(norm(h)));
      if (place) return { kind: "yes" as const, zone, place };
    }
    return { kind: "maybe" as const };
  })();

  return (
    <div>
      <label htmlFor="area-search" className="sr-only">
        ZIP code or neighborhood
      </label>
      <div className="flex items-center gap-2 rounded-2xl bg-white p-2 shadow-sm ring-1 ring-stone-200 focus-within:ring-2 focus-within:ring-brand-400">
        <svg aria-hidden viewBox="0 0 24 24" className="ml-2 h-5 w-5 shrink-0 text-stone-400" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
        <input
          id="area-search"
          value={q}
          onChange={(e) => setQ(e.target.value.slice(0, 40))}
          placeholder="ZIP code or neighborhood, e.g. 92024 or Del Mar"
          autoComplete="postal-code"
          className="min-w-0 flex-1 bg-transparent py-2.5 text-base outline-none placeholder:text-stone-400"
        />
        {q && (
          <button type="button" onClick={() => setQ("")} className="rounded-full px-2 text-sm text-stone-400 hover:text-stone-700" aria-label="Clear">
            ✕
          </button>
        )}
      </div>

      <div aria-live="polite" className="mt-4 min-h-[7.5rem]">
        {result?.kind === "yes" && (
          <div key={result.place} className="animate-step-in rounded-2xl bg-brand-700 p-5 text-white">
            <p className="text-sm text-brand-200">Good news</p>
            <p className="mt-0.5 font-display text-2xl font-semibold text-white">We come to {result.place}!</p>
            <p className="mt-2 text-sm text-brand-100">
              {result.zone.name} · {result.zone.travelFeeCents ? `${money(result.zone.travelFeeCents)} travel fee per lesson` : "no travel fee"}
              {result.zone.minBookingMinutes ? ` · lessons from ${result.zone.minBookingMinutes} min` : ""}
            </p>
            <Link href="/book" className="mt-4 inline-flex rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-brand-800 transition hover:bg-brand-50">
              Find a time →
            </Link>
          </div>
        )}
        {result?.kind === "maybe" && (
          <div className="animate-step-in rounded-2xl bg-white p-5 ring-1 ring-stone-200">
            <p className="font-semibold text-stone-900">We might — let&apos;s check your address.</p>
            <p className="mt-1 text-sm text-stone-600">That&apos;s in San Diego County but not on our list yet. Start a booking and we&apos;ll check your exact address, or get in touch below.</p>
            <Link href="/book" className="mt-3 inline-block text-sm font-semibold text-brand-700">
              Check my address →
            </Link>
          </div>
        )}
        {result?.kind === "no" && (
          <div className="animate-step-in rounded-2xl bg-white p-5 ring-1 ring-stone-200">
            <p className="font-semibold text-stone-900">Sorry, we only teach in San Diego County.</p>
            <p className="mt-1 text-sm text-stone-600">Double-check the ZIP — ours start with 919, 920 or 921.</p>
          </div>
        )}
        {!result && <p className="pt-2 text-sm text-stone-500">Or tap a neighborhood below.</p>}
      </div>

      <div className="mt-2 space-y-4">
        {zones.map((z) => (
          <div key={z.code}>
            <p className="flex items-center gap-2 text-sm font-semibold text-stone-800">
              {z.name}
              <span className="font-normal text-stone-500">· {z.travelFeeCents ? `${money(z.travelFeeCents)} travel` : "no travel fee"}</span>
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {z.neighborhoods.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setQ(n)}
                  className={`rounded-full px-3 py-1 text-sm transition ${norm(q) === norm(n) ? "bg-brand-600 text-white" : "bg-sand text-stone-700 hover:bg-brand-50"}`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
