"use client";

import { useActionState, useState } from "react";
import { LEVEL_LABELS, SPECIALTIES } from "@/lib/instructors";
import { SWIM_LEVELS } from "@/lib/scheduling/types";
import { saveInstructorProfile, type ProfileFormState } from "./actions";

export type ProfileDefaults = {
  firstName: string;
  bio: string;
  specialties: string[];
  levelsTaught: string[];
  minChildAgeMonths: number;
  maxChildrenPerLesson: number;
  yearsExperience: number | null;
  languages: string[];
  isAcceptingNewClients: boolean;
};

export function ProfileForm({ defaults }: { defaults: ProfileDefaults }) {
  const [state, action, pending] = useActionState<ProfileFormState, FormData>(saveInstructorProfile, {});
  const [bio, setBio] = useState(defaults.bio);

  return (
    <form action={action} className="flex flex-col gap-5">
      <label className="flex flex-col gap-1 text-sm font-medium text-stone-700">
        First name <span className="font-normal text-stone-500">(families only ever see your first name)</span>
        <input name="firstName" required maxLength={30} defaultValue={defaults.firstName} className="input max-w-xs" />
      </label>

      <label className="flex flex-col gap-1 text-sm font-medium text-stone-700">
        Bio
        <textarea
          name="bio"
          required
          minLength={40}
          maxLength={1200}
          rows={5}
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          className="input"
          placeholder="Your experience, teaching style, and what families can expect. Don't include contact details or links."
        />
        <span className={`text-xs ${bio.trim().length < 40 ? "text-amber-700" : "text-stone-500"}`}>{bio.trim().length} / 1,200 (minimum 40)</span>
      </label>

      <fieldset>
        <legend className="text-sm font-medium text-stone-700">Specialties</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {SPECIALTIES.map((s) => (
            <label key={s.value} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="specialties" value={s.value} defaultChecked={defaults.specialties.includes(s.value)} />
              {s.label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-sm font-medium text-stone-700">Levels you teach</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {SWIM_LEVELS.map((l) => (
            <label key={l} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="levelsTaught" value={l} defaultChecked={defaults.levelsTaught.includes(l)} />
              {LEVEL_LABELS[l]}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm font-medium text-stone-700">
          Youngest swimmer
          <select name="minChildAgeMonths" defaultValue={defaults.minChildAgeMonths} className="input">
            {[...new Set([6, 12, 18, 24, 36, 48, 60, 72, defaults.minChildAgeMonths])].sort((a, b) => a - b).map((m) => (
              <option key={m} value={m}>
                {m < 24 ? `${m} months` : `${m / 12} years`}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-stone-700">
          Max swimmers per lesson
          <input type="number" name="maxChildrenPerLesson" min={1} max={8} defaultValue={defaults.maxChildrenPerLesson} className="input" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-stone-700">
          Years teaching
          <input type="number" name="yearsExperience" min={0} max={60} defaultValue={defaults.yearsExperience ?? ""} className="input" />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm font-medium text-stone-700">
        Languages <span className="font-normal text-stone-500">(comma-separated)</span>
        <input name="languages" defaultValue={defaults.languages.join(", ")} className="input max-w-md" />
      </label>

      <label className="flex items-center gap-2 text-sm text-stone-700">
        <input type="checkbox" name="isAcceptingNewClients" defaultChecked={defaults.isAcceptingNewClients} />
        Accepting new families (your current families can always rebook you)
      </label>

      {state.error && <p className="text-sm text-red-600" role="alert">{state.error}</p>}
      {state.ok && <p className="text-sm text-green-700" role="status">Saved.</p>}
      <button disabled={pending} className="btn-primary w-fit">
        {pending ? "Saving…" : "Save profile"}
      </button>
    </form>
  );
}
