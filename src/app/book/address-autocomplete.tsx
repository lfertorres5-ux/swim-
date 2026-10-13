"use client";

import { useEffect, useRef, useState } from "react";

type Suggestion = { placeId: string; main: string; secondary: string };

/**
 * Places API (New) autocomplete, restricted to the San Diego County area.
 * Uses the browser key (restrict it by HTTP referrer). The selected place is
 * re-verified server-side, so nothing here is trusted.
 */
export function AddressAutocomplete({ apiKey, onPick }: { apiKey: string; onPick: (s: { placeId: string; line1: string; description: string }) => void }) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const session = useRef(crypto.randomUUID());

  useEffect(() => {
    if (query.trim().length < 4) return;
    const controller = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
          method: "POST",
          signal: controller.signal,
          headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey },
          body: JSON.stringify({
            input: query,
            sessionToken: session.current,
            includedRegionCodes: ["us"],
            includedPrimaryTypes: ["street_address", "premise", "subpremise"],
            locationRestriction: { rectangle: { low: { latitude: 32.53, longitude: -117.62 }, high: { latitude: 33.51, longitude: -116.08 } } },
          }),
        });
        const body = await res.json();
        setSuggestions(
          (body.suggestions ?? [])
            .map((s: { placePrediction?: { placeId: string; structuredFormat?: { mainText?: { text: string }; secondaryText?: { text: string } } } }) => s.placePrediction)
            .filter(Boolean)
            .map((p: { placeId: string; structuredFormat?: { mainText?: { text: string }; secondaryText?: { text: string } } }) => ({
              placeId: p.placeId,
              main: p.structuredFormat?.mainText?.text ?? "",
              secondary: p.structuredFormat?.secondaryText?.text ?? "",
            })),
        );
        setOpen(true);
      } catch {
        /* aborted or offline — manual entry still works */
      }
    }, 250);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [query, apiKey]);

  return (
    <div className="relative">
      <input
        className="input"
        placeholder="Start typing your street address"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          if (e.target.value.trim().length < 4) setSuggestions([]);
        }}
        onFocus={() => setOpen(true)}
        autoComplete="off"
        aria-label="Street address"
      />
      {open && suggestions.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
          {suggestions.map((s) => (
            <li key={s.placeId}>
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-sm hover:bg-sky-50"
                onClick={() => {
                  setQuery(`${s.main}, ${s.secondary}`);
                  setOpen(false);
                  session.current = crypto.randomUUID();
                  onPick({ placeId: s.placeId, line1: s.main, description: `${s.main}, ${s.secondary}` });
                }}
              >
                <span className="font-medium">{s.main}</span> <span className="text-slate-500">{s.secondary}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
