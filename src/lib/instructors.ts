import { publicEnv } from "@/lib/env";

/** Public URL for an instructor photo (own upload in storage, or a bundled /seed image). */
export function instructorPhotoUrl(photoPath: string | null | undefined): string | null {
  if (!photoPath) return null;
  if (photoPath.startsWith("/")) return photoPath;
  return `${publicEnv().NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/instructor-photos/${photoPath}`;
}

export const SPECIALTIES: { value: string; label: string }[] = [
  { value: "toddlers", label: "Toddlers & infants" },
  { value: "fearful_swimmers", label: "Fearful swimmers" },
  { value: "stroke_technique", label: "Stroke technique" },
  { value: "swim_team_prep", label: "Swim team prep" },
  { value: "water_safety", label: "Water safety" },
  { value: "infant_survival", label: "Infant self-rescue" },
  { value: "special_needs", label: "Special needs / adaptive" },
  { value: "older_beginners", label: "Older beginners & teens" },
];

export const LEVEL_LABELS: Record<string, string> = {
  water_acclimation: "Water acclimation",
  beginner: "Beginner",
  advanced_beginner: "Advanced beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
  stroke_technique: "Stroke technique",
};
