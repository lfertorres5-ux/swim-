import type { SwimLevel } from "@/lib/scheduling/types";

/** Progress-note checklist, by swim level. Labels are stored as-is in lesson_notes.skills. */
export const SKILLS_BY_LEVEL: Record<SwimLevel, string[]> = {
  water_acclimation: ["Gets in and out safely", "Blows bubbles", "Puts face in", "Floats on front (with help)", "Floats on back (with help)", "Kicks with support"],
  beginner: ["Floats on front", "Floats on back", "Flutter kick", "Glides from the wall", "Rolls front to back", "Jumps in and returns to wall"],
  advanced_beginner: ["Freestyle arms", "Rhythmic breathing", "Basic backstroke", "Treads water 30 sec", "Swims 10 yards"],
  intermediate: ["Freestyle with side breathing", "Backstroke", "Breaststroke kick", "Treads water 1 min", "Swims 25 yards"],
  advanced: ["Breaststroke", "Butterfly kick", "Intro to flip turns", "Swims 50 yards", "Streamline push-off"],
  stroke_technique: ["Freestyle catch", "Bilateral breathing", "Flip turns", "Breaststroke timing", "Butterfly", "Race starts"],
};

export const SKILL_STATES = ["introduced", "progressing", "mastered"] as const;
export type SkillState = (typeof SKILL_STATES)[number];
export const SKILL_STATE_LABEL: Record<SkillState, string> = { introduced: "Tried it", progressing: "Getting there", mastered: "Got it!" };

/** {"Lucas": {"Flutter kick": "mastered"}, ...} — only skills the instructor marked. */
export type SkillsBySwimmer = Record<string, Record<string, SkillState>>;
