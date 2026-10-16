"use client";

import { useActionState, useState } from "react";
import { Field } from "@/components/action-form";
import { submitInquiry } from "./actions";

const INTEREST = [
  { value: "just_curious", label: "Just curious", hint: "Tell me more" },
  { value: "interested", label: "Interested", hint: "Probably this season" },
  { value: "ready_to_book", label: "Ready to book", hint: "Let's pick a day" },
] as const;

export function InquiryForm({ defaults, minDate, clubName }: { defaults: { name: string; email: string; phone: string }; minDate: string; clubName: string }) {
  const [state, action, pending] = useActionState(submitInquiry, {});
  const [interest, setInterest] = useState<string>("interested");
  const [dates, setDates] = useState(1);

  if (state.ok) {
    return (
      <div className="card text-center">
        <p className="font-display text-2xl font-semibold">Thanks — we&apos;ve got it!</p>
        <p className="mt-2 text-stone-600">We&apos;ll check {clubName}&apos;s calendar and email you member-family pricing, usually within a day or two. Nothing is booked or charged until you say yes.</p>
      </div>
    );
  }

  return (
    <form action={action} className="card space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Your name">
          <input name="name" className="input" required defaultValue={defaults.name} autoComplete="name" />
        </Field>
        <Field label="Email">
          <input name="email" type="email" className="input" required defaultValue={defaults.email} autoComplete="email" />
        </Field>
        <Field label="Phone (optional)">
          <input name="phone" type="tel" className="input" defaultValue={defaults.phone} autoComplete="tel" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Adults">
            <input name="adults" type="number" min={0} max={20} className="input" defaultValue={2} />
          </Field>
          <Field label="Kids">
            <input name="children" type="number" min={0} max={20} className="input" defaultValue={2} />
          </Field>
        </div>
      </div>

      <fieldset>
        <legend className="mb-1 text-sm font-medium text-stone-700">Preferred dates</legend>
        <div className="flex flex-wrap items-center gap-2">
          {Array.from({ length: dates }, (_, i) => (
            <input key={i} type="date" name="date" min={minDate} className="input w-auto" aria-label={`Preferred date ${i + 1}`} />
          ))}
          {dates < 3 && (
            <button type="button" className="text-sm font-medium text-brand-700" onClick={() => setDates((d) => d + 1)}>
              + another date
            </button>
          )}
        </div>
        <p className="mt-1 text-xs text-stone-500">Flexible? Leave it blank and tell us below.</p>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-stone-700">How interested are you?</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {INTEREST.map((o) => (
            <label key={o.value} className={`cursor-pointer rounded-2xl border px-4 py-3 text-sm transition ${interest === o.value ? "border-brand-600 bg-brand-50" : "border-stone-200 bg-white hover:border-stone-300"}`}>
              <input type="radio" name="interest" value={o.value} checked={interest === o.value} onChange={() => setInterest(o.value)} className="sr-only" />
              <span className="block font-medium">{o.label}</span>
              <span className="text-stone-500">{o.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <Field label="Anything else? (optional)">
        <textarea name="message" rows={3} className="input" maxLength={1000} placeholder="Birthday party, ages of the kids, questions about the club…" />
      </Field>

      {/* Honeypot for bots — hidden from people and screen readers. */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary" disabled={pending}>
          {pending ? "Sending…" : "Send inquiry"}
        </button>
        <span className="text-sm text-stone-500">No payment now. We&apos;ll reply with pricing.</span>
        {state.error && (
          <p className="w-full text-sm text-red-700" role="alert">
            {state.error}
          </p>
        )}
      </div>
    </form>
  );
}
