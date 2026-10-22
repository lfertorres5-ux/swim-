"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { SPECIALTIES } from "@/lib/instructors";
import { SWIM_LEVELS } from "@/lib/scheduling/types";
import { createClient } from "@/lib/supabase/server";

export type ProfileFormState = { ok?: boolean; error?: string };

const schema = z.object({
  firstName: z
    .string()
    .trim()
    .min(1, "First name is required")
    .max(30)
    .regex(/^\p{L}[\p{L} '’-]*$/u, "First name can only contain letters, spaces, hyphens and apostrophes"),
  bio: z.string().trim().min(40, "Bio must be at least 40 characters").max(1200, "Bio must be 1,200 characters or fewer"),
  specialties: z.array(z.enum(SPECIALTIES.map((s) => s.value) as [string, ...string[]])).max(8),
  levelsTaught: z.array(z.enum(SWIM_LEVELS)).min(1, "Choose at least one level you teach"),
  minChildAgeMonths: z.coerce.number().int().min(0).max(240),
  maxChildrenPerLesson: z.coerce.number().int().min(1).max(8),
  yearsExperience: z.coerce.number().int().min(0).max(60).optional(),
  languages: z.string().trim().max(120),
  isAcceptingNewClients: z.boolean(),
});

export async function saveInstructorProfile(_prev: ProfileFormState, formData: FormData): Promise<ProfileFormState> {
  const user = await requireRole("instructor");
  const parsed = schema.safeParse({
    firstName: formData.get("firstName"),
    bio: formData.get("bio"),
    specialties: formData.getAll("specialties"),
    levelsTaught: formData.getAll("levelsTaught"),
    minChildAgeMonths: formData.get("minChildAgeMonths"),
    maxChildrenPerLesson: formData.get("maxChildrenPerLesson"),
    yearsExperience: formData.get("yearsExperience") || undefined,
    languages: formData.get("languages") ?? "",
    isAcceptingNewClients: formData.get("isAcceptingNewClients") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase
    .from("instructors")
    .update({
      first_name: v.firstName,
      bio: v.bio,
      specialties: v.specialties,
      levels_taught: v.levelsTaught,
      min_child_age_months: v.minChildAgeMonths,
      max_children_per_lesson: v.maxChildrenPerLesson,
      years_experience: v.yearsExperience ?? null,
      languages: v.languages.split(",").map((l) => l.trim()).filter(Boolean),
      is_accepting_new_clients: v.isAcceptingNewClients,
    })
    .eq("id", user.id);
  if (error) {
    if (error.message.includes("no_contact_info")) {
      return { error: "Please remove phone numbers, emails, links and social handles from your name and bio — families contact you through the app." };
    }
    return { error: error.code === "23514" ? "Please check your first name and bio." : "Couldn't save your profile." };
  }

  revalidatePath("/instructor", "layout");
  return { ok: true };
}

/** Called after the browser uploads to instructor-photos/<uid>/… (storage RLS enforces the folder). */
export async function setInstructorPhoto(path: string): Promise<{ error?: string }> {
  const user = await requireRole("instructor");
  if (!path.startsWith(`${user.id}/`) || path.includes("..")) return { error: "Invalid photo path" };

  const supabase = await createClient();
  const { data: previous } = await supabase.from("instructors").select("photo_path").eq("id", user.id).single();
  const { error } = await supabase.from("instructors").update({ photo_path: path }).eq("id", user.id);
  if (error) return { error: "Couldn't save your photo." };

  if (previous?.photo_path && previous.photo_path !== path && previous.photo_path.startsWith(`${user.id}/`)) {
    await supabase.storage.from("instructor-photos").remove([previous.photo_path]);
  }
  revalidatePath("/instructor", "layout");
  return {};
}
