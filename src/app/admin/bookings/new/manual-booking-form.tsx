"use client";

import { useActionState, useMemo, useState } from "react";
import { Field } from "@/components/action-form";
import { createBookingAction } from "../actions";

export type FamilyOption = {
  id: string;
  name: string;
  email: string;
  address: { line1: string; line2: string; city: string; postalCode: string; accessNotes: string } | null;
  children: { id: string; firstName: string }[];
};

export function ManualBookingForm({
  families,
  instructors,
  durations,
  defaultDate,
}: {
  families: FamilyOption[];
  instructors: { id: string; first_name: string }[];
  durations: { minutes: number; priceCents: number }[];
  defaultDate: string;
}) {
  const [state, action, pending] = useActionState(createBookingAction, {});
  const [filter, setFilter] = useState("");
  const [familyId, setFamilyId] = useState("");
  const [payment, setPayment] = useState<"link" | "comp" | "offline">("link");
  const [otherAddress, setOtherAddress] = useState(false);
  const family = families.find((f) => f.id === familyId);
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? families.filter((f) => f.name.toLowerCase().includes(q) || f.email.toLowerCase().includes(q)) : families;
  }, [families, filter]);
  const needsAddress = family && (!family.address || otherAddress);

  return (
    <form action={action} className="space-y-6">
      <section className="card space-y-3">
        <h2 className="font-semibold">1. Family</h2>
        <input className="input" placeholder="Search by name or email" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <select
          name="parentId"
          className="input"
          size={Math.min(6, Math.max(2, shown.length))}
          value={familyId}
          onChange={(e) => {
            setFamilyId(e.target.value);
            setOtherAddress(false);
          }}
          required
        >
          {shown.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name} · {f.email}
            </option>
          ))}
        </select>
        {family && (
          <>
            <fieldset>
              <legend className="mb-1 text-sm font-medium text-stone-700">Swimmers</legend>
              <div className="flex flex-wrap gap-3">
                {family.children.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 rounded-full bg-sand px-3 py-1.5 text-sm">
                    <input type="checkbox" name="childIds" value={c.id} defaultChecked={family.children.length === 1} /> {c.firstName}
                  </label>
                ))}
                {!family.children.length && <p className="text-sm text-amber-800">This family hasn&apos;t added any swimmers yet.</p>}
              </div>
            </fieldset>
            {family.address && !otherAddress ? (
              <p className="text-sm text-stone-600">
                At {family.address.line1}, {family.address.city} {family.address.postalCode} ·{" "}
                <button type="button" className="text-brand-700 underline" onClick={() => setOtherAddress(true)}>
                  different address
                </button>
              </p>
            ) : null}
            {needsAddress && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Street address">
                  <input name="line1" className="input" required />
                </Field>
                <Field label="Apt / unit">
                  <input name="line2" className="input" />
                </Field>
                <Field label="City">
                  <input name="city" className="input" required />
                </Field>
                <Field label="ZIP">
                  <input name="postal_code" className="input" inputMode="numeric" required />
                </Field>
                <Field label="Gate code / pool notes" className="sm:col-span-2">
                  <input name="access_notes" className="input" />
                </Field>
              </div>
            )}
          </>
        )}
      </section>

      <section className="card grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <h2 className="font-semibold sm:col-span-2 lg:col-span-4">2. When & who</h2>
        <Field label="Date">
          <input type="date" name="date" className="input" defaultValue={defaultDate} required />
        </Field>
        <Field label="Start time">
          <input type="time" name="time" className="input" step={900} defaultValue="15:00" required />
        </Field>
        <Field label="Length">
          <select name="duration" className="input" defaultValue={durations.find((d) => d.minutes === 60) ? 60 : durations[0]?.minutes}>
            {durations.map((d) => (
              <option key={d.minutes} value={d.minutes}>
                {d.minutes} min
              </option>
            ))}
          </select>
        </Field>
        <Field label="Instructor">
          <select name="instructorId" className="input" required defaultValue="">
            <option value="" disabled>
              Pick…
            </option>
            {instructors.map((i) => (
              <option key={i.id} value={i.id}>
                {i.first_name}
              </option>
            ))}
          </select>
        </Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" name="ignore_buffer" /> Ignore travel buffer (still never double-books)
        </label>
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">3. Payment</h2>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["link", "Email a card payment link"],
              ["offline", "Already paid (record it)"],
              ["comp", "No charge"],
            ] as const
          ).map(([v, l]) => (
            <label key={v} className={`cursor-pointer rounded-full border px-4 py-2 text-sm ${payment === v ? "border-brand-600 bg-brand-50 text-brand-800" : "border-stone-300 bg-white"}`}>
              <input type="radio" name="payment" value={v} checked={payment === v} onChange={() => setPayment(v)} className="sr-only" /> {l}
            </label>
          ))}
        </div>
        {payment !== "comp" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Amount ($)" hint={payment === "link" ? "Blank = standard price for this lesson" : undefined}>
              <input name="amount" className="input" inputMode="decimal" required={payment === "offline"} />
            </Field>
            {payment === "offline" && (
              <Field label="How they paid">
                <input name="offline_note" className="input" placeholder="Check #1042" />
              </Field>
            )}
          </div>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="notify" defaultChecked /> Email/text the family and instructor
        </label>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary" disabled={pending || !family}>
          {pending ? "Booking…" : "Create booking"}
        </button>
        {state.error && (
          <p className="text-sm text-red-700" role="alert">
            {state.error}
          </p>
        )}
      </div>
    </form>
  );
}
