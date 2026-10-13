"use client";

import { useActionState } from "react";
import { saveProfile, type ProfileState } from "./actions";

export function ProfileForm({ defaults }: { defaults: { firstName: string; lastName: string; phone: string } }) {
  const [state, action, pending] = useActionState<ProfileState, FormData>(saveProfile, {});
  return (
    <form action={action} className="card flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm font-medium text-stone-700">
          First name
          <input name="firstName" required defaultValue={defaults.firstName} autoComplete="given-name" className="input" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-stone-700">
          Last name
          <input name="lastName" required defaultValue={defaults.lastName} autoComplete="family-name" className="input" />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm font-medium text-stone-700">
        Mobile phone <span className="font-normal text-stone-500">(for lesson reminders)</span>
        <input name="phone" type="tel" defaultValue={defaults.phone} autoComplete="tel" placeholder="(619) 555-0123" className="input" />
      </label>
      <label className="flex items-start gap-2 text-sm text-stone-600">
        <input name="smsOptIn" type="checkbox" defaultChecked className="mt-1" />
        Text me booking confirmations and reminders. Msg &amp; data rates may apply. Reply STOP to opt out.
      </label>
      <p className="text-xs text-stone-500">
        Your phone number and email are never shared with instructors. Calls and texts with your instructor go through a
        temporary masked number.
      </p>
      {state.error && (
        <p className="text-sm text-red-600" role="alert">
          {state.error}
        </p>
      )}
      <button disabled={pending} className="btn-primary">
        {pending ? "Saving…" : "Continue"}
      </button>
    </form>
  );
}
