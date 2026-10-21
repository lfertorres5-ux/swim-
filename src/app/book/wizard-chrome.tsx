"use client";

import { Swimmer } from "@/components/motifs";

/**
 * The booking journey's "swim lane": one buoy per step along a lane rope, with
 * a swimmer that moves forward as the family goes. Finished steps can be
 * tapped to go back; later steps can't be skipped to.
 */
export function LaneProgress({ steps, current, onJump }: { steps: readonly string[]; current: number; onJump: (i: number) => void }) {
  const pct = (current / (steps.length - 1)) * 100;
  return (
    <nav aria-label="Booking steps" className="rounded-3xl bg-white px-4 pt-4 pb-3 shadow-sm ring-1 ring-stone-200/70 sm:px-6">
      <div className="flex items-baseline justify-between">
        <p className="font-display text-sm font-semibold text-brand-700">
          Lane {current + 1} <span className="font-normal text-stone-400">of {steps.length}</span>
        </p>
        <p className="text-xs text-stone-500">{current === steps.length - 1 ? "Last lap!" : `${steps.length - 1 - current} to go`}</p>
      </div>
      <div className="relative mt-3 h-10">
        {/* rope */}
        <div className="absolute inset-x-3 top-[26px] h-[3px] rounded-full bg-[repeating-linear-gradient(to_right,var(--color-lane-blue)_0_8px,#fff_8px_14px)] ring-1 ring-stone-200" />
        <div className="absolute top-[26px] left-3 h-[3px] rounded-full bg-coral-500 transition-all duration-500" style={{ width: `calc((100% - 1.5rem) * ${pct / 100})` }} />
        {/* swimmer */}
        <div className="absolute top-0 -ml-5 transition-all duration-500 ease-out" style={{ left: `calc(0.75rem + (100% - 1.5rem) * ${pct / 100})` }}>
          <Swimmer className="h-5 w-10 animate-bob" />
        </div>
        {/* buoys */}
        <ol className="absolute inset-x-0 top-[17px] flex justify-between">
          {steps.map((label, i) => {
            const done = i < current;
            const here = i === current;
            return (
              <li key={label}>
                <button
                  type="button"
                  disabled={!done}
                  onClick={() => onJump(i)}
                  aria-current={here ? "step" : undefined}
                  aria-label={`${label}${done ? " (done — go back)" : here ? " (current)" : ""}`}
                  className={`flex h-[21px] w-[21px] items-center justify-center rounded-full text-[10px] font-bold transition ${
                    done ? "bg-coral-500 text-white hover:scale-110" : here ? "bg-brand-600 text-white ring-4 ring-brand-100" : "bg-white text-stone-400 ring-2 ring-stone-200"
                  }`}
                >
                  {done ? "✓" : i + 1}
                </button>
              </li>
            );
          })}
        </ol>
      </div>
      <ol className="mt-1 hidden justify-between text-[11px] text-stone-500 sm:flex">
        {steps.map((label, i) => (
          <li key={label} className={`w-16 text-center first:text-left last:text-right ${i === current ? "font-semibold text-stone-900" : ""}`}>
            {label}
          </li>
        ))}
      </ol>
      <p className="mt-1 text-center text-xs font-medium text-stone-700 sm:hidden">{steps[current]}</p>
    </nav>
  );
}

export type PassItem = { step: number; label: string; value: string | null };

/** The family's "swim pass" — fills in as they choose, each line links back to its step. */
export function SwimPass({ items, current, onJump, total }: { items: PassItem[]; current: number; onJump: (i: number) => void; total?: string | null }) {
  return (
    <aside className="sticky top-20 overflow-hidden rounded-3xl bg-brand-800 text-brand-50 shadow-lg">
      <div className="flex items-center justify-between px-5 pt-5">
        <p className="text-xs font-semibold tracking-[0.18em] text-brand-200 uppercase">Swim pass</p>
        <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-coral-400" />
      </div>
      <ul className="mt-3 space-y-0 px-5 pb-4">
        {items.map((it) => (
          <li key={it.label} className="flex items-start justify-between gap-3 border-b border-dashed border-brand-600 py-2.5 last:border-0">
            <span className="min-w-0">
              <span className="block text-[11px] tracking-wide text-brand-300 uppercase">{it.label}</span>
              <span className={`block truncate ${it.value ? "animate-step-in font-medium text-white" : "text-brand-400"}`}>{it.value ?? "—"}</span>
            </span>
            {it.value && it.step < current && (
              <button type="button" className="shrink-0 pt-3 text-xs text-brand-200 underline-offset-2 hover:text-white hover:underline" onClick={() => onJump(it.step)}>
                Edit
              </button>
            )}
          </li>
        ))}
      </ul>
      {/* ticket perforation */}
      <div aria-hidden className="relative h-4">
        <span className="absolute top-1/2 -left-2 h-4 w-4 -translate-y-1/2 rounded-full bg-sand" />
        <span className="absolute top-1/2 -right-2 h-4 w-4 -translate-y-1/2 rounded-full bg-sand" />
        <span className="absolute inset-x-4 top-1/2 border-t-2 border-dotted border-brand-600" />
      </div>
      <p className="flex items-baseline justify-between px-5 pt-1 pb-5">
        <span className="text-sm text-brand-200">Total</span>
        <span className="font-display text-2xl font-semibold text-white">{total ?? "—"}</span>
      </p>
    </aside>
  );
}

/** Phone version of the pass: what's chosen so far, in one scrollable line. */
export function PassChips({ items, current, onJump }: { items: PassItem[]; current: number; onJump: (i: number) => void }) {
  const chosen = items.filter((i) => i.value);
  if (!chosen.length) return null;
  return (
    <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
      {chosen.map((it) => (
        <button
          key={it.label}
          type="button"
          disabled={it.step >= current}
          onClick={() => onJump(it.step)}
          className="shrink-0 animate-step-in rounded-full bg-white px-3 py-1 text-xs text-stone-700 ring-1 ring-stone-200 enabled:hover:ring-brand-300"
        >
          <span className="text-stone-400">{it.label}:</span> {it.value}
        </button>
      ))}
    </div>
  );
}

/** Small check that pops onto a selected card. */
export function Picked({ on }: { on: boolean }) {
  return on ? (
    <span aria-hidden className="absolute top-3 right-3 flex h-6 w-6 animate-pop items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">
      ✓
    </span>
  ) : null;
}
