"use client";

import type { SlotView } from "./actions";

const tz = "America/Los_Angeles";
const dayFmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });

/** 7-day grid of bookable start times. Times are always San Diego time. */
export function WeekCalendar({
  fromDate,
  slots,
  suggested,
  selected,
  onSelect,
  neighborhoodDiscountLabel,
  compact,
}: {
  fromDate: string;
  slots: SlotView[];
  suggested: string[];
  selected: string | null;
  onSelect: (slot: SlotView) => void;
  neighborhoodDiscountLabel: string;
  /** Narrow containers: smaller type, tighter padding. */
  compact?: boolean;
}) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(`${fromDate}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
  const best = new Set(suggested);

  return (
    <div className={`grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 ${compact ? "gap-1.5" : "gap-3"}`}>
      {days.map((date) => {
        const daySlots = slots.filter((s) => s.date === date);
        return (
          <div key={date} className={`rounded-xl border border-slate-200 bg-white ${compact ? "p-1" : "p-2"}`}>
            <p className="mb-2 text-center text-xs font-semibold text-slate-600">{dayFmt.format(new Date(`${date}T12:00:00Z`))}</p>
            <div className="flex flex-col gap-1.5">
              {daySlots.length === 0 && <p className="py-2 text-center text-xs text-slate-400">—</p>}
              {daySlots.map((s) => {
                const isSelected = selected === s.start;
                return (
                  <button
                    key={s.start}
                    type="button"
                    onClick={() => onSelect(s)}
                    className={`rounded-lg border whitespace-nowrap transition ${compact ? "px-1 py-1 text-xs" : "px-2 py-1.5 text-sm"} ${
                      isSelected
                        ? "border-sky-600 bg-sky-600 text-white"
                        : s.isNeighborhoodSlot
                          ? "border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100"
                          : "border-slate-200 hover:border-sky-400 hover:bg-sky-50"
                    } ${!s.matchesPreferences && !isSelected ? "opacity-60" : ""}`}
                    aria-pressed={isSelected}
                    data-slot={s.start}
                  >
                    {timeFmt.format(new Date(s.start))}
                    {s.isNeighborhoodSlot && <span className={`block text-[10px] font-semibold ${isSelected ? "text-sky-100" : "text-emerald-700"}`}>{neighborhoodDiscountLabel}</span>}
                    {!s.isNeighborhoodSlot && best.has(s.start) && <span className={`block text-[10px] ${isSelected ? "text-sky-100" : "text-sky-700"}`}>Recommended</span>}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
