"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { toE164 } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";

export type ProfileState = { error?: string };

const profileSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(60),
  lastName: z.string().trim().min(1, "Last name is required").max(60),
  phone: z.string().trim().optional(),
  smsOptIn: z.boolean(),
});

export async function saveProfile(_prev: ProfileState, formData: FormData): Promise<ProfileState> {
  const user = await requireUser("/onboarding");
  const parsed = profileSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    phone: formData.get("phone") || undefined,
    smsOptIn: formData.get("smsOptIn") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const phone = parsed.data.phone ? toE164(parsed.data.phone) : null;
  if (parsed.data.phone && !phone) return { error: "Enter a valid US mobile number, e.g. (619) 555-0123." };

  // Runs as the user under RLS; column grants restrict this to profile fields.
  const supabase = await createClient();
  const { error } = await supabase
    .from("users")
    .update({
      first_name: parsed.data.firstName,
      last_name: parsed.data.lastName,
      phone,
      sms_opt_in: Boolean(phone) && parsed.data.smsOptIn,
      onboarded_at: new Date().toISOString(),
    })
    .eq("id", user.id);
  if (error) return { error: "Couldn't save your profile. Please try again." };

  redirect("/dashboard");
}

export async function acceptInstructorTerms(formData: FormData) {
  const user = await requireUser("/onboarding/instructor-terms");
  if (user.role !== "instructor") redirect("/dashboard");
  if (formData.get("agree") !== "on") redirect("/onboarding/instructor-terms?error=agree");

  const supabase = await createClient();
  const { error } = await supabase.rpc("accept_instructor_terms", { p_terms_version: String(formData.get("version")) });
  if (error) redirect("/onboarding/instructor-terms?error=version");
  redirect("/instructor");
}
