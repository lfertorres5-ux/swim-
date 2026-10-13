"use client";

import { useEffect, useState, useTransition } from "react";
import { WeekCalendar } from "@/app/book/week-calendar";
import type { SlotView } from "@/app/book/actions";
import { rescheduleLessonAction, rescheduleSlotsAction } from "../../actions";

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export function ReschedulePicker({ bookingId, today, instructorName }: { bookingId: string; today: string; instructorName: string | null }) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(addDays(today, 1));
  const [data, setData] = useState<{ key: string; slots: SlotView[]; same: string[] } | null>(null);
  const [selected, setSelected] = useState<SlotView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const key = `${bookingId}|${from}`;
  const loading = open && data?.key !== key;

  useEffect(() => {
    if (!open) return;
    let stale = false;
    rescheduleSlotsAction(bookingId, from).then((r) => {
      if (stale) return;
      if (r.ok) setData({ key, slots: r.slots, same: r.sameInstructor });
      else setMessage(r.error);
    });
    return () => {
      stale = true;
    };
  }, [open, bookingId, from, key]);

  if (!open)
    return (
      <button className="btn-secondary" onClick={() => setOpen(true)}>
        Reschedule
      </button>
    );

  const same = new Set(data?.same ?? []);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-stone-600">
          {instructorName ? `Times with a dot are with ${instructorName}. Others may be with a different instructor.` : "Pick a new time."}
        </p>
        <div className="flex gap-2">
          <button className="btn-secondary" disabled={from <= addDays(today, 1) || loading} onClick={() => setFrom(addDays(from, -7))}>
            ←
          </button>
          <button className="btn-secondary" disabled={loading} onClick={() => setFrom(addDays(from, 7))}>
            →
          </button>
        </div>
      </div>
      <div className={loading ? "opacity-50" : ""}>
        <WeekCalendar fromDate={from} slots={data?.slots ?? []} suggested={[...same]} selected={selected?.start ?? null} onSelect={setSelected} neighborhoodDiscountLabel="" compact markSuggested />
      </div>
      {message && <p className="text-sm text-red-600">{message}</p>}
      <button
        className="btn-primary"
        disabled={!selected || pending}
        onClick={() =>
          startTransition(async () => {
            const r = await rescheduleLessonAction(bookingId, selected!.start);
            setMessage(r.ok ? (r.keptInstructor ? "Done — your lesson has moved." : "Rescheduled — we're confirming an instructor for the new time.") : (r.error ?? "Couldn't reschedule"));
            if (r.ok) setOpen(false);
          })
        }
      >
        {pending ? "Saving…" : "Move lesson here"}
      </button>
    </div>
  );
}
