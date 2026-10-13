import "server-only";
import { createClient } from "@/lib/supabase/server";
import { instructorPhotoUrl } from "@/lib/instructors";

export type InstructorCardData = {
  id: string;
  firstName: string;
  bio: string;
  photoUrl: string | null;
  specialties: string[];
  languages: string[];
  yearsExperience: number | null;
  certifications: { kind: string; issuer: string | null }[];
};

/** Public profiles only (RLS: active instructors, verified unexpired certifications). */
export async function loadInstructorCards(ids?: string[]): Promise<InstructorCardData[]> {
  const supabase = await createClient();
  let q = supabase
    .from("instructors")
    .select("id, first_name, bio, photo_path, specialties, languages, years_experience, sort_order, instructor_certifications(kind, issuer)")
    .eq("is_active", true)
    .order("sort_order");
  if (ids) q = q.in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
  const { data } = await q;
  return (data ?? []).map((i) => ({
    id: i.id,
    firstName: i.first_name,
    bio: i.bio ?? "",
    photoUrl: instructorPhotoUrl(i.photo_path),
    specialties: i.specialties,
    languages: i.languages,
    yearsExperience: i.years_experience,
    certifications: (i.instructor_certifications ?? []).map((c) => ({ kind: c.kind, issuer: c.issuer })),
  }));
}
