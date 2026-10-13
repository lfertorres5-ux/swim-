import type { Metadata } from "next";
import { getInstructorContext } from "@/lib/instructor-context";
import { instructorPhotoUrl } from "@/lib/instructors";
import { createClient } from "@/lib/supabase/server";
import { PhotoUploader } from "./photo-uploader";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = { title: "Your profile" };

export default async function InstructorProfilePage() {
  const { user } = await getInstructorContext();
  const supabase = await createClient();
  const { data: me } = await supabase
    .from("instructors")
    .select("first_name, bio, photo_path, specialties, levels_taught, min_child_age_months, max_children_per_lesson, years_experience, languages, is_accepting_new_clients")
    .eq("id", user.id)
    .single();
  if (!me) return null;

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold">Your profile</h1>
      <p className="mt-1 text-sm text-slate-500">
        A first name, photo and bio are required before families can see and book you.
      </p>
      <div className="card mt-6">
        <PhotoUploader userId={user.id} currentUrl={instructorPhotoUrl(me.photo_path)} firstName={me.first_name} />
      </div>
      <div className="card mt-6">
        <ProfileForm
          defaults={{
            firstName: me.first_name,
            bio: me.bio ?? "",
            specialties: me.specialties,
            levelsTaught: me.levels_taught,
            minChildAgeMonths: me.min_child_age_months,
            maxChildrenPerLesson: me.max_children_per_lesson,
            yearsExperience: me.years_experience,
            languages: me.languages,
            isAcceptingNewClients: me.is_accepting_new_clients,
          }}
        />
      </div>
    </div>
  );
}
