"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { SKILL_STATE_LABEL, SKILL_STATES, type SkillState, type SkillsBySwimmer } from "@/lib/skills";
import { submitNoteAction } from "./actions";

type Swimmer = { firstName: string; age: number | null; levelLabel: string; skills: string[] };

const STYLE: Record<SkillState | "none", string> = {
  none: "border-stone-200 bg-white text-stone-700",
  introduced: "border-stone-300 bg-sand text-stone-800",
  progressing: "border-brand-300 bg-brand-50 text-brand-900",
  mastered: "border-brand-600 bg-brand-600 text-white",
};

/** Phone-first: tap a skill to cycle Tried it → Getting there → Got it! → (clear). */
export function NoteForm({ bookingId, swimmers, initial }: { bookingId: string; swimmers: Swimmer[]; initial: { skills: SkillsBySwimmer; summary: string; nextFocus: string } | null }) {
  const [skills, setSkills] = useState<SkillsBySwimmer>(initial?.skills ?? {});
  const [summary, setSummary] = useState(initial?.summary ?? "");
  const [nextFocus, setNextFocus] = useState(initial?.nextFocus ?? "");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const cycle = (swimmer: string, skill: string) =>
    setSkills((prev) => {
      const current = prev[swimmer]?.[skill];
      const next = current ? SKILL_STATES[SKILL_STATES.indexOf(current) + 1] : SKILL_STATES[0];
      const forSwimmer = { ...(prev[swimmer] ?? {}) };
      if (next) forSwimmer[skill] = next;
      else delete forSwimmer[skill];
      return { ...prev, [swimmer]: forSwimmer };
    });

  if (result?.ok) {
    return (
      <div className="card space-y-3 text-center">
        <p className="font-display text-xl font-semibold">Sent!</p>
        <p className="text-stone-600">{result.message}</p>
        <Link href="/instructor" className="btn-primary">
          Back to today
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-28">
      {swimmers.map((s) => (
        <section key={s.firstName} className="card space-y-3">
          <p className="font-display text-lg font-semibold">
            {s.firstName}
            <span className="ml-2 font-sans text-sm font-normal text-stone-500">
              {s.age !== null ? `${s.age} · ` : ""}
              {s.levelLabel}
            </span>
          </p>
          <div className="flex flex-wrap gap-2">
            {s.skills.map((skill) => {
              const state = skills[s.firstName]?.[skill];
              return (
                <button key={skill} type="button" onClick={() => cycle(s.firstName, skill)} className={`rounded-full border px-3 py-2 text-sm transition-colors ${STYLE[state ?? "none"]}`}>
                  {skill}
                  {state && <span className="ml-1.5 text-xs opacity-80">· {SKILL_STATE_LABEL[state]}</span>}
                </button>
              );
            })}
          </div>
        </section>
      ))}
      <p className="text-xs text-stone-500">Tap a skill to mark it: Tried it → Getting there → Got it! Tap again to clear.</p>

      <label className="block">
        <span className="font-medium text-stone-800">How did it go?</span>
        <textarea className="input mt-1" rows={4} maxLength={2000} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="A few words for the family — wins, effort, anything to practice." />
      </label>
      <label className="block">
        <span className="font-medium text-stone-800">Next time</span> <span className="text-sm text-stone-400">(optional)</span>
        <input className="input mt-1" maxLength={500} value={nextFocus} onChange={(e) => setNextFocus(e.target.value)} placeholder="e.g. Back float without help" />
      </label>
      {result && !result.ok && <p className="rounded-2xl bg-coral-50 p-3 text-sm text-coral-700">{result.message}</p>}

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-stone-200/70 bg-sand/95 px-5 py-3 backdrop-blur">
        <button
          className="btn-primary w-full py-3 text-base"
          disabled={pending || !summary.trim()}
          onClick={() =>
            startTransition(async () => {
              const r = await submitNoteAction({ bookingId, skills, summary, nextFocus: nextFocus || undefined });
              setResult(r.ok ? { ok: true, message: r.firstTime ? "The family will get your note by email and text." : "Your changes are saved." } : { ok: false, message: r.error });
            })
          }
        >
          {pending ? "Sending…" : initial ? "Save changes" : "Send to family"}
        </button>
      </div>
    </div>
  );
}
