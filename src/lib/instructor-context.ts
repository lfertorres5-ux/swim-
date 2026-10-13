import "server-only";
import { cache } from "react";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type ProfileRequirement = "photo" | "bio" | "zones" | "availability";

export const REQUIREMENT_LABELS: Record<ProfileRequirement, string> = {
  photo: "Upload a profile photo",
  bio: "Write a bio (at least 40 characters)",
  zones: "Choose the zones you'll travel to",
  availability: "Set your weekly availability",
};

/** The signed-in instructor's status, memoized per request. */
export const getInstructorContext = cache(async () => {
  const user = await requireRole("instructor", "/instructor");
  const supabase = await createClient();
  const [{ data: settings }, { data: me }, { data: missing }] = await Promise.all([
    supabase.from("platform_settings").select("instructor_terms_version").single(),
    supabase.from("instructors").select("is_active, first_name").eq("id", user.id).single(),
    supabase.rpc("instructor_profile_missing"),
  ]);
  const { count } = await supabase
    .from("instructor_terms_acceptances")
    .select("id", { count: "exact", head: true })
    .eq("instructor_id", user.id)
    .eq("terms_version", settings?.instructor_terms_version ?? "");

  return {
    user,
    firstName: me?.first_name ?? user.firstName ?? "",
    isActive: Boolean(me?.is_active),
    termsAccepted: Boolean(count),
    missing: (missing ?? []) as ProfileRequirement[],
  };
});
