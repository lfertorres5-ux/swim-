"use client";

import { useState } from "react";
import type { SlotView } from "./actions";

const tz = "America/Los_Angeles";
const weekdayFmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short" });
const dayNumFmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", day: "numeric" });
const dayFmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "short", day: "numeric" });
const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });

/**
 * Bookable start times for one week (San Diego time).
 * Phones: a row of days, then that day's times. Desktop: the whole week at once.
 */
export function WeekCalendar({
  fromDate,
  slots,
  suggested,
  selected,
  onSelect,
  neighborhoodDiscountLabel,
  compact,
  markSuggested,
}: {
  fromDate: string;
  slots: SlotView[];
  suggested: string[];
  selected: string | null;
  onSelect: (slot: SlotView) => void;
  neighborhoodDiscountLabel: string;
  /** Narrow containers: always use the day-by-day layout. */
  compact?: boolean;
  /** Show a dot on `suggested` times (used by reschedule to mean "same instructor"). */
  markSuggested?: boolean;
}) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(`${fromDate}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
  const byDay = new Map(days.map((d) => [d, slots.filter((s) => s.date === d)]));
  const firstOpen = days.find((d) => byDay.get(d)!.length > 0) ?? days[0];
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const day = pickedDay && days.includes(pickedDay) ? pickedDay : (slots.find((s) => s.start === selected)?.date ?? firstOpen);
  const best = new Set(suggested);

  const button = (s: SlotView) => {
    const isSelected = selected === s.start;
    return (
      <button
        key={s.start}
        type="button"
        onClick={() => onSelect(s)}
        aria-pressed={isSelected}
        data-slot={s.start}
        className={`relative rounded-xl border px-2 py-2.5 text-sm whitespace-nowrap transition-colors duration-100 ${
          isSelected
            ? "border-brand-600 bg-brand-600 font-semibold text-white"
            : s.isNeighborhoodSlot && neighborhoodDiscountLabel
              ? "border-coral-200 bg-coral-50 text-stone-900 hover:border-coral-400"
              : "border-stone-200 bg-white text-stone-800 hover:border-brand-400"
        }`}
      >
        {timeFmt.format(new Date(s.start))}
        {s.isNeighborhoodSlot && neighborhoodDiscountLabel && (
          <span className={`block text-[11px] font-medium ${isSelected ? "text-white/85" : "text-coral-700"}`}>{neighborhoodDiscountLabel}</span>
        )}
        {markSuggested && best.has(s.start) && !isSelected && <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-brand-500" aria-label="Good fit" />}
      </button>
    );
  };

  return (
    <div>
      {/* Day-by-day (phones, and narrow containers) */}
      <div className={compact ? "" : "lg:hidden"}>
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Days">
          {days.map((d) => {
            const count = byDay.get(d)!.length;
            const on = d === day;
            return (
              <button
                key={d}
                type="button"
                role="tab"
                aria-selected={on}
                disabled={count === 0}
                onClick={() => setPickedDay(d)}
                className={`flex min-w-[3.6rem] flex-1 flex-col items-center rounded-2xl px-2 py-2 text-xs transition ${
                  on ? "bg-brand-600 text-white" : count ? "bg-white text-stone-700" : "bg-transparent text-stone-300"
                }`}
              >
                <span>{weekdayFmt.format(new Date(`${d}T12:00:00Z`))}</span>
                <span className="font-display text-lg leading-tight font-semibold">{dayNumFmt.format(new Date(`${d}T12:00:00Z`))}</span>
                <span className={on ? "text-white/80" : "text-stone-400"}>{count ? `${count} open` : "—"}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-4 mb-2 text-sm font-medium text-stone-600">{dayFmt.format(new Date(`${day}T12:00:00Z`))}</p>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">{byDay.get(day)!.map(button)}</div>
        {byDay.get(day)!.length === 0 && <p className="text-sm text-stone-500">No openings this day.</p>}
      </div>

      {/* Whole week (desktop) */}
      {!compact && (
        <div className="hidden grid-cols-7 gap-2 lg:grid">
          {days.map((d) => (
            <div key={d}>
              <p className="mb-2 text-center text-xs text-stone-500">
                {weekdayFmt.format(new Date(`${d}T12:00:00Z`))}{" "}
                <span className="font-display text-base font-semibold text-stone-800">{dayNumFmt.format(new Date(`${d}T12:00:00Z`))}</span>
              </p>
              <div className="flex flex-col gap-1.5">
                {byDay.get(d)!.length === 0 && <p className="py-2 text-center text-xs text-stone-300">—</p>}
                {byDay.get(d)!.map(button)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
